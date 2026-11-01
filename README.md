# d3-app-contract

What every D3 Cloud product promises a native client. D3 Constellation, the native Apple app for
self-hosted D3 products, speaks only this contract, so a product that implements it works in the app
and a product that does not, does not appear.

| Piece | Where |
|---|---|
| Manifest, served at `/.well-known/d3-app.json` | [`schema/manifest.v1.schema.json`](schema/manifest.v1.schema.json) |
| Problem details (RFC 9457) | [`schema/problem.schema.json`](schema/problem.schema.json) |
| Registered problem types | [`problems/registry.json`](problems/registry.json) |
| Native sign-in, refresh, revoke, D3 Auth linking | [`spec/native-auth.md`](spec/native-auth.md) |
| Phase II: invite acceptance and account deletion | [`spec/account-lifecycle.md`](spec/account-lifecycle.md) |
| Phase II: push — relay registration, the envelope, categories | [`spec/push.md`](spec/push.md), [`schema/relay-register.v1.schema.json`](schema/relay-register.v1.schema.json), [`schema/notification.v1.schema.json`](schema/notification.v1.schema.json), [`vectors/`](vectors) |
| Phase II: D3 Auth sign-in approval by number matching | [`spec/sign-in-approval.md`](spec/sign-in-approval.md) |
| Samples that must pass, and ones that must fail, for every schema | [`samples/`](samples) |
| The conformance suite (CLI and image) and a reference product it is proven against | [`conformance/`](conformance), [`reference/`](reference) |

The contract is version **1**. Additive changes keep the number; breaking changes increment it, and
clients support the current version and the one before.

## The manifest in one example

```json
{
  "product": "bindery",
  "name": "Bindery",
  "version": "1.9.0",
  "contract": 1,
  "capabilities": ["bindery.search", "bindery.viewer", "bindery.upload"],
  "signIn": {
    "methods": ["password", "totp", "recovery_code", "d3auth"],
    "d3auth": { "issuer": "https://auth.example.com", "resource": "https://bindery.example.com" }
  },
  "endpoints": {
    "nativeSignIn": "https://bindery.example.com/api/auth/native/signin",
    "nativeRefresh": "https://bindery.example.com/api/auth/native/refresh",
    "nativeRevoke": "https://bindery.example.com/api/auth/native/revoke",
    "me": "https://bindery.example.com/api/auth/me",
    "link": "https://bindery.example.com/api/auth/native/link"
  }
}
```

Capabilities are `<product>.<feature>`; a client shows a feature only when its capability is listed.
Every URL is https. Listing `d3auth` as a method requires `signIn.d3auth` and a `link` endpoint.

## Problem types

`https://d3cloud.io/problems/<name>`:

| Name | Status | Meaning |
|---|---|---|
| `invalid_credentials` | 401 | Wrong email or password |
| `totp_required` | 401 | A second factor is needed |
| `invalid_code` | 401 | Wrong TOTP or recovery code |
| `reenrol_required` | 403 | Signed in with a recovery code; re-enrol the second factor |
| `throttled` | 429 | Too many attempts; `retryAfter` seconds |
| `identity_not_linked` | 401 | The D3 Auth identity is not linked here |
| `refresh_reused` | 401 | A rotated refresh token was replayed; the session is revoked |
| `session_revoked` | 401 | The session was revoked server-side |
| `step_up_required` | 403 | A fresh step-up is needed; `maxAgeSeconds` |
| `capability_missing` | 404 | The server lacks the capability |
| `last_owner` | 409 | The last owner cannot delete themselves |
| `forbidden_role` | 403 | The account's role does not permit this |
| `invite_invalid` | 410 | The invite token was used, revoked or expired |
| `weak_password` | 422 | The new password misses the product's policy; `detail` says how |

## Checking it

```bash
npm ci
npm run validate   # every schema's samples, the problem registry, the envelope vectors
npm test           # the suite against the reference product, conforming and broken one promise at a time
```

CI runs both on every push, smoke-tests the CLI and the image against the reference product, and on
`main` publishes the image as `ghcr.io/d3cloud-io/d3-app-conformance:contract-1` (and `:sha-<commit>`).

## Running the suite in a product's CI (CON-REQ-026)

Start the product's test instance with a seeded account that has an authenticator, then:

```bash
docker run --rm --network host ghcr.io/d3cloud-io/d3-app-conformance:contract-1 \
  --base http://localhost:8080 --allow-http --product bindery \
  --email ci@example.com --password "$CI_PASSWORD" --totp-secret "$CI_TOTP_SECRET" \
  --junit conformance.xml
```

| Option | For |
|---|---|
| `--allow-http` | A local CI instance; the schema's https rule is then checked on paths only |
| `--invite-token` | A fresh invite, to accept one (`--destructive`) |
| `--delete-email`, `--delete-password`, `--delete-totp-secret` | A disposable account to delete (`--destructive`) |
| `--main-is-last-owner` | The seeded account is the instance's only owner: deleting it must be `last_owner` |
| `--destructive` | Also throttle the account and run the invite and deletion checks |
| `--totp-reuse-allowed` | The instance accepts a code twice; otherwise the suite waits for a fresh one |
| `--relay-listen 8790` | Run a mock relay on this port and check the registration notification arrives sealed to the device (`relay.delivers`) |
| `--relay-public-url` | Where the product reaches that mock relay, when not `http://127.0.0.1:<port>` (e.g. `http://host.docker.internal:8790`) |
| `--only signin,refresh` | Run only checks whose id starts with these |

Checks for phase II endpoints run when the manifest names them and skip when they are `null`. The
exit status is non-zero when any check fails. While this repository is private, pulling the image
needs a token with `read:packages` (`docker login ghcr.io`).

## Licence

Apache-2.0. See [LICENSE](LICENSE).
