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
    viewport: { width: 1440, height: 1000 },
  });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const draft = () =>
    p.evaluate(
      () =>
        JSON.parse(localStorage.getItem("alan-portfolio-editor:draft:v1"))
          .document,
    );
  const state = (d) => d.slides[0].states[0];
  await p.goto(base + "/portfolio/editor/#intro/base");
  await p.waitForSelector("#canvas-bar:not([hidden])");
  await p.locator("#canvas-inspector").click();
  const text = p.locator("#intro .intro [data-element-type=text]").first();
  const id = await text.getAttribute("id"),
    original = await text.textContent();
  await text.click();
  assert.equal(await text.getAttribute("contenteditable"), "true");
  await text.press("End");
  await p.keyboard.type(" Edited");
  assert.equal(await text.textContent(), original + " Edited");
  assert.equal(state(await draft()).overrides[id].text, original + " Edited");
  await text.press("ArrowLeft");
  assert.equal(await p.locator(".scene.active").getAttribute("id"), "intro");
  await text.evaluate((el) => el.blur());
  const before = (await draft()).revision;
  const grip = p.locator("[data-handle=move]"),
    gb = await grip.boundingBox();
  await p.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await p.mouse.down();
  await p.mouse.move(gb.x + gb.width / 2 + 100, gb.y + gb.height / 2 + 60, {
    steps: 8,
  });
  await p.mouse.up();
  let d = await draft();
  assert.equal(d.revision, before + 1, "one undo step per drag");
  let f = state(d).overrides[id].frame;
  assert.ok(f);
  assert.equal(await p.locator(".alignment-guide").count(), 0);
  const frameBefore = { ...f };
  const se = p.locator("[data-handle=se]"),
    sb = await se.boundingBox();
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await p.mouse.down();
  await p.mouse.move(sb.x + sb.width / 2 + 80, sb.y + sb.height / 2 + 30, {
    steps: 5,
  });
  await p.mouse.up();
  f = state(await draft()).overrides[id].frame;
  assert.ok(
    Math.abs(f.width / f.height - frameBefore.width / frameBefore.height) <
      0.001,
    "locked aspect",
  );
  const locked = { ...f },
    sb2 = await se.boundingBox();
  await p.keyboard.down("Shift");
  await p.mouse.move(sb2.x + sb2.width / 2, sb2.y + sb2.height / 2);
  await p.mouse.down();
  await p.mouse.move(sb2.x + sb2.width / 2 + 50, sb2.y + sb2.height / 2, {
    steps: 4,
  });
  await p.mouse.up();
  await p.keyboard.up("Shift");
  f = state(await draft()).overrides[id].frame;
  assert.ok(
    Math.abs(f.width / f.height - locked.width / locked.height) > 0.05,
    "Shift unlocks proportions",
  );
  const rb = await p.locator("[data-handle=rotate]").boundingBox(),
    tb = await p.locator("#canvas-tools").boundingBox();
  await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await p.mouse.down();
  await p.mouse.move(tb.x + tb.width + 35, tb.y + tb.height / 2, { steps: 7 });
  await p.mouse.up();
  const rotated = state(await draft()).overrides[id].frame;
  assert.ok(Math.abs(rotated.angle) > 30);
  await p.keyboard.press("Control+z");
  assert.ok(
    Math.abs(state(await draft()).overrides[id].frame.angle) < 0.1,
    "undo rotation",
  );
  // Guides show proximity only and disappear at pointer-up; no snapping.
  const current = state(await draft()).overrides[id].frame;
  const r = await p.locator("#intro").boundingBox(),
    g = await grip.boundingBox(),
    dx = ((50 - current.x) * r.width) / 100 + 2;
  await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await p.mouse.down();
  await p.mouse.move(g.x + g.width / 2 + dx, g.y + g.height / 2, { steps: 5 });
  assert.ok((await p.locator(".alignment-guide").count()) > 0);
  await p.mouse.up();
  assert.equal(await p.locator(".alignment-guide").count(), 0);
  assert.ok(
    Math.abs(state(await draft()).overrides[id].frame.x - 50) > 0.01,
    "guide does not snap",
  );
  // Drop raster data at an exact canvas point. No network upload.
  const point = { x: r.x + r.width * 0.7, y: r.y + r.height * 0.45 };
  await p.locator("#main").evaluate((el, point) => {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 120;
    c.getContext("2d").fillRect(0, 0, 240, 120);
    const b = Uint8Array.from(
      atob(c.toDataURL("image/png").split(",")[1]),
      (x) => x.charCodeAt(0),
    );
    const dt = new DataTransfer();
    dt.items.add(new File([b], "sample.png", { type: "image/png" }));
    el.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        dataTransfer: dt,
        clientX: point.x,
        clientY: point.y,
      }),
    );
  }, point);
  await p.waitForFunction(() =>
    document.querySelector(".active img[data-element-type=image]"),
  );
  d = await draft();
  const image = d.slides[0].root.children.find((n) => n.type === "image");
  assert.ok(image);
  assert.ok(Math.abs(state(d).overrides[image.id].frame.x - 70) < 1);
  assert.ok(d.assets[image.assetId].data.startsWith("data:image/"));
  const saved = JSON.stringify(d);
  await p.reload();
  await p.waitForSelector(".active img[data-element-type=image]");
  assert.equal(
    (await draft()).assets[image.assetId].data,
    d.assets[image.assetId].data,
  );
  await p.locator("#canvas-inspector").click();
  // A touch-friendly image picker adds a separately configured slide background.
  const png = Buffer.from(
    await p.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 20;
      c.height = 10;
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  await p.locator("#canvas-background").click();
  await p
    .locator('input[accept="image/png,image/jpeg,image/webp"]')
    .setInputFiles({ name: "bg.png", mimeType: "image/png", buffer: png });
  await p.waitForSelector(".active .slide-background");
  assert.equal(state(await draft()).background.fit, "cover");
  // Export/import includes both the added raster and background; invalid raster inputs stay local and fail closed.
  await p.locator("#canvas-inspector").click();
  await p.locator("summary").filter({ hasText: "Storage & review" }).click();
  const downloadPromise = p.waitForEvent("download");
  await p.locator("#export-draft").click();
  const downloaded = await downloadPromise;
  const exported = JSON.parse(fs.readFileSync(await downloaded.path(), "utf8"));
  assert.ok(exported.assets[image.assetId]);
  assert.ok(state(exported).background);
  await p.locator("#draft-file").setInputFiles({
    name: "roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await p.locator("#apply-preview").click();
  assert.deepEqual((await draft()).assets, exported.assets);
  assert.deepEqual(state(await draft()).background, state(exported).background);
  const rejected = await p.evaluate(async () => {
    const { importImage } = await import("/portfolio/editor/canvas.mjs");
    try {
      await importImage(
        new File(['<svg onload="alert(1)"></svg>'], "fake.png", {
          type: "image/png",
        }),
      );
      return false;
    } catch (e) {
      return /bytes/.test(e.message);
    }
  });
  assert.ok(rejected);
  await p.locator("#canvas-inspector").click();
  await p.screenshot({ path: "/tmp/portfolio-canvas-desktop.png" });
  await p.locator(".active img[data-element-type=image]").click();
  await p.locator("#canvas-inspector").click();
  const fx = p.locator('[id="prop-frame.x"]');
  await fx.fill("65");
  await fx.dispatchEvent("change");
  assert.equal(
    state(await draft()).overrides[image.id].frame.x,
    65,
    "inspector edits the free frame",
  );
  await p.locator("#canvas-inspector").click();
  assert.ok(
    await p.evaluate(async () => {
      const { renderCanvasLayout } =
        await import("/portfolio/runtime/canvas-layout.mjs");
      const r = document.createElement("div"),
        parent = document.createElement("div"),
        child = document.createElement("span");
      parent.hidden = true;
      child.dataset.frame = JSON.stringify({
        x: 50,
        y: 50,
        width: 20,
        height: 20,
        angle: 0,
        naturalWidth: 10,
        naturalHeight: 10,
      });
      parent.append(child);
      r.append(parent);
      renderCanvasLayout(r, {}, {}, {});
      return r.querySelector(".free-frame").hidden;
    }),
    "free placement preserves ancestor visibility",
  );
  const frameAtDesktop = state(await draft()).overrides[image.id].frame;
  await p.setViewportSize({ width: 900, height: 700 });
  await p.waitForTimeout(200);
  assert.deepEqual(
    state(await draft()).overrides[image.id].frame,
    frameAtDesktop,
    "resize does not mutate normalized data",
  );
  await p.goto(base + "/portfolio/#intro");
  await p.waitForSelector(".scene.active[data-element-id]");
  assert.equal(await p.locator("img[data-element-type=image]").count(), 0);
  assert.equal(await p.locator("#" + id).textContent(), original);
  assert.deepEqual(errors, []);
  await context.close();
  const mobile = await browser.newContext({
    ...devices["iPhone 13"],
    defaultBrowserType: undefined,
  });
  const m = await mobile.newPage();
  await m.goto(base + "/portfolio/editor/#intro/base");
  await m.waitForSelector("#canvas-bar:not([hidden])");
  await m.locator("#canvas-inspector").tap();
  const mt = m.locator("#intro .intro [data-element-type=text]").first();
  await mt.tap();
  await mt.press("End");
  await m.keyboard.type(" Mobile");
  assert.match(await mt.textContent(), /Mobile/);
  await mt.evaluate((el) => el.blur());
  const mg = await m.locator("[data-handle=move]").boundingBox();
  const cdp = await mobile.newCDPSession(m);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: mg.x + 10, y: mg.y + 10 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: mg.x + 50, y: mg.y + 35 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.ok(await m.locator(".free-frame").count());
  assert.equal(await m.locator(".alignment-guide").count(), 0); // Touch corner resize and rotation use the same pointer path as desktop.
  for (const [handle, dx, dy] of [
    ["se", 35, 25],
    ["rotate", 30, 20],
  ]) {
    const b = await m.locator("[data-handle=" + handle + "]").boundingBox();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await m.screenshot({ path: "/tmp/portfolio-canvas-mobile.png" });
  await browser.close();
  console.log(
    "PASS canvas: inline caret/text persistence; free drag; one undo per gesture; locked/Shift-free corner scaling; rotation/undo; non-snapping ephemeral guides; image drop/reload/background; normalized resize; public isolation; touch text/drag.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
