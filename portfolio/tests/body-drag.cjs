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
  for (const legacy of [false, true]) {
    const c = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      p = await c.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/portfolio/editor/#intro/base");
    await p.waitForSelector("#canvas-bar:not([hidden])");
    if (legacy) {
      await p.evaluate(async () => {
        const doc = await (await fetch("../presentation.json")).json(),
          fingerprint = JSON.stringify(doc);
        doc.revision = 7;
        const n = document.querySelector(
          "#intro .intro [data-element-type=text]",
        );
        doc.slides[0].states[0].overrides[n.id] = {
          text: "Saved legacy draft text",
          x: 18,
          scale: 1.1,
        };
        localStorage.setItem(
          "alan-portfolio-editor:draft:v1",
          JSON.stringify({
            format: 1,
            baseFingerprint: fingerprint,
            savedAt: new Date().toISOString(),
            document: doc,
          }),
        );
      });
      await p.reload();
      await p.waitForSelector("#canvas-bar:not([hidden])");
    }
    await p.locator("#canvas-inspector").click();
    const t = p.locator("#intro .intro [data-element-type=text]").first(),
      id = await t.getAttribute("id");
    const read = () =>
      p.evaluate(
        () =>
          JSON.parse(localStorage.getItem("alan-portfolio-editor:draft:v1"))
            ?.document,
      );
    const drag = async (el, dx = 85, dy = 45) => {
      const b = await el.boundingBox(),
        x = b.x + Math.min(35, b.width / 2),
        y = b.y + b.height / 2;
      assert.equal(
        await p.evaluate(
          ({ x, y }) =>
            !!document.elementFromPoint(x, y)?.closest("[data-element-id]"),
          { x, y },
        ),
        true,
      );
      await p.mouse.move(x, y);
      await p.mouse.down();
      await p.mouse.move(x + dx, y + dy, { steps: 12 });
      await p.mouse.up();
    };
    const initial = await t.boundingBox();
    await drag(t);
    let d = await read();
    assert.ok(
      d?.slides[0].states[0].overrides[id]?.frame,
      "immediate body drag must place text",
    );
    const after = await p.locator("#" + id).boundingBox();
    assert.ok(Math.abs(after.x - initial.x - 85) < 3);
    assert.ok(Math.abs(after.y - initial.y - 45) < 3);
    assert.equal(d.revision, legacy ? 8 : 2, "one revision per gesture");
    if (legacy)
      assert.equal(
        d.slides[0].states[0].overrides[id].text,
        "Saved legacy draft text",
      );
    // A stationary click starts caret editing; an active text selection drag stays native.
    const text = p.locator("#" + id);
    await text.click({ position: { x: 25, y: 10 } });
    assert.equal(
      await text.evaluate((e) => document.activeElement === e),
      true,
    );
    const frame = JSON.stringify(
      (await read()).slides[0].states[0].overrides[id].frame,
    );
    await drag(text, 65, 0);
    assert.equal(
      JSON.stringify((await read()).slides[0].states[0].overrides[id].frame),
      frame,
    );
    assert.ok(
      await p.evaluate(() => getSelection().toString().length > 0),
      "active text remains selectable",
    );
    await p.keyboard.type("Caret edit");
    await text.evaluate((e) => e.blur());
    await drag(text, 30, 15);
    assert.notEqual(
      JSON.stringify((await read()).slides[0].states[0].overrides[id].frame),
      frame,
    );
    const moved = (await read()).revision;
    await p.keyboard.press("Control+z");
    assert.equal((await read()).revision, moved + 1);
    assert.equal(
      JSON.stringify((await read()).slides[0].states[0].overrides[id].frame),
      frame,
    );
    assert.equal(await p.locator(".alignment-guide").count(), 0);
    // Real image body, first unselected and then selected, without handle targeting.
    const png = Buffer.from(
      await p.evaluate(() => {
        const x = document.createElement("canvas");
        x.width = 180;
        x.height = 100;
        return x.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    );
    await p.locator("#canvas-add-image").click();
    await p
      .locator('input[accept="image/png,image/jpeg,image/webp"]')
      .setInputFiles({ name: "drag.png", mimeType: "image/png", buffer: png });
    const img = p.locator(".active img[data-element-type=image]");
    await img.waitFor();
    const imageId = await img.getAttribute("id");
    await p.locator("#canvas-inspector").click();
    await p.locator("#element-select").selectOption("intro");
    await p.locator("#canvas-inspector").click();
    await drag(img, 90, -25);
    const first = (await read()).slides[0].states[0].overrides[imageId].frame;
    await img.click();
    await drag(img, 40, 20);
    const second = (await read()).slides[0].states[0].overrides[imageId].frame;
    assert.ok(second.x > first.x);
    await p.reload();
    await p.waitForSelector(".active img[data-element-type=image]");
    assert.deepEqual(
      (await read()).slides[0].states[0].overrides[imageId].frame,
      second,
    );
    assert.deepEqual(errors, []);
    await c.close();
  }
  const c = await browser.newContext({ ...devices["iPhone 13"] }),
    p = await c.newPage();
  await p.goto(base + "/portfolio/editor/#intro/base");
  await p.waitForSelector("#canvas-bar:not([hidden])");
  await p.locator("#canvas-inspector").tap();
  const t = p.locator("#intro .intro [data-element-type=text]").first(),
    id = await t.getAttribute("id"),
    b = await t.boundingBox(),
    cdp = await c.newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: b.x + 25, y: b.y + 10 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: b.x + 65, y: b.y + 40 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.ok(await p.locator("#" + id).getAttribute("data-frame"));
  await p.locator("#" + id).tap();
  assert.equal(
    await p.locator("#" + id).evaluate((e) => e === document.activeElement),
    true,
  );
  await browser.close();
  console.log(
    "PASS body drag: unselected text and image, selected image, caret/native selection, blur then drag, undo/autosave/reload, saved legacy drafts, direct touch drag/tap.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
