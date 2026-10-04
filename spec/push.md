# Push — contract 1, phase II

Push reaches Constellation through a relay the app's developer runs (CON-ADR-010): a Cloudflare Worker
that holds the APNs key. Products never see an APNs token; each encrypts every notification to a key
the device made for it, so neither the relay nor Apple can read one (CON-ADR-016).

## Registration — `endpoints.relayRegister`

The client first registers the connection at the relay and receives `{id, sendKey, deleteKey}`. It then
tells the product, with the connection's Bearer token:

```
POST relayRegister
{
  "devicePublicKey": "<base64 of a P-256 public key, X9.63 uncompressed, 65 bytes>",
  "relay": { "url": "https://relay.example", "registration": "<id>", "sendKey": "<secret>" },
  "categories": ["postroom.priority"]
}
```

- Answer `204`. Registering again replaces the earlier registration for that session.
- Then send one notification to it, category `<product>.registered` ("Notifications are on"), within
  ten seconds. It tells the person push works, and it is what the conformance suite's `relay.delivers`
  check waits for.
- `relay.url` is https. A product's test configuration may also accept a loopback `http://127.0.0.1`
  relay, so CI can run the suite's mock relay; production never does.
- The registration belongs to the session: revoking the session (sign-out, `session_revoked`,
  `refresh_reused`) forgets it.
- `categories` lists what the device wants; send nothing else ([categories](#categories)).
- Schema: [`schema/relay-register.v1.schema.json`](../schema/relay-register.v1.schema.json).

## Sending

```
POST <relay.url>/v1/push/<registration>
X-D3-Relay-Timestamp: <unix seconds>
X-D3-Relay-Signature: base64url(HMAC-SHA256(sendKey, "<timestamp>.<body>"))
{ "ciphertext": "<envelope>", "collapseId": "<optional, ≤ 64 bytes>", "priority": "high" | "low" }
```

| Relay answer | Meaning | The product |
|---|---|---|
| `202` | Handed to APNs | — |
| `401` | Bad signature or a clock more than five minutes out | Check its clock and key |
| `410` | The device is gone or signed out | Forgets the registration |
| `413`, `400` | Envelope too large (3,000 base64 characters at most) or not base64 | Sends less |
| `429` | More than 30 a minute for this registration | Waits `retryAfter` |

## The envelope, version 1

```
shared   = ECDH(ephemeral private, device public)                     32 bytes
key      = HKDF-SHA256(shared, salt = ephemeral.pub ‖ device.pub, info = "d3-relay-envelope-v1"), 32 bytes
sealed   = AES-256-GCM(key, 12-byte random nonce, plaintext, aad = "d3-relay-envelope-v1")
envelope = base64( 0x01 ‖ ephemeral.pub (65) ‖ nonce (12) ‖ ciphertext ‖ tag (16) )
```

A fresh ephemeral key per notification. The plaintext is JSON
([`schema/notification.v1.schema.json`](../schema/notification.v1.schema.json)):

```json
{ "v": 1, "category": "postroom.priority", "title": "Sarah Byrne", "body": "Re: site copy",
  "thread": "thread-1", "link": "d3constellation://mail.example.com/postroom/message/m-1", "sentAt": "2026-10-04T12:00:00Z" }
```

`link` opens when the notification is tapped: a `d3constellation://<host>/<product>/<path>` link to
something the account can see. [`vectors/envelope-v1.json`](../vectors/envelope-v1.json) has a test key
and sealed envelopes: a product's tests should open them, and Constellation's tests open the reference's.

## Categories

| Category | Sent by | When |
|---|---|---|
| `postroom.priority` | Postroom | A new message lands in Priority |
| `shipyard.approval` | Shipyard | A deploy waits for approval |
| `d3auth.login` | D3 Auth | A new sign-in to the account |
| `d3auth.signin-approval` | D3 Auth | A sign-in waits for this phone ([`sign-in-approval.md`](sign-in-approval.md)) |
| `bindery.review` | Bindery | Documents wait in Review |
| `<product>.registered` | Every product | Once, after each registration |

Titles and bodies say what happened in the person's words; they never carry secrets, codes or links
that sign in.
