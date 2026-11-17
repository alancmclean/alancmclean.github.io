const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const base = process.env.PORTFOLIO_TEST_URL || "http://127.0.0.1:8787";
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (require("node:fs").existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : undefined),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const p = await context.newPage();
  let saves = 0,
    prepared;
  await p.route("**/__portfolio/status", (r) =>
    r.fulfill({
      json: { service: "portfolio-local-bridge-v1", canSave: true },
    }),
  );
  await p.route("**/__portfolio/prepare", (r) => {
    prepared = r.request().postDataJSON();
    assert.deepEqual(Object.keys(prepared), ["document"]);
    r.fulfill({
      json: { planId: "test-plan", summary: "Test-only review plan" },
    });
  });
  await p.route("**/__portfolio/save", (r) => {
    saves++;
    assert.deepEqual(r.request().postDataJSON(), {
      planId: "test-plan",
      confirmedPublic: true,
    });
    r.fulfill({
      json: {
        message: "Test save completed.",
        reviewURL:
          "https://github.com/alancmclean/alancmclean.github.io/compare/gh-pages...review/test",
      },
    });
  });
  await p.goto(base + "/portfolio/editor/#intro/base");
  await p.waitForSelector("#inspector:not([hidden])");
  await p.getByText("Prompt to edit", { exact: true }).click();
  await p
    .locator("#agent-prompt")
    .fill("PRIVATE TEST PROMPT — must not be persisted or sent to Git");
  await p.getByText("Storage & review", { exact: true }).click();
  await p.locator("#save-review").click();
  await p.locator("#confirm-save").click();
  assert.equal(saves, 0);
  assert.match(await p.locator("#save-result").textContent(), /Confirm/);
  await p.locator("#public-confirm").check();
  await p.locator("#confirm-save").click();
  await p.waitForFunction(() =>
    document
      .querySelector("#save-result")
      .textContent.includes("Test save completed"),
  );
  assert.equal(saves, 1);
  assert.ok(!JSON.stringify(prepared).includes("PRIVATE TEST"));
  await p.locator("#cancel-save").click();
  // An imported draft is a preview until explicitly applied.
  const data = await (
    await p.request.get(base + "/portfolio/presentation.json")
  ).json();
  const title =
    data.slides[0].root.children.find((n) => n.id === "intro-title") ||
    data.slides[0].root.children[0].children.find(
      (n) => n.id === "intro-title",
    );
  data.slides[0].states[0].overrides["intro-title"] = { x: 55 };
  await p
    .locator("#draft-file")
    .setInputFiles({
      name: "draft.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await p.locator("#preview-actions").waitFor({ state: "visible" });
  assert.equal(
    await p.evaluate(() =>
      localStorage.getItem("alan-portfolio-editor:draft:v1"),
    ),
    null,
  );
  await p.locator("#apply-preview").click();
  assert.equal(
    await p.locator("#intro-title").evaluate((e) => e.style.translate),
    "55px",
  );
  assert.ok(
    !(
      await p.evaluate(() =>
        localStorage.getItem("alan-portfolio-editor:draft:v1"),
      )
    ).includes("PRIVATE TEST"),
  );
  // Other-tab changes pause persistence until explicitly resolved.
  const other = await context.newPage();
  await other.goto(base + "/portfolio/");
  await other.evaluate(() => {
    const key = "alan-portfolio-editor:draft:v1",
      data = JSON.parse(localStorage.getItem(key));
    data.document.revision++;
    localStorage.setItem(key, JSON.stringify(data));
  });
  await p.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("Another tab"),
  );
  assert.ok(await p.locator("#save-review").isDisabled());
  await p.locator("#load-other-tab").click();
  assert.match(await p.locator("#draft-status").textContent(), /Loaded/);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator("#close-editor").click();
  await p.goto(base + "/portfolio/#experience/context");
  await p.waitForSelector("#state-label");
  await p.locator("#main").evaluate((el) => {
    el.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        touches: [
          new Touch({ identifier: 1, target: el, clientX: 300, clientY: 300 }),
        ],
      }),
    );
    el.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        changedTouches: [
          new Touch({ identifier: 1, target: el, clientX: 80, clientY: 302 }),
        ],
      }),
    );
  });
  assert.match(await p.locator("#state-label").textContent(), /Refine/);
  await p.locator("#next-chapter").click();
  assert.equal(
    await p.locator(".scene.active").getAttribute("id"),
    "perspective",
  );
  await p.goto(base + "/portfolio/editor/#experience/refine");
  await p.waitForSelector("#inspector:not([hidden])");
  assert.ok(await p.locator("#close-editor").isVisible());
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await browser.close();
  console.log(
    "PASS editor workflow: save confirmation, data-only payload, no real push, draft import preview/apply, prompt privacy, cross-tab conflict, mobile touch states and slide controls.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
