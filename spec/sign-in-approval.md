# Sign-in approval — contract 1, phase II (D3 Auth)

A D3 Auth factor: approve a sign-in on another device from the phone, by picking the number that device
shows (CON-T-14.4). Only D3 Auth offers it, and only to accounts with a registered device (`push.md`).

1. The browser's sign-in reaches the second factor and the account has push approval: D3 Auth creates an
   approval, shows its number in the browser, and pushes category `d3auth.signin-approval` with
   `link: d3constellation://<host>/d3auth/approval/<id>`.
2. The app reads `GET /api/account/approvals/<id>` (Bearer):
   `200 {id, browser, place?, requestedAt, expiresAt, choices: [three distinct numbers, 10–99]}` — the
   browser's number is one of `choices`, at a random position. An answered or expired approval answers
   `410`.
3. The app asks for the device owner (Face ID), then answers
   `POST /api/account/approvals/<id> {number}` or `{deny: true}` → `200 {result}`, where `result` is
   `approved`, `denied`, `wrong_number` or `expired`.

- A wrong number refuses the sign-in exactly as a denial does: one answer per approval, no retries.
- Approvals expire after two minutes. The browser can always fall back to the authenticator code.
- Every approval and its answer are audited, with the device that answered.
