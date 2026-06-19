# Sponsor operations

`baton-sponsor` is a constrained Sui Testnet gas sponsor for project registration. It never receives Baton content or user private keys, and it reconstructs the only transaction it will sign: `memory::create_project` with a fixed maximum gas budget.

This document is an operator runbook, not evidence of a Baton-operated public endpoint. Run the service behind a TLS reverse proxy and monitor it before sharing invitations with external users.

## Files and permissions

Use a dedicated operating-system account. Keep the sponsor identity outside the web root and readable only by that account.

```text
/etc/baton-sponsor/identity.json   0600 root:baton-sponsor
/var/lib/baton-sponsor/state.json  0600 baton-sponsor:baton-sponsor
```

Back up both files through an encrypted secret-management system. The state file contains token hashes, bindings, reservations, and transaction results—not bearer tokens—but it is still operationally sensitive. Never copy an identity into a container image or source repository.

## Issue a bound invitation

The user obtains their address from `baton login` and project ID from `baton status`. Bind both whenever possible:

```sh
baton-sponsor invite \
  --state /var/lib/baton-sponsor/state.json \
  --ttl-hours 24 \
  --recipient 0xUSER \
  --project PROJECT_ID
```

Send the token through a confidential channel. The stable invitation ID printed on stderr is safe for operator inventory and revocation; it is not an authorization token.

## Run with explicit liability limits

```sh
baton-sponsor serve \
  --state /var/lib/baton-sponsor/state.json \
  --identity /etc/baton-sponsor/identity.json \
  --port 8787 \
  --trust-proxy \
  --rate-limit 30 \
  --daily-limit 100 \
  --max-active 10
```

The rate limit counts registration HTTP requests per client per minute; a normal registration uses prepare and execute requests. `--trust-proxy` trusts the rightmost valid `X-Forwarded-For` address and must be enabled only when the loopback listener is reached through a reverse proxy that overwrites or safely appends that header.

Equivalent environment variables are `BATON_SPONSOR_STATE`, `BATON_SPONSOR_IDENTITY`, `BATON_SPONSOR_TRUST_PROXY=1`, `BATON_SPONSOR_RATE_LIMIT`, `BATON_SPONSOR_DAILY_LIMIT`, and `BATON_SPONSOR_MAX_ACTIVE`.

## TLS reverse proxy

The daemon binds only to `127.0.0.1`. A minimal Caddy route exposes registration and health endpoints while keeping metrics local:

```caddyfile
sponsor.example.com {
  @public path /health /ready /v1/register/prepare /v1/register/execute
  handle @public {
    reverse_proxy 127.0.0.1:8787 {
      header_up X-Forwarded-For {remote_host}
    }
  }
  respond 404
}
```

Caddy obtains and renews TLS certificates when DNS and ports are configured correctly. Do not expose the daemon port directly or forward plaintext traffic across machines.

## systemd hardening profile

```ini
[Unit]
Description=Baton constrained Testnet sponsor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=baton-sponsor
Group=baton-sponsor
EnvironmentFile=-/etc/baton-sponsor/service.env
ExecStart=/usr/local/bin/baton-sponsor serve --state /var/lib/baton-sponsor/state.json --identity /etc/baton-sponsor/identity.json --port 8787 --trust-proxy --rate-limit 30 --daily-limit 100 --max-active 10
Restart=on-failure
RestartSec=5s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/var/lib/baton-sponsor

[Install]
WantedBy=multi-user.target
```

Adjust paths to the installed binary and identity. Validate the unit with `systemd-analyze security baton-sponsor.service` on the target host.

## Health, readiness, and metrics

- `GET /health` confirms the process is serving requests. It does not touch Sui.
- `GET /ready` reaches Sui Testnet and proves that an unreserved sponsor coin can cover the fixed registration budget. It returns `503` when that cannot be established.
- `GET /metrics` emits Prometheus text with counts only: successful prepare/execute responses, rejections, throttles, readiness failures, completed registrations today, active reservations, and configured caps. It contains no addresses, invitation IDs, project IDs, tokens, or transaction digests.

Scrape metrics over loopback. Alert on readiness failures, sustained rejection/throttle growth, active reservations near the configured cap, and completed-today near the daily limit.

## Routine operations

```sh
baton-sponsor list --state /var/lib/baton-sponsor/state.json
baton-sponsor list --state /var/lib/baton-sponsor/state.json --json
baton-sponsor revoke --state /var/lib/baton-sponsor/state.json --id INVITATION_ID
baton-sponsor prune --state /var/lib/baton-sponsor/state.json
```

Revocation is allowed only before a successful registration. Pruning removes expired and revoked records but retains completed results for idempotency and auditability. Daemon and CLI mutations use the same cross-process lock and may safely run concurrently.

## Incident response

- **Identity suspected exposed:** stop the daemon, remove public routing, rotate to a newly funded sponsor identity, and preserve the old state file for audit. Invitation constraints prevent arbitrary transaction signing but do not make a leaked gas key safe.
- **Token suspected exposed:** revoke its invitation ID immediately. A pre-bound token cannot be redirected to another user or project.
- **Readiness failing:** check Testnet RPC health, sponsor coin balance/object availability, state permissions, and active reservations. Do not route traffic based on `/health` alone.
- **State corruption:** stop the daemon and restore the encrypted backup. Do not delete completed records merely to clear an error; they carry retry results.
- **Unexpected spend:** stop routing and the daemon first, then reconcile completed transaction digests from `baton-sponsor list --json` against Sui before re-enabling service.

Mainnet operation, Internet-facing deployment, managed monitoring, and production abuse economics have not yet been proven by the Baton project.
