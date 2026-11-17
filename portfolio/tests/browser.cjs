const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const wait = () => page.waitForTimeout(250);
  const active = () => page.locator(".scene.active").getAttribute("id");
  await page.goto(base + "/portfolio/");
  await page.waitForSelector(".scene.active[data-element-id]");
  assert.equal(await active(), "intro");
  await page.keyboard.press("ArrowDown");
  assert.equal(await active(), "docs");
  await page.keyboard.press("ArrowDown");
  assert.equal(await active(), "experience");
  await page.keyboard.press("ArrowRight");
  assert.match(await page.locator("#state-label").textContent(), /Refine/);
  await page.keyboard.press("ArrowRight");
  assert.match(
    await page.locator("#approval-status").textContent(),
    /accepted/,
  );
  await page.keyboard.press("ArrowLeft");
  assert.match(
    await page.locator("#approval-status").textContent(),
    /Only visible/,
  );
  await page.locator("#approve").click();
  assert.match(await page.locator("#state-label").textContent(), /accepted/);
  await page.locator("#approve").click();
  assert.match(await page.locator("#state-label").textContent(), /Refine/);
  await page.keyboard.press("ArrowUp");
  assert.equal(await active(), "docs");
  // A double click on content must not enter editing. Background does.
  await page.locator("#docs-title").dblclick();
  assert.ok(!page.url().includes("/editor/"));
  await page.locator("#main").dblclick({ position: { x: 10, y: 95 } });
  await page.waitForURL("**/editor/**");
  await page.waitForSelector("#inspector:not([hidden])");
  await page.locator("#close-editor").click();
  await page.locator("#docs-title").dblclick();
  assert.ok(await page.locator("#inspector").isHidden());
  await page.locator("#main").dblclick({ position: { x: 10, y: 95 } });
  assert.ok(await page.locator("#inspector").isVisible());
  await page.locator("#element-select").selectOption("docs-title");
  await page.locator("#prop-x").fill("24");
  await page.locator("#prop-x").press("Tab");
  assert.equal(
    await page.locator("#docs-title").evaluate((e) => e.style.translate),
    "24px",
  );
  const before = page.url();
  await page.locator("#state-name").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  assert.equal(page.url(), before);
  await page.reload();
  await page.waitForSelector("#inspector:not([hidden])");
  assert.equal(
    await page.locator("#docs-title").evaluate((e) => e.style.translate),
    "24px",
  );
  await page.locator("#add-state").click();
  assert.equal(await page.locator("#state-select option").count(), 2);
  await page.locator("#element-select").selectOption("docs-title");
  await page.locator("#prop-x").fill("48");
  await page.locator("#prop-x").press("Tab");
  await page.locator("#state-select").selectOption("base");
  assert.equal(
    await page.locator("#docs-title").evaluate((e) => e.style.translate),
    "24px",
  );
  // Agent patches are previewed independently of persistent drafts; stale/cross-slide patches fail.
  await page.getByText("Prompt to edit", { exact: true }).click();
  const draft = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("alan-portfolio-editor:draft:v1"))
        .document,
  );
  const patch = {
    schemaVersion: 1,
    presentationId: draft.id,
    baseRevision: draft.revision,
    slideId: "docs",
    stateId: "base",
    operations: [
      { elementId: "docs-title", changes: { y: 30, animation: "rise" } },
    ],
  };
  await page
    .locator("#patch-input")
    .fill(JSON.stringify({ ...patch, baseRevision: 0 }));
  await page.locator("#preview-patch").click();
  assert.match(await page.locator("#draft-status").textContent(), /stale/);
  await page
    .locator("#patch-input")
    .fill(
      JSON.stringify({
        ...patch,
        operations: [{ elementId: "intro", changes: { x: 20 } }],
      }),
    );
  await page.locator("#preview-patch").click();
  assert.match(await page.locator("#draft-status").textContent(), /outside/);
  await page.locator("#patch-input").fill(JSON.stringify(patch));
  await page.locator("#preview-patch").click();
  assert.equal(
    await page.locator("#docs-title").evaluate((e) => e.style.translate),
    "24px 30px",
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("alan-portfolio-editor:draft:v1"))
          .document.revision,
    ),
    draft.revision,
  );
  await page.locator("#cancel-preview").click();
  assert.equal(
    await page.locator("#docs-title").evaluate((e) => e.style.translate),
    "24px",
  );
  await page.locator("#preview-patch").click();
  await page.locator("#apply-preview").click();
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("alan-portfolio-editor:draft:v1"))
          .document.revision,
    ),
    draft.revision + 1,
  );
  // Published viewer ignores the same origin's private browser draft.
  await page.goto(base + "/portfolio/#docs");
  await page.waitForSelector(".scene.active[data-element-id]");
  assert.equal(
    await page.locator("#docs-title").evaluate((e) => e.style.translate),
    "",
  );
  for (const [width, height] of [
    [1212, 799],
    [390, 844],
    [320, 568],
  ]) {
    await page.setViewportSize({ width, height });
    for (const id of [
      "intro",
      "docs",
      "experience",
      "perspective",
      "next",
      "close",
    ]) {
      await page.goto(base + "/portfolio/#" + id);
      await page.waitForSelector(".scene.active[data-element-id]");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `Page overflow ${id} ${width}`,
      );
      const bounds = await page
        .locator(".scene.active")
        .evaluate((e) => ({
          w: e.clientWidth,
          sw: e.scrollWidth,
          h: e.clientHeight,
          sh: e.scrollHeight,
        }));
      assert.ok(
        bounds.sw <= bounds.w + 1,
        `Scene overflow ${id} ${width}: ${JSON.stringify(bounds)}`,
      );
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base + "/portfolio/editor/#docs/base");
  await page.waitForSelector("#inspector:not([hidden])");
  await page.locator("#close-editor").click();
  assert.equal(
    await page.locator("#docs-title").evaluate((e) => e.getAnimations().length),
    0,
  );
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "PASS browser: slide/state arrows, edit backdrop, form keys, inspector overrides, state isolation, persistence, preview/apply validation, public draft isolation, 18 responsive scenes, reduced motion; no JS errors.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
