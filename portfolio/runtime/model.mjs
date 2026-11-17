// This schema is also enforced by the local save bridge. Never render imported HTML.
export const VERSION = 1;
export const TYPES = ["group", "text", "link", "button", "shape"];
const TAGS = new Set([
  "section",
  "div",
  "p",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "a",
  "button",
  "i",
  "em",
  "strong",
  "small",
  "mark",
  "br",
  "hr",
  "ul",
  "li",
]);
const ATTRS =
  /^(class|role|title|href|target|rel|tabindex|aria-[a-z-]+|data-step)$/;
const ID = /^[a-zA-Z][\w-]{0,100}$/;
const isId = (value) => typeof value === "string" && ID.test(value);
const RANGES = {
  x: [-3000, 3000],
  y: [-3000, 3000],
  scale: [0.1, 5],
  rotate: [-360, 360],
  opacity: [0, 1],
  zIndex: [-10, 100],
  fontSize: [8, 200],
  width: [20, 2400],
  animationDuration: [0, 3000],
  animationDelay: [0, 3000],
};
const ENUMS = {
  animation: ["none", "fade", "rise", "scale"],
  textAlign: ["left", "center", "right"],
  fontWeight: ["300", "400", "500", "600", "700"],
  transformOrigin: [
    "center",
    "top left",
    "top right",
    "bottom left",
    "bottom right",
  ],
};
export const PROP_KEYS = [
  ...Object.keys(RANGES),
  ...Object.keys(ENUMS),
  "visible",
  "color",
  "backgroundColor",
  "text",
  "href",
  "stateTarget",
];
const fail = (message) => {
  throw new Error(message);
};
const object = (x) =>
  !!x &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  Object.getPrototypeOf(x) === Object.prototype;
const keys = (x, allowed, label) => {
  if (!object(x)) fail(`${label} must be an object`);
  for (const k of Object.keys(x))
    if (!allowed.includes(k)) fail(`Unknown ${label} field: ${k}`);
};
const string = (s, max = 12000) => typeof s === "string" && s.length <= max;
export function safeURL(value) {
  return (
    typeof value === "string" &&
    (value.startsWith("#") ||
      /^\/(?!\/)/.test(value) ||
      /^https:\/\//.test(value)) &&
    !/[\s\\<>"']/.test(value)
  );
}
export function flatten(node) {
  return [node, ...(node.children || []).flatMap(flatten)];
}
export function validateProps(props, element, slide) {
  keys(props, PROP_KEYS, "override");
  for (const [k, v] of Object.entries(props)) {
    if (
      k in RANGES &&
      (typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < RANGES[k][0] ||
        v > RANGES[k][1])
    )
      fail(`Invalid ${k}`);
    if (k in ENUMS && !ENUMS[k].includes(v)) fail(`Invalid ${k}`);
    if (k === "visible" && typeof v !== "boolean") fail("Invalid visibility");
    if (
      ["color", "backgroundColor"].includes(k) &&
      (typeof v !== "string" ||
        !/^(#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})|transparent)$/i.test(
          v,
        ))
    )
      fail("Use a hexadecimal color or transparent");
    if (k === "text" && (element.type !== "text" || !string(v)))
      fail("Text changes require a text element");
    if (k === "href" && (element.type !== "link" || !safeURL(v)))
      fail("Invalid link");
    if (
      k === "stateTarget" &&
      (element.type !== "button" || !slide.states.some((s) => s.id === v))
    )
      fail("Invalid state target");
  }
}
export function validateDocument(doc) {
  keys(
    doc,
    ["schemaVersion", "id", "revision", "title", "slides"],
    "presentation",
  );
  if (doc.schemaVersion !== VERSION) fail("Unsupported presentation version");
  if (
    !isId(doc.id) ||
    !Number.isSafeInteger(doc.revision) ||
    doc.revision < 1 ||
    !string(doc.title, 200)
  )
    fail("Invalid presentation metadata");
  if (
    !Array.isArray(doc.slides) ||
    doc.slides.length < 1 ||
    doc.slides.length > 50
  )
    fail("Expected 1–50 slides");
  const slideIds = new Set(),
    globalIds = new Set();
  for (const slide of doc.slides) {
    keys(slide, ["id", "title", "root", "states"], "slide");
    if (!isId(slide.id) || slideIds.has(slide.id) || !string(slide.title, 200))
      fail("Invalid slide metadata");
    slideIds.add(slide.id);
    if (
      !Array.isArray(slide.states) ||
      !slide.states.length ||
      slide.states.length > 30
    )
      fail("Expected 1–30 states");
    const stateIds = new Set();
    for (const state of slide.states) {
      keys(state, ["id", "label", "overrides"], "state");
      if (
        !isId(state.id) ||
        stateIds.has(state.id) ||
        !string(state.label, 100)
      )
        fail("Invalid state");
      stateIds.add(state.id);
    }
    const nodes = [];
    function inspect(n, depth = 0) {
      if (depth > 20 || nodes.length >= 1000)
        fail("Element tree exceeds limits");
      keys(
        n,
        ["id", "type", "tag", "attrs", "text", "children", "base", "action"],
        "element",
      );
      if (
        !isId(n.id) ||
        globalIds.has(n.id) ||
        !TYPES.includes(n.type) ||
        !TAGS.has(n.tag)
      )
        fail(`Invalid or duplicate element: ${n.id}`);
      if (
        (n.tag === "a") !== (n.type === "link") ||
        (n.tag === "button") !== (n.type === "button")
      )
        fail("Element type and tag disagree");
      globalIds.add(n.id);
      nodes.push(n);
      if (n.type === "text" && (!string(n.text) || n.children !== undefined))
        fail("Invalid text node");
      if (n.type !== "text" && n.text !== undefined) fail("Unexpected text");
      if (n.attrs !== undefined) {
        if (!object(n.attrs)) fail("Invalid attributes");
        for (const [k, v] of Object.entries(n.attrs)) {
          if (
            !ATTRS.test(k) ||
            !string(v, 500) ||
            (k === "href" && (!safeURL(v) || n.type !== "link"))
          )
            fail(`Unsafe attribute ${k}`);
          if (k === "class" && !/^[\w -]*$/.test(v)) fail("Invalid class");
          if (k === "target" && v !== "_blank") fail("Invalid target");
        }
      }
      if (n.children !== undefined) {
        if (!Array.isArray(n.children)) fail("Invalid children");
        n.children.forEach((c) => inspect(c, depth + 1));
      }
      if (n.action) {
        keys(n.action, ["type", "target", "activeStates"], "action");
        if (
          n.action.activeStates &&
          (!Array.isArray(n.action.activeStates) ||
            n.action.activeStates.some((id) => !stateIds.has(id)))
        )
          fail("Invalid action states");
        if (
          n.type !== "button" ||
          n.action.type !== "state" ||
          !stateIds.has(n.action.target)
        )
          fail("Invalid action");
      }
    }
    inspect(slide.root);
    if (slide.root.id !== slide.id || slide.root.tag !== "section")
      fail("Slide root must be its named section");
    const lookup = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) if (n.base) validateProps(n.base, n, slide);
    for (const state of slide.states) {
      if (!object(state.overrides)) fail("Invalid overrides");
      for (const [id, props] of Object.entries(state.overrides)) {
        if (!lookup.has(id)) fail(`Unknown element ${id}`);
        validateProps(props, lookup.get(id), slide);
      }
    }
  }
  if (JSON.stringify(doc).length > 1500000) fail("Presentation exceeds 1.5 MB");
  return doc;
}
export function validatePatch(patch, doc) {
  keys(
    patch,
    [
      "schemaVersion",
      "presentationId",
      "baseRevision",
      "slideId",
      "stateId",
      "operations",
    ],
    "patch",
  );
  if (
    patch.schemaVersion !== VERSION ||
    patch.presentationId !== doc.id ||
    patch.baseRevision !== doc.revision
  )
    fail("Patch version or revision is stale; export fresh context");
  const slide = doc.slides.find((s) => s.id === patch.slideId),
    state = slide?.states.find((s) => s.id === patch.stateId);
  if (!state) fail("Unknown slide or state");
  if (
    !Array.isArray(patch.operations) ||
    !patch.operations.length ||
    patch.operations.length > 100
  )
    fail("Expected 1–100 operations");
  const nodes = new Map(flatten(slide.root).map((n) => [n.id, n]));
  for (const op of patch.operations) {
    keys(op, ["elementId", "changes"], "operation");
    if (!nodes.has(op.elementId))
      fail("Patch targets an element outside this slide");
    validateProps(op.changes, nodes.get(op.elementId), slide);
  }
  return patch;
}
export function applyPatch(doc, patch) {
  validatePatch(patch, doc);
  const copy = structuredClone(doc),
    state = copy.slides
      .find((s) => s.id === patch.slideId)
      .states.find((s) => s.id === patch.stateId);
  for (const op of patch.operations)
    state.overrides[op.elementId] = {
      ...state.overrides[op.elementId],
      ...op.changes,
    };
  copy.revision++;
  return validateDocument(copy);
}
export function contextFor(doc, slideId, stateId, prompt = "") {
  const slide = doc.slides.find((s) => s.id === slideId);
  if (!slide || !slide.states.some((s) => s.id === stateId))
    fail("Unknown context");
  return {
    format: "portfolio-agent-context-v1",
    prompt,
    presentationId: doc.id,
    baseRevision: doc.revision,
    slide: structuredClone(slide),
    stateId,
    instructions:
      "Return only a JSON patch matching patchTemplate. Change only the named slide/state. No HTML, scripts, new facts, credentials, or other slides. Text must remain public-safe. User must preview and apply. Allowed properties: " +
      PROP_KEYS.join(", "),
    patchTemplate: {
      schemaVersion: 1,
      presentationId: doc.id,
      baseRevision: doc.revision,
      slideId,
      stateId,
      operations: [{ elementId: slide.root.id, changes: { x: 0, y: 0 } }],
    },
  };
}
export const DRAFT_KEY = "alan-portfolio-editor:draft:v1";
export function readDraft(storage, published) {
  const raw = storage.getItem(DRAFT_KEY);
  if (!raw) return null;
  const draft = JSON.parse(raw);
  keys(draft, ["format", "baseFingerprint", "savedAt", "document"], "draft");
  if (draft.format !== 1 || draft.baseFingerprint !== JSON.stringify(published))
    fail(
      "Published content changed; export or reset the older draft before editing",
    );
  validateDocument(draft.document);
  return draft;
}
export function writeDraft(storage, document, published) {
  validateDocument(document);
  const envelope = {
    format: 1,
    baseFingerprint: JSON.stringify(published),
    savedAt: new Date().toISOString(),
    document,
  };
  // Never remove a previous draft before the replacement succeeds (quota/private-mode errors).
  storage.setItem(DRAFT_KEY, JSON.stringify(envelope));
  return envelope.savedAt;
}
