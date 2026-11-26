# Rocky Linux 9 HTTPS gateway without DNS

The host administrator owns Nginx, TLS keys and renewal. The application runs as its own
unprivileged user behind a localhost port and needs no sudo rights. These instructions do not
require a domain name or change the E-SOH broker. Apply them on the separate UI tenancy.

## Install host packages

Following [Docker's Rocky Linux procedure](https://docs.docker.com/engine/install/rockylinux/):

```bash
sudo dnf install dnf-plugins-core nginx httpd-tools python3.12 python3.12-pip
sudo dnf config-manager --add-repo https://download.docker.com/linux/rocky/docker-ce.repo
sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

If an unrelated custom package repository is unavailable, add `--disablerepo=<REPOSITORY_ID>`
to the DNF commands instead of waiting for it to recover.

Install Certbot in an isolated host environment:

```bash
sudo python3.12 -m venv /opt/certbot
sudo /opt/certbot/bin/pip install --upgrade pip
sudo /opt/certbot/bin/pip install 'certbot>=5.4'
sudo /opt/certbot/bin/certbot --version
```

An existing Python 3.11 Certbot virtual environment is also usable. Keep it updated and at
version 5.4 or newer for IP-address webroot validation. Do not install application packages
into Rocky's system Python.

## Operator parameters

Keep deployment-specific values outside this public repository, for example in a file with
mode 600 belonging to the operator:

```bash
PUBLIC_IP='203.0.113.10'
UI_UPSTREAM='http://127.0.0.1:8080'
CERT_EMAIL='operator@example.org'
```

The example IP is reserved documentation space: replace it with the actual EWC public/floating
IP. Use an absolute parameter-file path when switching accounts. `source` is a Bash builtin;
load the file inside `sudo -i`, rather than invoking `sudo source`.

## Firewall and EWC security groups

Allow inbound TCP 443 for HTTPS and TCP 80 for ACME HTTP validation in both the EWC security
group and host firewall. Keep SSH restricted according to local policy. Do not publish the
database, listener metrics, application port 8080 or a broker port to the Internet.

```bash
firewall-cmd --permanent --add-service=http --add-service=https
firewall-cmd --reload
```

Port 80 must serve only ACME validation and an HTTPS redirect once certificates exist.
It must never offer password authentication over plain HTTP.

## Bootstrap certificate validation

Before a certificate exists, create `/var/www/letsencrypt` and an HTTP-only Nginx server for
the configured IP. Its `/.well-known/acme-challenge/` location serves that directory, while
all other locations return 404. Validate with `nginx -t` before starting Nginx. This initial
server has no application proxy or plaintext login.

Request an IP certificate using the [Let's Encrypt short-lived certificate procedure](https://letsencrypt.org/2026/03/11/shorter-certs-certbot):

```bash
/opt/certbot/bin/certbot certonly \
  --webroot -w /var/www/letsencrypt \
  --ip-address "$PUBLIC_IP" \
  --preferred-profile shortlived \
  --cert-name webcam-ui \
  --email "$CERT_EMAIL"
```

Use the staging endpoint first when testing a new installation; staging certificates are not
publicly trusted. Request the real certificate after validation succeeds. Do not use the
traditional domain-based `certbot --nginx -d` command for this IP-address deployment.

## Viewer login and HTTPS proxy

Create a dedicated Nginx viewer account with a password chosen by the operator:

```bash
htpasswd -cB /etc/nginx/webcam-viewers.htpasswd viewer
chown root:nginx /etc/nginx/webcam-viewers.htpasswd
chmod 640 /etc/nginx/webcam-viewers.htpasswd
```

`-B` uses bcrypt; the password is entered interactively and is not exposed in command arguments.
For later password changes, omit `-c` so other accounts are not removed.

Copy and customize `deploy/nginx/webcam-ui.conf.example` under `/etc/nginx/conf.d/`. Replace
`PUBLIC_IP`, `UI_UPSTREAM`, `CERTIFICATE_FILE` and `CERTIFICATE_KEY_FILE`. With the command above,
certificate files are `/etc/letsencrypt/live/webcam-ui/fullchain.pem` and `privkey.pem`.
Use the appropriate Nginx listen/default-server arrangement if this host already serves sites.

```bash
nginx -t
systemctl enable --now nginx
systemctl reload nginx
```

The frontend and `/api/` share the same HTTPS origin through the one upstream. The application
administrator's signed cookie remains independent from Nginx viewer credentials. The backend
trusts proxy headers only because its host socket is localhost-only and Nginx overwrites those
headers. Do not expose the backend directly while retaining that trust configuration.

For SELinux-enabled hosts, allow Nginx to connect to the private upstream and restore standard
webroot labels:

```bash
setsebool -P httpd_can_network_connect on
restorecon -Rv /var/www/letsencrypt
```

Skip those commands when `getenforce` reports `Disabled`. Keep the application's read-only
configuration/secret mounts and PostgreSQL data labelled as described by Compose.

## Automatic renewal

IP certificates are short-lived; unattended renewal and Nginx reload are required.
Install the provided systemd units, adapting the Certbot path if necessary:

```bash
install -m 644 deploy/nginx/webcam-certbot-renew.service /etc/systemd/system/
install -m 644 deploy/nginx/webcam-certbot-renew.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now webcam-certbot-renew.timer
systemctl list-timers webcam-certbot-renew.timer
/opt/certbot/bin/certbot renew --cert-name webcam-ui --dry-run
```

The timer checks twice daily. Its deploy hook validates Nginx and reloads it only after
certificate renewal. Keep the ACME HTTP location reachable for subsequent renewals.

## Verification

Before viewer authentication, HTTPS returns 401 with a Basic Authentication challenge.
After authentication it reaches the application. A 502 means the local upstream is not running;
it is not a reason to remove HTTPS or authentication. Once the backend is running, verify
`/health/ready` and `/api/status` through the HTTPS gateway. Browser prompt behavior can differ;
test the HTTP authentication response itself when diagnosing a browser-specific issue.
