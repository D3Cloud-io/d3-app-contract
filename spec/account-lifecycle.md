# Account lifecycle — contract 1, phase II

Accepting an invite natively creates an account, so App Review guideline 5.1.1(v) requires deleting
one natively too (CON-ADR-011). Both are optional endpoints: a product that names them in its
manifest promises everything below; one that lists them as `null` hides both features in clients.

## Invite acceptance — `endpoints.inviteAccept`

A product's invite email links to its own web page (`https://<host>/invite/<token>`, or any
invite-named path with `?token=`), and clients accept the same token natively.

| Step | Request | Success | Failure problems |
|---|---|---|---|
| Account | `POST inviteAccept {token, displayName, password, device: {name, platform}}` | `200 {challenge, enrolment}` | `invite_invalid` (410), `weak_password` (422), `throttled` |
| Second factor | `POST inviteAccept {challenge, enrolTotp}` | `200 {accessToken, refreshToken, expiresIn, session: {id}, recoveryCodes?}` | `invalid_code`, `throttled` |

- `enrolment` is `{secret, otpauthUri?, digits?, period?}`, as in re-enrolment (`native-auth.md`). The
  client shows it; it never computes codes.
- The account exists after the first step; the challenge only finishes its second factor. A wrong code
  answers `invalid_code` and leaves the challenge valid until it expires (the product's choice, at least
  ten minutes).
- A token works once. A used, revoked or expired token answers `410 invite_invalid` — never
  `invalid_credentials`, which would hint that an account exists.
- `weak_password` carries `detail` in words a person can act on ("Use at least 12 characters.").
- The session is a native session (`native-auth.md`): it appears in the sessions screen named by `device.name`.
- Roles, groups and app grants come from the invite; the product audits the acceptance like a web one.

## Account deletion — `endpoints.deleteAccount`

| Request | Success | Failure problems |
|---|---|---|
| `POST deleteAccount {confirmation, totp}` with `Authorization: Bearer` | `202 {graceUntil}` | `invalid_code`, `last_owner` (409), `throttled`, `session_revoked` |

- `confirmation` is the product's host name, typed by the person; a mismatch answers `422` with a
  `detail`. `totp` is a current code from the account's authenticator: the step-up is in the request.
- `graceUntil` is an RFC 3339 time at least 24 hours away. Until then the account is disabled and can be
  restored only through the product's own recovery (its web console or an owner); afterwards it is
  deleted for good. On `202` the product ends every session of the account, native and web.
- `last_owner` (409) refuses deletion of the instance's last owner: a client explains it and never retries.
- What goes with an account is each product's decision, recorded in its own deletion ADR (Postroom
  crypto-shreds the mailbox; Bindery keeps shared documents; Foreman keeps authored records attributed).
- The request and its outcome are audited; the grace-period deletion is audited when it runs.
