import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBridge } from "../tools/editor-server.mjs";
const repoRoot = path.resolve(new URL("../../", import.meta.url).pathname),
  doc = JSON.parse(
    await readFile(new URL("../presentation.json", import.meta.url)),
  );
test("local bridge origin protection, validation, narrow save and idempotency", async (t) => {
  const calls = [];
  const git = async (args, cwd) => {
    calls.push(args);
    if (args[0] === "remote")
      return "https://github.com/alancmclean/alancmclean.github.io.git";
    if (args[0] === "rev-parse") return "a".repeat(40);
    if (args[0] === "status") return "";
    if (args[0] === "worktree" && args[1] === "add")
      await mkdir(path.join(args[3], "portfolio"), { recursive: true });
    if (args[0] === "diff") return "portfolio/presentation.json";
    return "";
  };
  const bridge = createBridge({ repoRoot, git });
  const origin = await bridge.listen(0);
  t.after(() => new Promise((r) => bridge.server.close(r)));
  const landing = await fetch(origin + "/portfolio/editor/");
  assert.equal(landing.status, 200);
  const cookie = landing.headers.get("set-cookie").split(";")[0];
  assert.match(landing.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const headers = {
    "Content-Type": "application/json",
    Origin: origin,
    Cookie: cookie,
  };
  const post = (endpoint, data, extra = {}) =>
    fetch(origin + "/__portfolio/" + endpoint, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(data),
    });
  assert.equal(
    (await post("prepare", { document: doc }, { Origin: "https://evil.test" }))
      .status,
    403,
  );
  assert.equal(
    (await post("prepare", { document: doc }, { Cookie: "" })).status,
    403,
  );
  assert.equal(
    (await fetch(origin + "/portfolio/tools/editor-server.mjs")).status,
    404,
  );
  assert.equal(
    (await post("prepare", { document: doc, prompt: "do not publish" })).status,
    400,
  );
  const invalid = structuredClone(doc);
  invalid.slides[0].root.attrs.onclick = "evil";
  assert.equal((await post("prepare", { document: invalid })).status, 400);
  const plan = await (await post("prepare", { document: doc })).json();
  assert.match(plan.branch, /^review\/portfolio-data-/);
  assert.equal(
    (await post("save", { planId: plan.planId, confirmedPublic: false }))
      .status,
    400,
  );
  const first = await (
    await post("save", { planId: plan.planId, confirmedPublic: true })
  ).json();
  const second = await (
    await post("save", { planId: plan.planId, confirmedPublic: true })
  ).json();
  assert.deepEqual(first, second);
  assert.equal(calls.filter((c) => c[0] === "push").length, 1);
  assert.match(first.reviewURL, /compare\/gh-pages\.\.\.review/);
  assert.deepEqual(
    calls.find((c) => c[0] === "add"),
    ["add", "--", "portfolio/presentation.json"],
  );
  assert.ok(
    !calls.some(
      (c) =>
        c.includes("gh-pages") || (c.includes("--force") && c[0] === "push"),
    ),
  );
});
test("uncertain pushes inspect exact target and never automatically repeat", async (t) => {
  let pushes = 0,
    lookups = 0;
  const git = async (args) => {
    if (args[0] === "remote")
      return "https://github.com/alancmclean/alancmclean.github.io.git";
    if (args[0] === "rev-parse") return "b".repeat(40);
    if (args[0] === "status") return "";
    if (args[0] === "worktree" && args[1] === "add")
      await mkdir(path.join(args[3], "portfolio"), { recursive: true });
    if (args[0] === "diff") return "portfolio/presentation.json";
    if (args[0] === "push") {
      pushes++;
      throw Error("network");
    }
    if (args[0] === "ls-remote") {
      lookups++;
      throw Error("network");
    }
    return "";
  };
  const bridge = createBridge({ repoRoot, git });
  const origin = await bridge.listen(0);
  t.after(() => new Promise((r) => bridge.server.close(r)));
  const landing = await fetch(origin + "/portfolio/editor/");
  const headers = {
    "Content-Type": "application/json",
    Origin: origin,
    Cookie: landing.headers.get("set-cookie").split(";")[0],
  };
  const post = (p, d) =>
    fetch(origin + "/__portfolio/" + p, {
      method: "POST",
      headers,
      body: JSON.stringify(d),
    });
  const plan = await (await post("prepare", { document: doc })).json();
  for (let i = 0; i < 2; i++) {
    const response = await post("save", {
      planId: plan.planId,
      confirmedPublic: true,
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /uncertain/);
  }
  assert.equal(pushes, 1);
  assert.equal(lookups, 1);
});
