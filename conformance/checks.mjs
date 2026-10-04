// The D3 App conformance checks (CON-REQ-026): what a product promises a native client, asked of a
// running instance. Each check is independent enough to report on its own; later ones reuse the
// session earlier ones made. Destructive checks (throttling, deleting an account) run only when asked.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { codeSource, totp } from "./totp.mjs";

const here = new URL("..", import.meta.url);
const schema = (name) => JSON.parse(readFileSync(new URL(`schema/${name}`, here), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
addFormats(ajv);
ajv.addKeyword({ keyword: "$invalidBecause" });
const validManifest = ajv.compile(schema("manifest.v1.schema.json"));
const validProblem = ajv.compile(schema("problem.schema.json"));

export class Failure extends Error {}
export class Skip extends Error {}
const fail = (message) => { throw new Failure(message); };
const skip = (message) => { throw new Skip(message); };
const expect = (condition, message) => { if (!condition) fail(message); };

/** One request to the instance: always to the base origin, at the path the manifest named. */
async function call(ctx, method, endpoint, { body, bearer, headers = {} } = {}) {
  const path = endpoint.startsWith("http") ? new URL(endpoint).pathname + new URL(endpoint).search : endpoint;
  const init = { method, headers: { accept: "application/json, application/problem+json", ...headers }, redirect: "manual" };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  if (bearer) init.headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(new URL(path, ctx.config.base), init);
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, type, json, text };
}

/** A registered problem: the status, problem+json, the registered type, and the problem schema. */
function expectProblem(res, status, name) {
  const statuses = Array.isArray(status) ? status : [status];
  const names = Array.isArray(name) ? name : [name];
  expect(statuses.includes(res.status), `expected ${statuses.join(" or ")}, got ${res.status}: ${res.text.slice(0, 200)}`);
  expect(res.type.startsWith("application/problem+json"), `expected application/problem+json, got "${res.type}"`);
  expect(validProblem(res.json), `not a valid problem: ${ajv.errorsText(validProblem.errors)}`);
  if (names[0] !== undefined) {
    expect(names.some((n) => res.json.type === `https://d3cloud.io/problems/${n}`), `expected type ${names.join(" or ")}, got ${res.json.type}`);
  }
}

const device = { name: "d3-app-conformance", platform: "ci" };
const endpoint = (ctx, name) => ctx.manifest?.endpoints?.[name] ?? null;
const need = (ctx, name) => endpoint(ctx, name) ?? fail(`the manifest names no ${name}`);

/** Signs in with password and code; answers the session body. */
async function signIn(ctx, { email = ctx.config.email, password = ctx.config.password, codes = ctx.codes } = {}) {
  const first = await call(ctx, "POST", need(ctx, "nativeSignIn"), { body: { email, password, device } });
  expect([200, 202].includes(first.status) && typeof first.json?.challenge === "string",
    `password step: expected 202 {challenge}, got ${first.status}: ${first.text.slice(0, 200)}`);
  const second = await call(ctx, "POST", need(ctx, "nativeSignIn"), { body: { challenge: first.json.challenge, totp: await codes() } });
  expect(second.status === 200, `code step: expected 200, got ${second.status}: ${second.text.slice(0, 200)}`);
  const s = second.json ?? {};
  expect(typeof s.accessToken === "string" && typeof s.refreshToken === "string", "the session has no accessToken or refreshToken");
  return s;
}

const needCredentials = (ctx) => {
  if (!ctx.config.email || !ctx.config.password || !ctx.config.totpSecret) skip("no test account (--email, --password, --totp-secret)");
};

export const checks = [
  // Manifest
  { id: "manifest.served", title: "The manifest is served at /.well-known/d3-app.json", run: async (ctx) => {
    const res = await call(ctx, "GET", "/.well-known/d3-app.json");
    expect(res.status === 200, `expected 200, got ${res.status}`);
    expect(res.type.includes("json") && res.json, `expected JSON, got "${res.type}"`);
    ctx.manifest = res.json;
  } },
  { id: "manifest.schema", title: "The manifest matches manifest.v1.schema.json", run: async (ctx) => {
    if (!ctx.manifest) fail("no manifest");
    // A local test instance may serve http; the schema's https rule is checked on the paths otherwise.
    const checked = ctx.config.allowHttp ? JSON.parse(JSON.stringify(ctx.manifest).replaceAll("http://", "https://")) : ctx.manifest;
    expect(validManifest(checked), ajv.errorsText(validManifest.errors, { separator: "; " }));
  } },
  { id: "manifest.product", title: "The manifest names the expected product", run: async (ctx) => {
    if (!ctx.config.product) skip("no --product given");
    expect(ctx.manifest?.product === ctx.config.product, `expected ${ctx.config.product}, got ${ctx.manifest?.product}`);
  } },
  { id: "manifest.one-host", title: "Every endpoint is on one host", run: async (ctx) => {
    const hosts = new Set(Object.values(ctx.manifest?.endpoints ?? {}).filter(Boolean).map((u) => new URL(u).host));
    expect(hosts.size === 1, `endpoints span ${[...hosts].join(", ")}: a password must only go to the product's own host`);
  } },

  // Native sessions
  { id: "signin.wrong-password", title: "A wrong password is invalid_credentials", run: async (ctx) => {
    needCredentials(ctx);
    const res = await call(ctx, "POST", need(ctx, "nativeSignIn"), { body: { email: ctx.config.email, password: `${ctx.config.password}-wrong`, device } });
    expectProblem(res, 401, "invalid_credentials");
  } },
  { id: "signin.wrong-code", title: "A wrong code is invalid_code", run: async (ctx) => {
    needCredentials(ctx);
    const first = await call(ctx, "POST", need(ctx, "nativeSignIn"), { body: { email: ctx.config.email, password: ctx.config.password, device } });
    expect(typeof first.json?.challenge === "string", `password step: no challenge (${first.status})`);
    const right = totp(ctx.config.totpSecret);
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, "0");
    expectProblem(await call(ctx, "POST", need(ctx, "nativeSignIn"), { body: { challenge: first.json.challenge, totp: wrong } }), 401, "invalid_code");
  } },
  { id: "signin.session", title: "Password then code gives tokens, a session id and a short access token", run: async (ctx) => {
    needCredentials(ctx);
    ctx.session = await signIn(ctx);
    expect(typeof ctx.session.session?.id === "string", "the session has no session.id");
    expect(typeof ctx.session.expiresIn !== "number" || ctx.session.expiresIn <= 900, `access tokens live at most 15 minutes, not ${ctx.session.expiresIn}s`);
  } },
  { id: "me.bearer", title: "me answers the account with a Bearer token", run: async (ctx) => {
    if (!ctx.session) skip("no session");
    const res = await call(ctx, "GET", need(ctx, "me"), { bearer: ctx.session.accessToken });
    expect(res.status === 200, `expected 200, got ${res.status}`);
    expect(typeof res.json?.accountId === "string" && Array.isArray(res.json?.roles), "me has no accountId or roles");
    expect(String(res.json.email).toLowerCase() === ctx.config.email.toLowerCase(), `me is ${res.json.email}, not ${ctx.config.email}`);
  } },
  { id: "me.unauthenticated", title: "me without a token is a 401 problem", run: async (ctx) => {
    expectProblem(await call(ctx, "GET", need(ctx, "me")), 401);
  } },
  { id: "refresh.rotates", title: "A refresh rotates the refresh token", run: async (ctx) => {
    if (!ctx.session) skip("no session");
    const res = await call(ctx, "POST", need(ctx, "nativeRefresh"), { body: { refreshToken: ctx.session.refreshToken } });
    expect(res.status === 200 && typeof res.json?.refreshToken === "string", `expected 200 with tokens, got ${res.status}`);
    expect(res.json.refreshToken !== ctx.session.refreshToken, "the refresh token did not change");
    expect((await call(ctx, "GET", need(ctx, "me"), { bearer: res.json.accessToken })).status === 200, "the new access token is refused");
    ctx.rotated = { old: ctx.session.refreshToken, current: res.json.refreshToken };
  } },
  { id: "refresh.reuse-revokes", title: "Replaying a rotated refresh token is refresh_reused and ends the session", run: async (ctx) => {
    if (!ctx.rotated) skip("no rotated token");
    expectProblem(await call(ctx, "POST", need(ctx, "nativeRefresh"), { body: { refreshToken: ctx.rotated.old } }), 401, "refresh_reused");
    expectProblem(await call(ctx, "POST", need(ctx, "nativeRefresh"), { body: { refreshToken: ctx.rotated.current } }), 401,
      ["refresh_reused", "session_revoked"]);
  } },
  { id: "revoke.ends-session", title: "Revoke ends the session; its refresh token is session_revoked", run: async (ctx) => {
    needCredentials(ctx);
    const session = await signIn(ctx);
    const res = await call(ctx, "POST", need(ctx, "nativeRevoke"), { bearer: session.accessToken });
    expect(res.status === 204, `expected 204, got ${res.status}`);
    expectProblem(await call(ctx, "POST", need(ctx, "nativeRefresh"), { body: { refreshToken: session.refreshToken } }), 401, "session_revoked");
    ctx.session = await signIn(ctx);
  } },
  { id: "signin.throttled", title: "Repeated wrong passwords are throttled with retryAfter", destructive: true, run: async (ctx) => {
    needCredentials(ctx);
    for (let i = 0; i < 25; i++) {
      const res = await call(ctx, "POST", need(ctx, "nativeSignIn"), { body: { email: ctx.config.email, password: `wrong-${i}`, device } });
      if (res.status === 429) {
        expectProblem(res, 429, "throttled");
        expect(Number.isInteger(res.json.retryAfter), "throttled carries no retryAfter");
        return;
      }
    }
    fail("25 wrong passwords were never throttled");
  } },

  // Phase II: push
  { id: "relay.register", title: "relayRegister takes a device key and relay registration", run: async (ctx) => {
    if (!endpoint(ctx, "relayRegister")) skip("relayRegister is null");
    if (!ctx.session) skip("no session");
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const raw = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64");
    const body = { devicePublicKey: raw, relay: { url: "https://relay.invalid", registration: crypto.randomUUID(),
      sendKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") }, categories: [] };
    const res = await call(ctx, "POST", endpoint(ctx, "relayRegister"), { body, bearer: ctx.session.accessToken });
    expect(res.status === 204, `expected 204, got ${res.status}: ${res.text.slice(0, 200)}`);
    const bad = await call(ctx, "POST", endpoint(ctx, "relayRegister"), { body: { devicePublicKey: raw, apnsToken: "ab".repeat(32) }, bearer: ctx.session.accessToken });
    expect(bad.status >= 400 && bad.status < 500, `a registration without a relay was accepted (${bad.status})`);
  } },

  // Phase II: invites
  { id: "invite.unknown-token", title: "An unknown invite token is invite_invalid", run: async (ctx) => {
    if (!endpoint(ctx, "inviteAccept")) skip("inviteAccept is null");
    const res = await call(ctx, "POST", endpoint(ctx, "inviteAccept"),
      { body: { token: `conformance-${crypto.randomUUID()}`, displayName: "Conformance", password: "a long enough password 1!", device } });
    expectProblem(res, 410, "invite_invalid");
  } },
  { id: "invite.accept", title: "An invite makes an account, enrols a second factor and signs in; the token then dies", destructive: true, run: async (ctx) => {
    if (!endpoint(ctx, "inviteAccept")) skip("inviteAccept is null");
    if (!ctx.config.inviteToken) skip("no --invite-token");
    const password = `Conformance ${crypto.randomUUID()}`;
    const first = await call(ctx, "POST", endpoint(ctx, "inviteAccept"), { body: { token: ctx.config.inviteToken, displayName: "Conformance", password, device } });
    expect(first.status === 200 && typeof first.json?.challenge === "string" && typeof first.json?.enrolment?.secret === "string",
      `expected 200 {challenge, enrolment}, got ${first.status}: ${first.text.slice(0, 200)}`);
    const code = totp(first.json.enrolment.secret, { period: first.json.enrolment.period ?? 30, digits: first.json.enrolment.digits ?? 6 });
    const second = await call(ctx, "POST", endpoint(ctx, "inviteAccept"), { body: { challenge: first.json.challenge, enrolTotp: code } });
    expect(second.status === 200 && typeof second.json?.accessToken === "string", `expected 200 with tokens, got ${second.status}`);
    expectProblem(await call(ctx, "POST", endpoint(ctx, "inviteAccept"), { body: { token: ctx.config.inviteToken, displayName: "Again", password, device } }),
      410, "invite_invalid");
  } },

  // Phase II: deletion
  { id: "deletion.wrong-code", title: "Deleting with a wrong code is invalid_code", run: async (ctx) => {
    if (!endpoint(ctx, "deleteAccount")) skip("deleteAccount is null");
    if (!ctx.session) skip("no session");
    const right = totp(ctx.config.totpSecret);
    const wrong = String((Number(right) + 2) % 1_000_000).padStart(6, "0");
    const res = await call(ctx, "POST", endpoint(ctx, "deleteAccount"),
      { body: { confirmation: new URL(endpoint(ctx, "deleteAccount")).hostname, totp: wrong }, bearer: ctx.session.accessToken });
    expectProblem(res, 401, "invalid_code");
  } },
  { id: "deletion.last-owner", title: "The last owner can't delete themselves", run: async (ctx) => {
    if (!endpoint(ctx, "deleteAccount")) skip("deleteAccount is null");
    if (!ctx.config.mainIsLastOwner) skip("the test account isn't declared the last owner (--main-is-last-owner)");
    const res = await call(ctx, "POST", endpoint(ctx, "deleteAccount"),
      { body: { confirmation: new URL(endpoint(ctx, "deleteAccount")).hostname, totp: await ctx.codes() }, bearer: ctx.session.accessToken });
    expectProblem(res, 409, "last_owner");
  } },
  { id: "deletion.schedules", title: "Deleting a disposable account schedules it at least a day out and ends its sessions", destructive: true, run: async (ctx) => {
    if (!endpoint(ctx, "deleteAccount")) skip("deleteAccount is null");
    const d = ctx.config.disposable;
    if (!d) skip("no disposable account (--delete-email, --delete-password, --delete-totp-secret)");
    const codes = codeSource(d.totpSecret, { reuseAllowed: ctx.config.totpReuseAllowed });
    const session = await signIn(ctx, { email: d.email, password: d.password, codes });
    const res = await call(ctx, "POST", endpoint(ctx, "deleteAccount"),
      { body: { confirmation: new URL(endpoint(ctx, "deleteAccount")).hostname, totp: await codes() }, bearer: session.accessToken });
    expect(res.status === 202, `expected 202, got ${res.status}: ${res.text.slice(0, 200)}`);
    const grace = Date.parse(res.json?.graceUntil);
    expect(grace >= Date.now() + 23.9 * 3600 * 1000, `graceUntil ${res.json?.graceUntil} is less than a day away`);
    expect((await call(ctx, "GET", need(ctx, "me"), { bearer: session.accessToken })).status === 401, "the account's session still works");
  } },
];

/** Runs every check in order; answers [{id, title, status, detail, ms}]. */
export async function runChecks(config, { only, onResult = () => {} } = {}) {
  const ctx = { config, codes: config.totpSecret ? codeSource(config.totpSecret, { reuseAllowed: config.totpReuseAllowed }) : null };
  const results = [];
  for (const check of checks) {
    if (only && !only.some((prefix) => check.id.startsWith(prefix))) continue;
    const started = Date.now();
    let result;
    if (check.destructive && !config.destructive) {
      result = { status: "skip", detail: "destructive: run with --destructive" };
    } else {
      try {
        await check.run(ctx);
        result = { status: "pass" };
      } catch (error) {
        result = error instanceof Skip ? { status: "skip", detail: error.message }
          : { status: "fail", detail: error instanceof Failure ? error.message : `${error.name}: ${error.message}` };
      }
    }
    const entry = { id: check.id, title: check.title, ...result, ms: Date.now() - started };
    results.push(entry);
    onResult(entry);
  }
  return results;
}
