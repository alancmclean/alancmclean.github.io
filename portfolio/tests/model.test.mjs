import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateDocument,
  applyPatch,
  contextFor,
  flatten,
  readDraft,
  writeDraft,
  DRAFT_KEY,
} from "../runtime/model.mjs";
const doc = JSON.parse(
  await readFile(new URL("../presentation.json", import.meta.url)),
);
const patch = (changes, slide = doc.slides[0], element = slide.root.id) => ({
  schemaVersion: 1,
  presentationId: doc.id,
  baseRevision: doc.revision,
  slideId: slide.id,
  stateId: slide.states[0].id,
  operations: [{ elementId: element, changes }],
});
test("migrated content has six slides, four Docs states and unique typed elements", () => {
  validateDocument(doc);
  assert.equal(doc.slides.length, 6);
  assert.equal(doc.slides[2].states.length, 4);
  assert.ok(
    flatten(doc.slides[0].root).some((n) =>
      n.text?.includes("Google DeepMind"),
    ),
  );
});
test("state edits are immutable, scoped and revisioned", () => {
  const result = applyPatch(
    doc,
    patch({ x: 37, scale: 1.1, animation: "rise" }),
  );
  assert.equal(result.revision, doc.revision + 1);
  assert.equal(result.slides[0].states[0].overrides.intro.x, 37);
  assert.deepEqual(doc.slides[0].states[0].overrides, {});
  assert.deepEqual(doc.slides[1], result.slides[1]);
});
test("reject stale, cross-slide, executable, nonfinite and unsupported edits", () => {
  for (const value of [
    { x: Infinity },
    { scale: 99 },
    { animation: "javascript" },
    { style: "color:red" },
    { __proto__: null },
  ])
    assert.throws(() => applyPatch(doc, patch(value)));
  const p = patch({ x: 1 });
  p.baseRevision++;
  assert.throws(() => applyPatch(doc, p));
  p.baseRevision = doc.revision;
  p.operations[0].elementId = "docs";
  assert.throws(() => applyPatch(doc, p));
  const link = flatten(doc.slides[0].root).find((n) => n.type === "link");
  assert.throws(() =>
    applyPatch(
      doc,
      patch({ href: "javascript:alert(1)" }, doc.slides[0], link.id),
    ),
  );
  assert.throws(() =>
    applyPatch(doc, patch({ href: "//evil.test" }, doc.slides[0], link.id)),
  );
});
test("reject untrusted document attributes, versions and prototype keys", () => {
  for (const change of [
    (d) => (d.schemaVersion = 9),
    (d) => (d.slides[0].root.attrs.onclick = "alert(1)"),
    (d) => (d.slides[0].root.children[0].id = "docs"),
    (d) =>
      (d.slides[0].states[0].overrides = JSON.parse('{"__proto__":{"x":2}}')),
  ]) {
    const copy = structuredClone(doc);
    change(copy);
    assert.throws(() => validateDocument(copy));
  }
});
test("draft round trip, corrupt recovery, quota failure and changed base", () => {
  const data = new Map();
  const storage = {
    getItem: (k) => data.get(k) || null,
    setItem: (k, v) => data.set(k, v),
  };
  const edited = applyPatch(doc, patch({ x: 12 }));
  writeDraft(storage, edited, doc);
  assert.deepEqual(readDraft(storage, doc).document, edited);
  const changed = structuredClone(doc);
  changed.title += " updated";
  assert.throws(() => readDraft(storage, changed));
  const original = data.get(DRAFT_KEY);
  assert.throws(() =>
    writeDraft(
      {
        ...storage,
        setItem() {
          throw Error("quota");
        },
      },
      edited,
      doc,
    ),
  );
  assert.equal(data.get(DRAFT_KEY), original);
  data.set(DRAFT_KEY, "bad json");
  assert.throws(() => readDraft(storage, doc));
  assert.equal(data.get(DRAFT_KEY), "bad json");
});
test("agent context includes one slide, exact revision and patch contract", () => {
  const context = contextFor(doc, "docs", "base", "Move the title");
  assert.equal(context.slide.id, "docs");
  assert.equal(context.baseRevision, doc.revision);
  assert.equal(context.slides, undefined);
  assert.equal(context.patchTemplate.slideId, "docs");
});
