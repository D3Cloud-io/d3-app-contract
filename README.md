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
| Sample manifests that must pass, and ones that must fail | [`samples/`](samples) |

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

## Checking it

```bash
npm ci
npm run validate
```

Every manifest in `samples/valid` must pass and every one in `samples/invalid` must fail — each says
why in `$invalidBecause`. CI runs the same check on every push.

## Coming next

A runnable conformance suite (container image and CLI) that each product's CI runs against a test
instance: the manifest, the native sign-in, refresh, reuse and revoke flow, throttling, audience and
linking, Bearer on a representative route, and the problem types.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
