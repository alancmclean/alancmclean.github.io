const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const base = process.env.PORTFOLIO_TEST_URL || "http://127.0.0.1:8000";
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    defaultBrowserType: undefined,
    acceptDownloads: true,
  });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", { value: undefined }),
  );
  await p.goto(base + "/portfolio/editor/#docs/base");
  await p.waitForSelector("#inspector:not([hidden])");
  await p.getByText("Storage & review", { exact: true }).tap();
  assert.ok(await p.locator("#save-review").isDisabled());
  assert.match(
    await p.locator("#bridge-status").textContent(),
    /not connected/,
  );
  await p.locator("#element-select").selectOption("docs-title");
  await p.locator("#prop-x").fill("12");
  await p.locator("#prop-y").tap();
  assert.equal(
    await p.locator("#docs-title").evaluate((e) => e.style.translate),
    "12px",
  );
  await p.locator("#add-state").tap();
  assert.equal(await p.locator("#state-select option").count(), 2);
  await p.reload();
  await p.waitForSelector("#inspector:not([hidden])");
  assert.equal(await p.locator("#state-select option").count(), 2);
  assert.equal(
    await p.locator("#docs-title").evaluate((e) => e.style.translate),
    "12px",
  );
  await p.getByText("Storage & review", { exact: true }).tap();
  const download = await Promise.all([
    p.waitForEvent("download"),
    p.locator("#export-draft").tap(),
  ]);
  const filepath = await download[0].path();
  const data = JSON.parse(fs.readFileSync(filepath, "utf8"));
  assert.equal(data.slides[1].states.length, 2);
  await p
    .locator("#draft-file")
    .setInputFiles({
      name: "draft.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await p.locator("#preview-actions").waitFor({ state: "visible" });
  await p.locator("#apply-preview").tap();
  await p.locator("#close-editor").tap();
  await p.locator("#next-chapter").tap();
  assert.equal(
    await p.locator(".scene.active").getAttribute("id"),
    "experience",
  );
  await p.locator("#state-next").tap();
  assert.match(await p.locator("#state-label").textContent(), /Refine/);
  await p.goto(base + "/portfolio/#docs");
  await p.waitForSelector(".scene.active[data-element-id]");
  assert.equal(
    await p.locator("#docs-title").evaluate((e) => e.style.translate),
    "",
  );
  await p.locator("#edit-toggle").tap();
  await p.waitForSelector("#inspector:not([hidden])");
  assert.equal(
    await p.locator("#docs-title").evaluate((e) => e.style.translate),
    "12px",
  );
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "PASS hosted mobile emulation: direct editor, touch controls, no randomUUID dependency, local persistence, export/import, Git save disabled, public/draft isolation.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
