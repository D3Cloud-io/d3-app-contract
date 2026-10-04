#!/usr/bin/env node
// d3-app-conformance: checks a running D3 product against the D3 App contract.
//
//   node conformance/cli.mjs --base https://bindery.example.com --product bindery \
//     --email ci@example.com --password '…' --totp-secret JBSWY3DPEHPK3PXP [--junit report.xml]
//
// Every option can come from the environment instead: D3C_BASE, D3C_PRODUCT, D3C_EMAIL, D3C_PASSWORD,
// D3C_TOTP_SECRET, D3C_INVITE_TOKEN, D3C_DELETE_EMAIL, D3C_DELETE_PASSWORD, D3C_DELETE_TOTP_SECRET.
// Exit status: 0 when nothing failed, 1 when a check failed, 2 on bad usage.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runChecks } from "./checks.mjs";

const { values } = parseArgs({
  options: {
    base: { type: "string" }, product: { type: "string" },
    email: { type: "string" }, password: { type: "string" }, "totp-secret": { type: "string" },
    "invite-token": { type: "string" },
    "delete-email": { type: "string" }, "delete-password": { type: "string" }, "delete-totp-secret": { type: "string" },
    "main-is-last-owner": { type: "boolean" }, destructive: { type: "boolean" },
    "allow-http": { type: "boolean" }, "totp-reuse-allowed": { type: "boolean" },
    "relay-listen": { type: "string" }, "relay-public-url": { type: "string" },
    only: { type: "string" }, junit: { type: "string" }, help: { type: "boolean" },
  },
});
const env = process.env;
const pick = (name, key) => values[name] ?? env[key];

if (values.help || !pick("base", "D3C_BASE")) {
  console.log("usage: d3-app-conformance --base <url> --product <id> --email <e> --password <p> --totp-secret <base32>\n" +
    "       [--invite-token <t>] [--delete-email … --delete-password … --delete-totp-secret …]\n" +
    "       [--relay-listen <port> [--relay-public-url <url the product reaches it at>]]\n" +
    "       [--main-is-last-owner] [--destructive] [--allow-http] [--only manifest,signin] [--junit file.xml]");
  process.exit(values.help ? 0 : 2);
}
const base = pick("base", "D3C_BASE");
if (base.startsWith("http://") && !values["allow-http"]) {
  console.error("refusing http without --allow-http: the contract is https only; --allow-http is for a local CI instance");
  process.exit(2);
}
const deleteEmail = pick("delete-email", "D3C_DELETE_EMAIL");
const config = {
  base,
  product: pick("product", "D3C_PRODUCT"),
  email: pick("email", "D3C_EMAIL"),
  password: pick("password", "D3C_PASSWORD"),
  totpSecret: pick("totp-secret", "D3C_TOTP_SECRET"),
  inviteToken: pick("invite-token", "D3C_INVITE_TOKEN"),
  disposable: deleteEmail ? { email: deleteEmail, password: pick("delete-password", "D3C_DELETE_PASSWORD"),
    totpSecret: pick("delete-totp-secret", "D3C_DELETE_TOTP_SECRET") } : null,
  mainIsLastOwner: values["main-is-last-owner"] ?? false,
  destructive: values.destructive ?? false,
  allowHttp: values["allow-http"] ?? false,
  totpReuseAllowed: values["totp-reuse-allowed"] ?? false,
  relayListen: values["relay-listen"] ? Number(values["relay-listen"]) : undefined,
  relayPublicUrl: values["relay-public-url"],
};

const mark = { pass: "ok  ", fail: "FAIL", skip: "skip" };
const results = await runChecks(config, {
  only: values.only?.split(","),
  onResult: (r) => console.log(`${mark[r.status]}  ${r.id.padEnd(24)} ${r.title}${r.detail ? ` — ${r.detail}` : ""}`),
});
const failed = results.filter((r) => r.status === "fail").length;
const skipped = results.filter((r) => r.status === "skip").length;
console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);

if (values.junit) {
  const xml = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const cases = results.map((r) => `  <testcase classname="d3-app-contract" name="${xml(r.id)}" time="${r.ms / 1000}">` +
    (r.status === "fail" ? `<failure message="${xml(r.detail)}"/>` : r.status === "skip" ? `<skipped message="${xml(r.detail)}"/>` : "") + "</testcase>");
  writeFileSync(values.junit, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="d3-app-conformance" tests="${results.length}" failures="${failed}" skipped="${skipped}">\n${cases.join("\n")}\n</testsuite>\n`);
}
process.exit(failed > 0 ? 1 : 0);
