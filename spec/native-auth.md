# Native authentication — contract 1

How a native client signs a person in to a D3 product without a browser cookie, and how it uses a
D3 Auth identity instead. Every endpoint below is named by the manifest (`endpoints.*`); clients never
build these URLs themselves. All errors are `application/problem+json` with a registered type
(`problems/registry.json`).

## Native sessions

| Step | Request | Success | Failure problems |
|---|---|---|---|
| Sign in | `POST nativeSignIn {email, password, device: {name, platform}}` | `202 {next: "totp", challenge}`, or — for an account with no second factor — the session at once, as below | `invalid_credentials`, `throttled` |
| Second factor | `POST nativeSignIn {challenge, totp \| recoveryCode}` | `200 {accessToken, refreshToken, expiresIn, session: {id}}` | `invalid_code`, `reenrol_required`, `throttled` |
| Refresh | `POST nativeRefresh {refreshToken}` | `200 {accessToken, refreshToken, expiresIn}` | `refresh_reused`, `session_revoked` |
| Revoke | `POST nativeRevoke` with `Authorization: Bearer` | `204` | — |

| Re-enrol | `POST nativeSignIn {challenge, enrolTotp}` | as Second factor, plus optional `recoveryCodes: [...]` | `invalid_code`, `throttled` |

### Re-enrolment after a recovery code

A product that requires a new second factor after a recovery-code sign-in answers the second-factor
step with `403 reenrol_required`, carrying two extension members (CON-ADR-014):

```json
{
  "type": "https://d3cloud.io/problems/reenrol_required",
  "status": 403,
  "challenge": "<a fresh sign-in challenge>",
  "enrolment": { "secret": "JBSWY3DPEHPK3PXP", "otpauthUri": "otpauth://totp/...", "digits": 6, "period": 30 }
}
```

The client shows the secret (and the `otpauth://` link) so the person adds it to their authenticator,
then sends the first code as `enrolTotp` with the new challenge. A wrong code answers `invalid_code` and
leaves the challenge valid. If the success body carries `recoveryCodes`, the client shows them once.
Clients never generate one-time codes themselves.

- The challenge is short-lived (minutes) and names the account and device; a forged or expired one
  answers `invalid_code`, so the person starts again.
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

## D3 Auth itself

D3 Auth is the one product with no native session endpoints. A native client signs in to it through
the browser — authorization code with PKCE, as the public client its `constellation` preset
registers — and that one grant mints a token for each product's `resource` and one for D3 Auth's own
issuer (AUTH-ADR-008). So D3 Auth's manifest:

- lists the sign-in method `oidc`, which a client that does not know it ignores;
- sets `nativeSignIn`, `nativeRefresh` and `nativeRevoke` to null — the only product the schema
  allows to;
- names `me`, `accountApps` (the account's apps, each with `homeUrl`, `resource` and, for a D3
  product, `product`) and `stepUp`, all of which take the token audienced at D3 Auth's issuer.

D3 Auth mints a token for an app's audience only for its Constellation client, and only while the
person holds a grant to that app; a refusal at the token endpoint never consumes the refresh token.

Step-up on D3 Auth takes `{code}` or `{passkey}` — never a password — and answers
`{ok, until}`; a change that needs it answers `step_up_required` with `maxAgeSeconds`. Refusals are
problem+json for any request with a Bearer token or an `Accept` that names
`application/problem+json`, with the original code kept in a `code` member.

## Versioning

`contract: 1` is this document. Additive changes — new capabilities, new optional members, new problem
types — do not change the number, and clients must ignore what they do not recognise. A breaking change
increments it; clients support the current contract and the one before for at least one release.
