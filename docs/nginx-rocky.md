# Rocky Linux 9 HTTPS gateway with EWC DNS

Use the VM's assigned **EWC public FQDN** as `UI_HOSTNAME`. Nginx terminates TLS
and requires viewer Basic Authentication; the application stays on
`127.0.0.1:8080`. The host administrator owns Nginx, TLS keys, viewer passwords,
deployment parameters and systemd renewal. The application operator runs Docker
Compose and the application as an unprivileged user.

This procedure covers new installations and migration of an existing gateway.
It uses the existing Certbot webroot plugin and Python's standard library, with
no DNS plugin, DNS credentials, extra service or application changes. The helper
prints candidates and performs read-only DNS checks. It never installs files,
issues certificates or reloads the server.

## Identify the assigned hostname

The official [EWC DNS documentation](https://confluence.ecmwf.int/spaces/EWCLOUDKB/pages/326274726/EWC+DNS)
describes this pattern:

```text
<machine-name>.<tenancy-name>.<hosting-location>.ewcloud.host
```

Obtain the provisioned machine name, tenancy IAM name and hosting cloud from
Morpheus or EWC support. Copy the assigned DNS name where displayed, or confirm
the name assembled from those values. `f` denotes ECMWF hosting and `s` EUMETSAT
hosting. Machine names are lowercased; spaces or dots in a provisioned machine
name can prevent record creation. Records can take up to 15 minutes to appear.
EWC documents that the public IP is used when both public and private IPs exist.

Do not guess the tenancy/cloud, rely on reverse DNS, or use `hostname -f` as proof:
the OS may report an internal `.novalocal` name. Templates contain no specific
machine, tenancy or hosting location.

**Check certificate compatibility first.** EWC's example includes an underscore
in the tenancy name. Such a record can resolve but cannot be used in a public TLS
certificate: labels must use letters, digits and hyphens, without leading/trailing
hyphens. Ask EWC support for a valid assigned name/alias if needed; replacing
underscores locally does not create a DNS record. See the
[CA/Browser Forum requirements](https://cabforum.org/working-groups/server/baseline-requirements/requirements/).

EWC describes its automatic names as intended primarily for testing/development
and recommends an organizational domain for a public service. Record this
operational limitation when deploying under an EWC hostname.

## Host packages and administrator parameters

Reuse the installed Nginx, Certbot environment and Docker on an existing host.
For a fresh Rocky host, follow [Docker's installation procedure](https://docs.docker.com/engine/install/rockylinux/):

```bash
sudo dnf install dnf-plugins-core nginx httpd-tools python3.12 python3.12-pip
sudo dnf config-manager --add-repo https://download.docker.com/linux/rocky/docker-ce.repo
sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo python3.12 -m venv /opt/certbot
sudo /opt/certbot/bin/pip install certbot
sudo /opt/certbot/bin/certbot --version
```

Keep Certbot maintained in its isolated environment, not Rocky's system Python.
There is no IP-certificate-specific minimum version or profile requirement.
For an unrelated unavailable package repository, add
`--disablerepo=<REPOSITORY_ID>` to DNF commands instead of waiting for it.

The following commands run in the **host administrator's root Bash shell**:

```bash
sudo -i
set -euo pipefail
UI_REPO='/absolute/path/to/webcam-user-interface'
install -d -m 755 /etc/nginx
if [ ! -e /etc/nginx/webcam-gateway.env ]; then
    install -m 600 "$UI_REPO/deploy/nginx/webcam-gateway.env.example" /etc/nginx/webcam-gateway.env
fi
```

Edit that root-owned file with the real values:

```bash
UI_HOSTNAME='the-assigned-public-ewc-fqdn'
PUBLIC_IP='203.0.113.10'
UI_UPSTREAM='http://127.0.0.1:8080'
CERT_EMAIL='operator@example.org'
```

The IP/email above are placeholders. `PUBLIC_IP` is used only to check DNS;
certificate issuance and public URLs use `UI_HOSTNAME`. Supply a bare hostname,
without scheme, port, wildcard or trailing dot. Keep the upstream on loopback.
Review operator-supplied values and keep this administrator file root-owned,
mode 600. Do not source an operator-writable shell file as root. `source` is a
Bash builtin, so `sudo source ...` is not a command.

```bash
source /etc/nginx/webcam-gateway.env
python3.12 "$UI_REPO/deploy/nginx/gateway.py" check \
    --hostname "$UI_HOSTNAME" --public-ip "$PUBLIC_IP"
```

This checks hostname syntax and uses the OS resolver to require the expected
public IP, rejecting conflicting records in the same address family. Do not use
an `/etc/hosts` entry to make the check pass. Verify from outside the VM too:
internal resolution alone does not establish public reachability. If AAAA records
are returned, validation must work over IPv6 as well. Correct stale/unreachable
records before issuance. The helper does not change EWC-managed DNS.

## Firewall and ACME webroot

Allow inbound TCP **80** and **443** in the EWC security group and host firewall.
Certbot also needs outbound HTTPS. Keep SSH restricted under local policy; do not
publish PostgreSQL, metrics, code-server or application port 8080 directly.

```bash
firewall-cmd --permanent --add-service=http --add-service=https
firewall-cmd --reload
install -d -m 755 /var/www/letsencrypt/.well-known/acme-challenge
```

For a **fresh installation without an existing gateway**, render the HTTP-only
bootstrap. Non-ACME requests receive 404, with no application or plaintext login:

```bash
python3.12 "$UI_REPO/deploy/nginx/gateway.py" render \
    --hostname "$UI_HOSTNAME" --http-only > /etc/nginx/conf.d/webcam-ui.conf
nginx -t && systemctl enable --now nginx
```

First resolve any conflicting distribution welcome/default virtual host. Other
existing virtual hosts need administrator review of listen/default-server settings.

For an **existing HTTPS gateway**, keep it running during issuance. Do not replace
it with the bootstrap. Its HTTP ACME location must serve `/var/www/letsencrypt`
with `auth_basic off;`, overriding inherited authentication. Ordinary HTTP must
not proxy the application or ask for credentials.

On SELinux-enabled hosts, permit the private upstream and restore webroot labels:

```bash
setsebool -P httpd_can_network_connect on
restorecon -Rv /var/www/letsencrypt
```

Skip those two commands when `getenforce` reports `Disabled`; do not disable
SELinux to deploy. Retain Compose's existing data and secret labelling.

Create a harmless test file:

```bash
printf '%s\n' 'webcam-acme-check' > /var/www/letsencrypt/.well-known/acme-challenge/webcam-check
```

From a machine outside the VM, verify:

```bash
curl --noproxy '*' -i "http://${UI_HOSTNAME}/.well-known/acme-challenge/webcam-check"
```

Expect **200**, that text, no `WWW-Authenticate` header and no redirect. Use
`curl -4` and, when AAAA exists, `curl -6`. Nonexistent challenge files must return
404. The challenge is deliberately public on port 80 and provides no application
access. See [HTTP-01 validation](https://letsencrypt.org/docs/challenge-types/)
and [IPv6 requirements](https://letsencrypt.org/docs/ipv6-support/).

## Obtain the domain certificate

Use the fresh **`webcam-ui-domain`** lineage for both new installations and
migration. It avoids inheriting identifiers, profile and renewal settings from the
old `webcam-ui` certificate. Do not copy the old renewal configuration.

Inspect `certbot certificates` and any global `/etc/letsencrypt/cli.ini` first.
Remove obsolete UI-specific IP/profile overrides; report conflicts involving
other sites instead of changing their policy. If `webcam-ui-domain` already
exists, confirm its FQDN, webroot plugin and absence of a legacy profile override.

Test issuance without installing an untrusted staging certificate:

```bash
/opt/certbot/bin/certbot certonly --dry-run \
    --webroot -w /var/www/letsencrypt \
    --cert-name webcam-ui-domain -d "$UI_HOSTNAME" \
    --email "$CERT_EMAIL" --agree-tos
```

After success, request the trusted certificate with the same parameters:

```bash
/opt/certbot/bin/certbot certonly \
    --webroot -w /var/www/letsencrypt \
    --cert-name webcam-ui-domain -d "$UI_HOSTNAME" \
    --email "$CERT_EMAIL" --agree-tos
```

No explicit certificate profile is requested. Paths are:

```text
/etc/letsencrypt/live/webcam-ui-domain/fullchain.pem
/etc/letsencrypt/live/webcam-ui-domain/privkey.pem
```

DNS/CAA policy, public validation reachability and CA rate limits can block
issuance. Resolve failures before replacing a working gateway. Certbot's
[webroot documentation](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot)
describes validation without stopping the webserver.

## Render and install HTTPS

Keep an existing viewer password file. Create one only for a new installation:

```bash
if [ ! -e /etc/nginx/webcam-viewers.htpasswd ]; then
    htpasswd -cB /etc/nginx/webcam-viewers.htpasswd viewer
fi
chown root:nginx /etc/nginx/webcam-viewers.htpasswd
chmod 640 /etc/nginx/webcam-viewers.htpasswd
candidate=$(mktemp /etc/nginx/webcam-ui.candidate.XXXXXX)
```

Passwords are entered interactively. For a later password reset, use
`htpasswd -B /etc/nginx/webcam-viewers.htpasswd viewer`, omitting `-c`.

For a **fresh installation**, render the complete template:

```bash
python3.12 "$UI_REPO/deploy/nginx/gateway.py" render \
    --hostname "$UI_HOSTNAME" --upstream "$UI_UPSTREAM" > "$candidate"
```

For an **existing HTTPS gateway**, render a migration instead:

```bash
python3.12 "$UI_REPO/deploy/nginx/gateway.py" render \
    --hostname "$UI_HOSTNAME" --upstream "$UI_UPSTREAM" \
    --existing /etc/nginx/conf.d/webcam-ui.conf > "$candidate"
```

Migration retains the HTTPS body, authentication, headers, includes and locations,
updating its server name and certificate paths. The two HTTP locations become
unauthenticated ACME serving and a canonical FQDN redirect. Unexpected server
layouts or additional HTTP routes are rejected for administrator review. Retained
HTTPS configuration includes `/weather-maps/` with its separate authentication,
image paths and include; `/code/` with its proxy/WebSocket settings; and other
HTTPS locations. Nothing is copied from the external map generator into Git.

Inspect the candidate. Do not overwrite a customized gateway with the fresh
template. Only `@@...@@` placeholders are rendered; Nginx variables `$uri`,
`$request_uri`, `$host` and `$scheme` remain intact. Nginx does not substitute
shell environment variables in `server_name` itself.

Back up, validate and reload, restoring the old file if validation/reload fails:

```bash
backup_dir=$(mktemp -d /etc/nginx/webcam-ui-backup.XXXXXX)
cp -p /etc/nginx/conf.d/webcam-ui.conf "$backup_dir/webcam-ui.conf"
install -m 644 "$candidate" /etc/nginx/conf.d/webcam-ui.conf
if nginx -t && systemctl reload nginx; then
    rm -f "$candidate"
else
    cp -p "$backup_dir/webcam-ui.conf" /etc/nginx/conf.d/webcam-ui.conf
    nginx -t && systemctl reload nginx
    echo "Gateway restored; inspect the failed deployment before retrying." >&2
    exit 1
fi
```

The application operator continues with the existing Compose launcher and
loopback binding. This change needs no application rebuild, database migration,
MQTT restart or application/viewer password reset.

## Renewal and verification

Install the existing named units, now targeting the domain certificate:

```bash
install -m 644 "$UI_REPO/deploy/nginx/webcam-certbot-renew.service" /etc/systemd/system/
install -m 644 "$UI_REPO/deploy/nginx/webcam-certbot-renew.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now webcam-certbot-renew.timer
systemctl list-timers webcam-certbot-renew.timer
/opt/certbot/bin/certbot renew --cert-name webcam-ui-domain --dry-run --run-deploy-hooks \
    --deploy-hook '/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx'
```

Checks remain twice daily. A successful renewal validates Nginx and reloads it.
The dry-run tests staging renewal without replacing the active certificate;
`--run-deploy-hooks` tests the supplied reload hook using the active certificate.
Check the installed Certbot path. Do not retain a second scheduled renewal of the
retired UI lineage.

Check the public endpoint without disabling TLS verification:

```bash
curl --noproxy '*' -I "http://${UI_HOSTNAME}/api/status"
curl --noproxy '*' -I "https://${UI_HOSTNAME}/"
curl --noproxy '*' --user viewer "https://${UI_HOSTNAME}/health/ready"
```

Verify all of the following:

- Ordinary HTTP returns **308** to the configured FQDN and preserves path/query,
  with no authentication challenge.
- Unauthenticated HTTPS returns **401** with viewer Basic Authentication;
  authenticated readiness returns **200** when the backend is running.
- The HTTP test challenge still returns **200** without credentials and a missing
  challenge returns **404**. Remove the test file afterwards.
- Where installed, `/weather-maps/latest.png` requires separate `maps` credentials
  and returns a PNG; viewer credentials alone do not grant image access. Check
  `/code/` too if installed.
- Administrator login remains separate, with Secure/HttpOnly/SameSite cookies and
  CSRF checks. The new hostname is a new browser origin, so sign in again there.
  Forwarded headers are overwritten by Nginx and the backend remains localhost-only.

Update the image bookmark to `https://${UI_HOSTNAME}/weather-maps/latest.png`.
Old `https://IP/...` bookmarks may show a certificate-name warning before a
redirect can be read; distribute the FQDN URL directly. A 502 means the private
upstream is unavailable, not that authentication should be removed.

After HTTPS, map authentication and renewal are verified, confirm that no other
Nginx site uses the old certificate. Then retire it with
`/opt/certbot/bin/certbot delete --cert-name webcam-ui`. Keep the configuration
backup through migration; never delete a still-referenced certificate or copy
private keys into the application account/repository.
