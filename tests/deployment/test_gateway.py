"""Deployment checks run without production credentials, certificates or services."""

import base64
import http.client
import importlib.util
import json
import shutil
import socket
import socketserver
import ssl
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy/nginx"
SPEC = importlib.util.spec_from_file_location("gateway_deployment", DEPLOY / "gateway.py")
gateway = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gateway
SPEC.loader.exec_module(gateway)
HOSTNAME = "webcam.example-tenancy.f.ewcloud.host"


@pytest.mark.parametrize("value", ["", "host", "192.0.2.1", "machine.tenancy_name.f.ewcloud.host",
                                  "https://example.org", "example.org:443", "*.example.org",
                                  "example.org.", "-bad.example.org", "bad-.example.org",
                                  "vm.novalocal", "a" * 64 + ".example.org",
                                  "example.org; auth_basic off;"])
def test_invalid_certificate_hostnames_are_rejected(value):
    with pytest.raises(ValueError):
        gateway.hostname(value)


def test_hostname_is_parameterized_and_uses_the_assigned_location():
    assert gateway.hostname("WEBCAM.TENANCY.S.EWCLOUD.HOST") == "webcam.tenancy.s.ewcloud.host"
    for name in (HOSTNAME, "another.other-tenancy.s.ewcloud.host"):
        result = gateway.render(name)
        assert result.count(f"server_name {name};") == 2
        assert f"https://{name}$request_uri" in result
        assert "@@" not in result
        assert "$uri" in result and "$scheme" in result and "$host" in result


@pytest.mark.parametrize("value", ["http://example.org:8080", "http://0.0.0.0:8080",
                                  "https://127.0.0.1:8080", "http://127.0.0.1:0",
                                  "http://user:password@127.0.0.1:8080",
                                  "http://127.0.0.1:8080/path", "http://127.0.0.1:8080\n"])
def test_upstream_cannot_expose_or_inject_nonlocal_routing(value):
    with pytest.raises(ValueError):
        gateway.upstream(value)


def test_dns_check_requires_the_actual_public_address(monkeypatch):
    monkeypatch.setattr(gateway.socket, "getaddrinfo", lambda *args, **kwargs: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 0)),
    ])
    assert gateway.check_dns(HOSTNAME, "8.8.8.8")["public_ip_matches"]
    with pytest.raises(ValueError, match="DNS records"):
        gateway.check_dns(HOSTNAME, "9.9.9.9")
    with pytest.raises(ValueError, match="public/floating"):
        gateway.check_dns(HOSTNAME, "127.0.0.1")


def test_dns_does_not_ignore_conflicting_addresses_or_hide_ipv6(monkeypatch):
    records = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 0)),
               (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2001:db8::1", 0, 0, 0))]
    monkeypatch.setattr(gateway.socket, "getaddrinfo", lambda *args, **kwargs: records)
    assert gateway.check_dns(HOSTNAME, "8.8.8.8")["ipv6_http_validation_required"]
    records.append((socket.AF_INET, socket.SOCK_STREAM, 6, "", ("9.9.9.9", 0)))
    with pytest.raises(ValueError, match="DNS records"):
        gateway.check_dns(HOSTNAME, "8.8.8.8")


EXTRA_ROUTES = '''
    include /etc/nginx/snippets/weather-maps.locations.conf;
    location = /code { return 301 /code/; }
    location ^~ /code/ {
        proxy_pass http://127.0.0.1:8088/;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
    # Braces and semicolons inside quoted values are not Nginx block boundaries.
    add_header X-Example "a {quoted; value}";
'''


def customized_gateway():
    original = gateway.render("old.example.org").replace(
        "    auth_basic_user_file /etc/nginx/webcam-viewers.htpasswd;",
        "    auth_basic_user_file /etc/nginx/webcam-viewers.htpasswd;" + EXTRA_ROUTES)
    return original.replace('"/etc/letsencrypt/live/webcam-ui-domain/',
                            '"/etc/letsencrypt/live/webcam-ui/')


def test_migration_preserves_custom_routes_auth_and_variables_and_is_repeatable():
    result = gateway.migrate(customized_gateway(), HOSTNAME)
    assert EXTRA_ROUTES in result
    assert 'auth_basic "Webcam viewers";' in result
    assert "auth_basic_user_file /etc/nginx/webcam-viewers.htpasswd;" in result
    assert "proxy_set_header X-Forwarded-Proto $scheme;" in result
    assert "old.example.org" not in result
    assert "/live/webcam-ui/" not in result
    assert result.count("/live/webcam-ui-domain/") == 2
    assert gateway.migrate(result, HOSTNAME) == result


def test_ambiguous_http_routes_or_unprotected_https_require_manual_review():
    original = customized_gateway()
    ambiguous = original.replace("    location / { return 308", "    location /unsafe { return 200; }\n    location / { return 308", 1)
    with pytest.raises(ValueError, match="HTTP routes"):
        gateway.migrate(ambiguous, HOSTNAME)
    with pytest.raises(ValueError, match="Basic Authentication"):
        gateway.migrate(original.replace('auth_basic "Webcam viewers";', "auth_basic off;"), HOSTNAME)


def test_templates_documentation_and_timer_use_one_domain_certificate():
    service = (DEPLOY / "webcam-certbot-renew.service").read_text()
    timer = (DEPLOY / "webcam-certbot-renew.timer").read_text()
    instructions = (ROOT / "docs/nginx-rocky.md").read_text()
    assert f"--cert-name {gateway.CERTIFICATE_NAME}" in service
    assert str(gateway.CERTIFICATE_DIRECTORY) in instructions
    assert 'nginx -t && /usr/bin/systemctl reload nginx' in service
    assert "OnCalendar=*-*-* 00,12:00:00" in timer
    assert "--ip-address" not in instructions and "--preferred-profile" not in instructions


@pytest.fixture
def running_gateway(tmp_path):
    programs = {name: shutil.which(name) for name in ("nginx", "openssl", "htpasswd")}
    if not all(programs.values()):
        pytest.skip("gateway smoke check needs the host's existing Nginx/OpenSSL/htpasswd")
    webroot = tmp_path / "webroot"
    challenge = webroot / ".well-known/acme-challenge"
    challenge.mkdir(parents=True)
    (challenge / "test-token").write_text("expected-acme-token")
    certificate = tmp_path / "certificate"
    certificate.mkdir()
    subprocess.run([programs["openssl"], "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                    "-days", "1", "-keyout", str(certificate / "privkey.pem"),
                    "-out", str(certificate / "fullchain.pem"), "-subj", f"/CN={HOSTNAME}",
                    "-addext", f"subjectAltName=DNS:{HOSTNAME},IP:127.0.0.1"],
                   check=True, capture_output=True)
    for username in ("viewer", "maps"):
        result = subprocess.run([programs["htpasswd"], "-niBC", "4", username],
                                input=f"test-{username}-password\n", text=True,
                                capture_output=True, check=True)
        (tmp_path / f"{username}.passwd").write_text(result.stdout)

    class Backend(BaseHTTPRequestHandler):
        def do_GET(self):
            result = json.dumps({"path": self.path, "host": self.headers.get("Host"),
                                 "scheme": self.headers.get("X-Forwarded-Proto"),
                                 "client": self.headers.get("X-Forwarded-For")}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)

        def log_message(self, *args):
            pass

    # Filesystem sockets keep this test independent of host firewall/network policy.
    backend_socket = tmp_path / "backend.sock"
    http_socket, https_socket = tmp_path / "http.sock", tmp_path / "https.sock"
    backend = socketserver.ThreadingUnixStreamServer(str(backend_socket), Backend)
    thread = threading.Thread(target=backend.serve_forever, daemon=True)
    thread.start()
    target = "http://127.0.0.1:8080"
    extra = f'''
    location /weather-maps/ {{
        auth_basic "Map viewers";
        auth_basic_user_file "{tmp_path}/maps.passwd";
        proxy_pass {target};
    }}
    location /code/ {{ proxy_pass {target}; }}
'''
    original = gateway.render("old.example.org", target, certificate_directory=certificate)
    original = original.replace("    location / {\n        proxy_pass", extra + "    location / {\n        proxy_pass")
    config = gateway.migrate(original, HOSTNAME, target, certificate_directory=certificate)
    config = config.replace("listen 80 default_server;", f"listen unix:{http_socket};")
    config = config.replace("listen 443 ssl;", f"listen unix:{https_socket} ssl;")
    config = config.replace("listen [::]:80 default_server;", "").replace("listen [::]:443 ssl;", "")
    config = config.replace("root /var/www/letsencrypt;", f'root "{webroot}";')
    config = config.replace("/etc/nginx/webcam-viewers.htpasswd", f"{tmp_path}/viewer.passwd")
    config = config.replace(f"proxy_pass {target};", "proxy_pass http://fixture_backend;")
    # Inherited auth proves the HTTP exception is explicit, not a default assumption.
    config_file = tmp_path / "nginx.conf"
    config_file.write_text(f'''
daemon off;
master_process off;
pid {tmp_path}/nginx.pid;
error_log {tmp_path}/error.log;
events {{ worker_connections 64; }}
http {{
    access_log off;
    client_body_temp_path {tmp_path}/client;
    proxy_temp_path {tmp_path}/proxy;
    fastcgi_temp_path {tmp_path}/fastcgi;
    uwsgi_temp_path {tmp_path}/uwsgi;
    scgi_temp_path {tmp_path}/scgi;
    auth_basic "Inherited authentication";
    auth_basic_user_file {tmp_path}/viewer.passwd;
    upstream fixture_backend {{ server unix:{backend_socket}; }}
    {config}
}}
''')
    subprocess.run([programs["nginx"], "-e", str(tmp_path / "error.log"), "-t", "-p", str(tmp_path), "-c", str(config_file)],
                   capture_output=True, check=True)
    server = subprocess.Popen([programs["nginx"], "-e", str(tmp_path / "error.log"), "-p", str(tmp_path), "-c", str(config_file)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                    probe.connect(str(http_socket))
                    break
            except OSError:
                if server.poll() is not None:
                    raise RuntimeError((tmp_path / "error.log").read_text()) from None
                time.sleep(0.02)
        else:
            raise RuntimeError("isolated test gateway did not start")
        context = ssl.create_default_context(cafile=str(certificate / "fullchain.pem"))

        def request(path, *, secure=False, credentials=None, extra_headers=None):
            headers = {"Host": HOSTNAME, **(extra_headers or {})}
            if credentials:
                headers["Authorization"] = "Basic " + base64.b64encode(credentials.encode()).decode()
            connection = http.client.HTTPConnection(HOSTNAME, timeout=3)

            def connect():
                stream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                stream.settimeout(3)
                stream.connect(str(https_socket if secure else http_socket))
                connection.sock = context.wrap_socket(stream, server_hostname=HOSTNAME) if secure else stream

            connection.connect = connect
            try:
                connection.request("GET", path, headers=headers)
                response = connection.getresponse()
                return response.status, dict(response.getheaders()), response.read()
            finally:
                connection.close()

        yield request
    finally:
        server.terminate()
        server.wait(timeout=5)
        backend.shutdown()
        backend.server_close()
        thread.join(timeout=3)


def test_real_nginx_acme_redirect_authentication_and_preserved_routes(running_gateway):
    request = running_gateway
    status, headers, body = request("/.well-known/acme-challenge/test-token")
    assert status == 200 and body == b"expected-acme-token"
    assert "WWW-Authenticate" not in headers and "Location" not in headers
    assert request("/.well-known/acme-challenge/missing")[0] == 404
    status, headers, _ = request("/api/status?example=1", extra_headers={"Host": "untrusted.example.org"})
    assert status == 308
    assert headers["Location"] == f"https://{HOSTNAME}/api/status?example=1"
    assert "WWW-Authenticate" not in headers
    assert request("/", secure=True)[0] == 401
    assert request("/api/status", secure=True, credentials="viewer:wrong")[0] == 401
    status, _, body = request("/api/status", secure=True, credentials="viewer:test-viewer-password",
                              extra_headers={"X-Forwarded-Proto": "http", "X-Forwarded-For": "spoofed"})
    assert status == 200
    result = json.loads(body)
    assert result["path"] == "/api/status" and result["host"] == HOSTNAME
    assert result["scheme"] == "https" and result["client"] and result["client"] != "spoofed"
    assert request("/code/", secure=True)[0] == 401
    assert request("/code/", secure=True, credentials="viewer:test-viewer-password")[0] == 200
    assert request("/weather-maps/latest.png", secure=True)[0] == 401
    assert request("/weather-maps/latest.png", secure=True, credentials="viewer:test-viewer-password")[0] == 401
    assert request("/weather-maps/latest.png", secure=True, credentials="maps:test-maps-password")[0] == 200
    assert request("/", secure=True, credentials="maps:test-maps-password")[0] == 401
