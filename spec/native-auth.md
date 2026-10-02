# Native authentication — contract 1

How a native client signs a person in to a D3 product without a browser cookie, and how it uses a
D3 Auth identity instead. Every endpoint below is named by the manifest (`endpoints.*`); clients never
build these URLs themselves. All errors are `application/problem+json` with a registered type
(`problems/registry.json`).

## Native sessions

| Step | Request | Success | Failure problems |
|---|---|---|---|
| Sign in | `POST nativeSignIn {email, password, device: {name, platform}}` | `202 {next: "totp", challenge}` | `invalid_credentials`, `throttled` |
| Second factor | `POST nativeSignIn {challenge, totp \| recoveryCode}` | `200 {accessToken, refreshToken, expiresIn, session: {id}}` | `invalid_code`, `reenrol_required`, `throttled` |
| Refresh | `POST nativeRefresh {refreshToken}` | `200 {accessToken, refreshToken, expiresIn}` | `refresh_reused`, `session_revoked` |
| Revoke | `POST nativeRevoke` with `Authorization: Bearer` | `204` | — |

- Access tokens are short-lived: the product's choice, at most 15 minutes.
- **Refresh tokens rotate on every use** and slide a 30-day window. Presenting a rotated refresh token
  revokes the whole session and answers `refresh_reused`. A client must never refresh the same token
  twice; with several processes (an app and its extensions) that means one refresher under a lock.
- A native session appears in the product's existing sessions screen, named by `device.name`, and is
  revocable there like any web session.
- Sign-in throttling, lockout and audit events are identical to the product's web sign-in.

## D3 Auth tokens and linking

When the manifest lists `d3auth` in `signIn.methods`, it also carries `signIn.d3auth.issuer` and
`signIn.d3auth.resource`. The client obtains an access token from that issuer with
`resource=<signIn.d3auth.resource>` (RFC 8707) and presents it as a Bearer token.

The product verifies the token against the issuer's JWKS with `aud` equal to its own resource URL,
`iss` equal to its configured issuer, and at most 60 seconds of clock leeway.

The pair `(iss, sub)` must already be linked to a local account, or the product answers
`401 identity_not_linked`. Identities are **never matched by email**.

| Step | Request | Success | Failure problems |
|---|---|---|---|
| Link | `POST link` with the D3 Auth Bearer token, body `{email, password, totp \| recoveryCode}` | `200` | `invalid_credentials`, `invalid_code`, `throttled` |

Linking proves control of the local account with the product's own credentials, once. It is throttled
like sign-in.

## Identity and roles

`GET me` with a Bearer token answers `{accountId, email, displayName, roles: [...], capabilities?: [...]}`.
Clients build their screens from the manifest's capabilities and these roles, and hide what the account
cannot use.

## Versioning

`contract: 1` is this document. Additive changes — new capabilities, new optional members, new problem
types — do not change the number, and clients must ignore what they do not recognise. A breaking change
increments it; clients support the current contract and the one before for at least one release.
