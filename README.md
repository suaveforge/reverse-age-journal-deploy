# Reverse Age Journal — static web

Public, static, credential-free frontend for the independent Reverse Age Journal pilot.

## Preview

GitHub Pages is enabled and built. Spaceship CNAME is set for `reverse-age-journal.suaveforge.com`; HTTP 200 was verified on 2026-10-31. HTTPS certificate issuance is still pending verification. Until HTTPS is available, use this only as a read-only preview; do not enter personal information.

No customer data or simulated payment success is embedded in the site. Before backend configuration, the page is a **read-only preview**.

## Configure

Edit `config.js` with *public only* endpoint settings **after** the service domain and the official Monitor project `pNN` are established:

- `apiBase`: hosted independent journal API, over HTTPS
- `authProject`: officially registered AuthHub project
- `authApiBase`: AuthHub API
- `authWebBase`: AuthHub hosted sign-in portal

The backend must have matching AuthHub JWT project ID and PayHub project ID, registered callback/return origins, CORS allowlist, secrets and webhook. Never store API, PG or Retell secrets in this repository.

## Features

- Responsive family dashboard: selected family, balance, reservations, diaries and available packages
- AuthHub-hosted sign-in; uses one-time AuthHub code exchange, never local passwords or recreated social OAuth
- Counselor overview gated by a verified backend operator role
- Session-wallet purchase through PayHub's hosted checkout and verified server-side webhook only
- Reservation entry is a schedule record, **not live automatic dialing**
- Browser return URLs never credit wallets

## Embedding later

Keep the service independent. When integrating with the counselor's existing site, link to the service or integrate the UI with approved navigation/auth redirects. Do not assume an iframe will work with SSO/cookie policy without testing.
