// A reference D3 product: contract 1 and phase II in memory, for proving the conformance suite. It
// is not a product — no persistence, one instance. `broken` switches off one promise at a time, so the
// suite's own tests can show each check catches what it claims to.
import Ajv2020 from "ajv/dist/2020.js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { seal, sign } from "../conformance/envelope.mjs";
import { totp } from "../conformance/totp.mjs";

export const ACCOUNTS = {
  owner: { email: "owner@example.com", password: "owner password 1!", totpSecret: "JBSWY3DPEHPK3PXP", role: "owner" },
  member: { email: "member@example.com", password: "member password 1!", totpSecret: "KRSXG5CTMVRXEZLU", role: "member" },
};
export const INVITE_TOKEN = "invite-conformance";

const relaySchema = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(new URL("../schema/relay-register.v1.schema.json", import.meta.url), "utf8")));

export function startReference({ product = "bindery", port = 0, broken = new Set() } = {}) {
  const accounts = new Map(Object.values(ACCOUNTS).map((a) => [a.email, { ...a, id: randomUUID(), active: true }]));
  const challenges = new Map(); // challenge -> { email, enrol?: secret }
  const sessions = new Map(); // session id -> { email, active }
  const access = new Map(); // access token -> session id
  const refresh = new Map(); // refresh token -> { session, rotated }
  const failures = new Map();
  const invites = new Set([INVITE_TOKEN]);
  let base = "";

  const send = (res, status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const problem = (res, status, name, extra = {}) =>
    broken.has("problem-type")
      ? send(res, status, { error: name })
      : send(res, status, { type: `https://d3cloud.io/problems/${name}`, title: name.replaceAll("_", " "), status, ...extra }, "application/problem+json");
  const codeOK = (secret, code) => [-1, 0, 1].some((d) => totp(secret, { time: Date.now() + d * 30_000 }) === code);
  const issue = (email) => {
    const id = randomUUID();
    sessions.set(id, { email, active: true });
    const accessToken = `at-${randomUUID()}`;
    const refreshToken = `rt-${randomUUID()}`;
    access.set(accessToken, id);
    refresh.set(refreshToken, { session: id, rotated: false });
    return { accessToken, refreshToken, expiresIn: 900, session: { id } };
  };
  const bearer = (req) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const id = token && access.get(token);
    const session = id && sessions.get(id);
    if (!session?.active || !accounts.get(session.email)?.active) return null;
    return { id, ...session };
  };

  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return problem(res, 400, "invalid_request"); }
    const path = new URL(req.url, base).pathname;
    const host = new URL(base).hostname;

    if (req.method === "GET" && path === "/.well-known/d3-app.json") {
      return send(res, 200, {
        product: broken.has("product") ? "someother" : product, name: "Reference", version: "1.0.0", contract: 1,
        capabilities: [`${product}.search`],
        signIn: { methods: ["password", "totp", "recovery_code"] },
        endpoints: {
          nativeSignIn: `${base}/api/auth/native/signin`, nativeRefresh: `${base}/api/auth/native/refresh`,
          nativeRevoke: `${base}/api/auth/native/revoke`, me: `${base}/api/auth/me`,
          inviteAccept: `${base}/api/auth/native/invite`, deleteAccount: `${base}/api/account/native/delete`,
          relayRegister: `${base}/api/push/native/register`,
        },
      });
    }
    if (req.method === "POST" && path === "/api/auth/native/signin") {
      if (body.challenge) {
        const pending = challenges.get(body.challenge);
        if (!pending) return problem(res, 401, "invalid_code");
        if (!codeOK(accounts.get(pending.email).totpSecret, body.totp)) return problem(res, 401, "invalid_code");
        challenges.delete(body.challenge);
        return send(res, 200, issue(pending.email));
      }
      const account = accounts.get(body.email);
      const count = failures.get(body.email) ?? 0;
      if (count >= 10) return problem(res, 429, "throttled", { retryAfter: 60 });
      if (!account?.active || account.password !== body.password) {
        failures.set(body.email, count + 1);
        return problem(res, 401, "invalid_credentials");
      }
      const challenge = randomUUID();
      challenges.set(challenge, { email: account.email });
      return send(res, 202, { next: "totp", challenge });
    }
    if (req.method === "POST" && path === "/api/auth/native/refresh") {
      const entry = refresh.get(body.refreshToken);
      if (!entry) return problem(res, 401, "session_revoked");
      const session = sessions.get(entry.session);
      if (entry.rotated && !broken.has("reuse")) {
        session.active = false;
        return problem(res, 401, "refresh_reused");
      }
      if (!session.active) return problem(res, 401, "session_revoked");
      entry.rotated = true;
      const accessToken = `at-${randomUUID()}`;
      const refreshToken = `rt-${randomUUID()}`;
      access.set(accessToken, entry.session);
      refresh.set(refreshToken, { session: entry.session, rotated: false });
      return send(res, 200, { accessToken, refreshToken, expiresIn: 900 });
    }
    if (req.method === "POST" && path === "/api/auth/native/revoke") {
      const session = bearer(req);
      if (!session) return problem(res, 401, "session_revoked");
      if (!broken.has("revoke")) sessions.get(session.id).active = false;
      return send(res, 204);
    }
    if (req.method === "GET" && path === "/api/auth/me") {
      const session = bearer(req);
      if (!session) return problem(res, 401, "session_revoked");
      const account = accounts.get(session.email);
      return send(res, 200, { accountId: account.id, email: account.email, displayName: account.displayName ?? "Reference", roles: [account.role] });
    }
    if (req.method === "POST" && path === "/api/push/native/register") {
      if (!bearer(req)) return problem(res, 401, "session_revoked");
      // A test instance may name a loopback relay over http; anything else must be https.
      const relayUrl = typeof body.relay?.url === "string" ? body.relay.url : "";
      const loopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(relayUrl);
      const checked = loopback ? { ...body, relay: { ...body.relay, url: relayUrl.replace("http://", "https://") } } : body;
      if (!broken.has("relay") && !relaySchema(checked)) return problem(res, 400, "invalid_request");
      send(res, 204);
      // The registration notification (spec/push.md), sent after answering.
      if (relayUrl && !relayUrl.includes(".invalid")) {
        const payload = { v: 1, category: `${product}.registered`, title: "Notifications are on", body: `${product} will tell this device what needs it.`,
          sentAt: new Date().toISOString() };
        const ciphertext = broken.has("relay-plaintext") ? Buffer.from(JSON.stringify(payload)).toString("base64") : await seal(body.devicePublicKey, payload);
        const raw = JSON.stringify({ ciphertext });
        const timestamp = String(Math.floor(Date.now() / 1000));
        fetch(`${relayUrl}/v1/push/${body.relay.registration}`, { method: "POST", body: raw,
          headers: { "content-type": "application/json", "x-d3-relay-timestamp": timestamp, "x-d3-relay-signature": await sign(body.relay.sendKey, timestamp, raw) } })
          .catch(() => {});
      }
      return;
    }
    if (req.method === "POST" && path === "/api/auth/native/invite") {
      if (body.challenge) {
        const pending = challenges.get(body.challenge);
        if (!pending?.enrol || !codeOK(pending.enrol, body.enrolTotp)) return problem(res, 401, "invalid_code");
        challenges.delete(body.challenge);
        accounts.get(pending.email).totpSecret = pending.enrol;
        return send(res, 200, { ...issue(pending.email), recoveryCodes: ["AAAA-BBBB", "CCCC-DDDD"] });
      }
      if (!invites.has(body.token)) return problem(res, 410, "invite_invalid");
      if (typeof body.password !== "string" || body.password.length < 12) return problem(res, 422, "weak_password", { detail: "Use at least 12 characters." });
      if (!broken.has("invite")) invites.delete(body.token);
      const email = `invited-${randomUUID()}@example.com`;
      accounts.set(email, { email, password: body.password, totpSecret: null, role: "member", id: randomUUID(), active: true, displayName: body.displayName });
      const challenge = randomUUID();
      challenges.set(challenge, { email, enrol: "MFRGGZDFMZTWQ2LK" });
      return send(res, 200, { challenge, enrolment: { secret: "MFRGGZDFMZTWQ2LK", digits: 6, period: 30 } });
    }
    if (req.method === "POST" && path === "/api/account/native/delete") {
      const session = bearer(req);
      if (!session) return problem(res, 401, "session_revoked");
      const account = accounts.get(session.email);
      if (body.confirmation !== host) return problem(res, 422, "invalid_request", { detail: "Type the server's name exactly." });
      if (!codeOK(account.totpSecret, body.totp)) return problem(res, 401, "invalid_code");
      const owners = [...accounts.values()].filter((a) => a.role === "owner" && a.active);
      if (account.role === "owner" && owners.length === 1) return problem(res, 409, "last_owner");
      account.active = false;
      for (const s of sessions.values()) if (s.email === account.email) s.active = false;
      return send(res, 202, { graceUntil: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    }
    return problem(res, 404, "capability_missing");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

// `node reference/server.mjs [port]` serves it for trying the CLI by hand.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { base } = await startReference({ port: Number(process.argv[2] ?? 8787) });
  console.log(`reference D3 product at ${base} — owner ${ACCOUNTS.owner.email} / "${ACCOUNTS.owner.password}" / ${ACCOUNTS.owner.totpSecret}`);
}
