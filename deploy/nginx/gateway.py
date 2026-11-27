#!/usr/bin/env python3
"""Check DNS and render the host gateway using only Python's standard library.

This tool writes configuration to stdout; it never installs files, changes DNS,
reads TLS private keys, issues certificates, or reloads a running server.
"""

import argparse
import ipaddress
import json
import re
import socket
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

CERTIFICATE_NAME = "webcam-ui-domain"
CERTIFICATE_DIRECTORY = Path("/etc/letsencrypt/live") / CERTIFICATE_NAME
TEMPLATES = Path(__file__).resolve().parent


def hostname(value: str) -> str:
    value = value.strip().lower()
    labels = value.split(".")
    if len(value) > 253 or len(labels) < 2 or any(
        not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
        for label in labels
    ):
        raise ValueError("UI_HOSTNAME must be a certificate-valid FQDN, without underscores, URL, port or trailing dot; ask EWC for a valid alias if needed")
    try:
        ipaddress.ip_address(value)
    except ValueError:
        pass
    else:
        raise ValueError("UI_HOSTNAME must be a DNS hostname, not an IP address")
    if labels[-1].isdigit() or labels[-1] in {"local", "novalocal", "localhost", "invalid", "test"}:
        raise ValueError("UI_HOSTNAME must be the assigned public hostname, not an internal/test name")
    return value


def upstream(value: str) -> str:
    try:
        parsed = urlsplit(value)
        valid = (not any(character.isspace() for character in value)
                 and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "::1"}
                 and parsed.port is not None and parsed.port > 0
                 and parsed.username is None and parsed.password is None
                 and not parsed.path and not parsed.query and not parsed.fragment)
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("UI_UPSTREAM must be http://127.0.0.1:PORT or http://[::1]:PORT")
    return value


def check_dns(name: str, public_ip: str) -> dict:
    name = hostname(name)
    expected = ipaddress.ip_address(public_ip)
    if not expected.is_global:
        raise ValueError("PUBLIC_IP must be the VM's public/floating IP")
    records = socket.getaddrinfo(name, None, type=socket.SOCK_STREAM)
    addresses = {ipaddress.ip_address(record[4][0]) for record in records}
    same_family = {address for address in addresses if address.version == expected.version}
    if same_family != {expected}:
        raise ValueError("DNS records do not resolve exclusively to the configured VM public IP; check the assigned name, propagation and address families")
    return {"hostname": name, "addresses": sorted(map(str, addresses)),
            "public_ip_matches": True,
            "ipv6_http_validation_required": any(address.version == 6 for address in addresses)}


@dataclass(frozen=True)
class Node:
    words: tuple[str, ...]
    start: int
    end: int
    depth: int
    body: int = 0


# Quotes, comments, escaped characters and ${variables} must not change brace depth.
TOKEN = re.compile(r'''\s+|\#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|(?:\$\{[^}]+\}|\\.|[^\s{};\#"'])+''')


def nodes(text: str) -> tuple[list[Node], list[Node]]:
    blocks, directives, stack, statement = [], [], [], []
    for token in TOKEN.finditer(text):
        word = token.group()
        if word.isspace() or word.startswith("#"):
            continue
        if word == "{":
            if not statement:
                raise ValueError("unrecognised Nginx block; review the gateway manually")
            stack.append((tuple(item.group() for item in statement), statement[0].start(), token.end()))
            statement = []
        elif word == "}":
            if not stack or statement:
                raise ValueError("unbalanced Nginx configuration")
            header, start, body = stack.pop()
            blocks.append(Node(header, start, token.end(), len(stack), body))
        elif word == ";":
            if statement:
                directives.append(Node(tuple(item.group() for item in statement),
                                       statement[0].start(), token.end(), len(stack)))
            statement = []
        else:
            statement.append(token)
    if stack or statement:
        raise ValueError("incomplete Nginx configuration")
    return blocks, directives


def render(name: str, target: str = "http://127.0.0.1:8080", *, http_only: bool = False,
           certificate_directory: Path = CERTIFICATE_DIRECTORY) -> str:
    values = {"UI_HOSTNAME": hostname(name), "UI_UPSTREAM": upstream(target),
              "CERTIFICATE_FILE": json.dumps(str(certificate_directory / "fullchain.pem")),
              "CERTIFICATE_KEY_FILE": json.dumps(str(certificate_directory / "privkey.pem"))}
    template = TEMPLATES / ("webcam-ui-http.conf.example" if http_only else "webcam-ui.conf.example")
    return re.sub(r"@@([A-Z_]+)@@", lambda match: values[match[1]], template.read_text())


def migrate(text: str, name: str, target: str = "http://127.0.0.1:8080", *,
            certificate_directory: Path = CERTIFICATE_DIRECTORY) -> str:
    """Change the canonical host/certificate while retaining existing HTTPS locations."""
    name, target = hostname(name), upstream(target)
    blocks, directives = nodes(text)
    servers = [node for node in blocks if node.depth == 0 and node.words == ("server",)]

    def children(server, keyword):
        return [node for node in directives if node.depth == 1
                and server.body <= node.start < server.end and node.words[0] == keyword]

    def listens(server, port):
        return any(re.search(rf"(?:^|:){port}$", node.words[1])
                   for node in children(server, "listen"))

    http = [server for server in servers if listens(server, 80) and not listens(server, 443)]
    https = [server for server in servers if listens(server, 443) and not listens(server, 80)]
    if len(servers) != 2 or len(http) != 1 or len(https) != 1:
        raise ValueError("expected one HTTP and one HTTPS server in this gateway fragment; review other layouts manually")
    http, https = http[0], https[0]
    auth = children(https, "auth_basic")
    if len(auth) != 1 or auth[0].words[1:] == ("off",) or not children(https, "auth_basic_user_file"):
        raise ValueError("existing HTTPS server must have viewer Basic Authentication")
    if not any(node.words == ("proxy_pass", target) and https.body < node.start < https.end
               for node in directives):
        raise ValueError("existing gateway does not proxy to the configured loopback UI_UPSTREAM")

    patches = []

    def replace(server, keyword, value):
        found = children(server, keyword)
        if len(found) != 1:
            raise ValueError(f"expected exactly one {keyword} directive in the relevant server")
        patches.append((found[0].start, found[0].end, f"{keyword} {value};"))

    for server in (http, https):
        replace(server, "server_name", name)
    replace(https, "ssl_certificate", json.dumps(str(certificate_directory / "fullchain.pem")))
    replace(https, "ssl_certificate_key", json.dumps(str(certificate_directory / "privkey.pem")))
    http_auth = children(http, "auth_basic")
    if http_auth:
        replace(http, "auth_basic", "off")
    else:
        patches.append((http.body, http.body, "\n    auth_basic off;"))

    locations = [node for node in blocks if node.depth == 1 and http.body < node.start < http.end]
    allowed = {("location", "/"), ("location", "^~", "/.well-known/acme-challenge/")}
    if len(locations) != 2 or {node.words for node in locations} != allowed:
        raise ValueError("HTTP routes differ from ACME plus redirect; review them manually")
    template = render(name)
    example_blocks, _ = nodes(template)
    for location in locations:
        replacement = next(node for node in example_blocks if node.words == location.words)
        patches.append((location.start, location.end, template[replacement.start:replacement.end]))
    for start, end, value in sorted(patches, reverse=True):
        text = text[:start] + value + text[end:]
    return text


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check", help="validate the public FQDN and its DNS addresses")
    check.add_argument("--hostname", required=True)
    check.add_argument("--public-ip", required=True)
    generate = commands.add_parser("render", help="write a candidate Nginx configuration to stdout")
    generate.add_argument("--hostname", required=True)
    generate.add_argument("--upstream", default="http://127.0.0.1:8080")
    mode = generate.add_mutually_exclusive_group()
    mode.add_argument("--http-only", action="store_true", help="bootstrap a fresh installation")
    mode.add_argument("--existing", type=Path, help="retain existing HTTPS routes, includes and authentication")
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            print(json.dumps(check_dns(args.hostname, args.public_ip), indent=2))
        elif args.existing:
            print(migrate(args.existing.read_text(), args.hostname, args.upstream), end="")
        else:
            print(render(args.hostname, args.upstream, http_only=args.http_only), end="")
        return 0
    except (ValueError, OSError) as error:
        print(f"Gateway configuration: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
