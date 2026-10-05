// The suite tests itself: against the reference product every check passes, and each deliberately
// broken promise fails the check that guards it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runChecks } from "../conformance/checks.mjs";
import { ACCOUNTS, INVITE_TOKEN, startReference } from "../reference/server.mjs";

async function suite(broken = [], extra = {}, product = "bindery") {
  const server = await startReference({ broken: new Set(broken), product });
  try {
    const { owner, member } = ACCOUNTS;
    return await runChecks({
      base: server.base, product, email: owner.email, password: owner.password, totpSecret: owner.totpSecret,
      allowHttp: true, totpReuseAllowed: true, destructive: true, mainIsLastOwner: true, inviteToken: INVITE_TOKEN,
      disposable: { email: member.email, password: member.password, totpSecret: member.totpSecret },
      relayListen: 18_000 + Math.floor(Math.random() * 2000), ...extra,
    });
  } finally {
    await server.close();
  }
}

const statusOf = (results, id) => results.find((r) => r.id === id)?.status;

describe("conformance suite", () => {
  it("passes a conforming product, every check run", async () => {
    const results = await suite();
    const bad = results.filter((r) => r.status !== "pass");
    assert.deepEqual(bad, [], JSON.stringify(bad, null, 2));
  });

  for (const [broken, check] of [
    ["product", "manifest.product"],
    ["problem-type", "signin.wrong-password"],
    ["reuse", "refresh.reuse-revokes"],
    ["revoke", "revoke.ends-session"],
    ["invite", "invite.accept"],
    ["relay", "relay.register"],
    ["relay-plaintext", "relay.delivers"],
  ]) {
    it(`catches a product that breaks "${broken}" in ${check}`, async () => {
      const results = await suite([broken]);
      assert.equal(statusOf(results, check), "fail", JSON.stringify(results.find((r) => r.id === check)));
    });
  }

  it("skips what a server doesn't offer, and destructive checks unless asked", async () => {
    const results = await suite([], { destructive: false, inviteToken: undefined });
    assert.equal(statusOf(results, "signin.throttled"), "skip");
    assert.equal(statusOf(results, "deletion.schedules"), "skip");
    assert.equal(statusOf(results, "invite.unknown-token"), "pass");
  });

  it("passes D3 Auth, which signs in through the browser, and skips the native session checks", async () => {
    const results = await suite([], {}, "d3auth");
    for (const id of ["manifest.served", "manifest.schema", "manifest.product", "manifest.one-host", "me.unauthenticated"]) {
      assert.equal(statusOf(results, id), "pass", `${id}: ${JSON.stringify(results.find((r) => r.id === id))}`);
    }
    for (const id of ["signin.wrong-password", "signin.wrong-code", "signin.session", "signin.throttled", "refresh.rotates", "revoke.ends-session"]) {
      assert.equal(statusOf(results, id), "skip", id);
    }
    assert.deepEqual(results.filter((r) => r.status === "fail"), []);
  });
});
