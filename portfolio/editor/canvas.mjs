import {
  applyPatch,
  flatten,
  validateDocument,
  validateImageData,
} from "../runtime/model.mjs";
import {
  framePixels,
  normalizedFrame,
  resizedFrame,
  positionFrame,
} from "../runtime/canvas-layout.mjs";
const pruneAssets = (doc) => {
  const used = new Set(
    doc.slides.flatMap((s) => [
      ...flatten(s.root)
        .filter((n) => n.assetId)
        .map((n) => n.assetId),
      ...s.states.map((st) => st.background?.assetId).filter(Boolean),
    ]),
  );
  for (const id of Object.keys(doc.assets || {}))
    if (!used.has(id)) delete doc.assets[id];
};
const uid = (prefix) =>
  prefix +
  Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) =>
    n.toString(16).padStart(8, "0"),
  ).join("");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const angle = (n) => ((n + 540) % 360) - 180;
const color = (value) => {
  const parts = value.match(/[\d.]+/g);
  return parts?.length >= 3
    ? "#" +
        parts
          .slice(0, 3)
          .map((n) => Math.round(+n).toString(16).padStart(2, "0"))
          .join("")
    : "#f2f1e9";
};
export async function importImage(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error(
      "Choose a PNG, JPEG, or WebP image. SVG and HEIC are not supported.",
    );
  if (file.size > 8 * 1024 * 1024)
    throw Error("Choose an image smaller than 8 MB.");
  const raw = new Uint8Array(await file.arrayBuffer());
  const png = raw[0] === 137 && raw[1] === 80 && raw[2] === 78 && raw[3] === 71,
    jpeg = raw[0] === 255 && raw[1] === 216 && raw[2] === 255,
    webp =
      String.fromCharCode(...raw.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...raw.slice(8, 12)) === "WEBP";
  if (!(
    (file.type === "image/png" && png) ||
    (file.type === "image/jpeg" && jpeg) ||
    (file.type === "image/webp" && webp)
  ))
    throw Error(
      "Image bytes do not match the file type. SVG and disguised files are rejected.",
    );
  let dw = 0,
    dh = 0;
  if (png && raw.length >= 24) {
    const view = new DataView(raw.buffer);
    dw = view.getUint32(16);
    dh = view.getUint32(20);
  }
  if (jpeg) {
    for (let i = 2; i + 9 < raw.length;) {
      if (raw[i] !== 255) {
        i++;
        continue;
      }
      const marker = raw[i + 1];
      if (marker === 218 || marker === 217) break;
      if (marker === 255) {
        i++;
        continue;
      }
      const length = (raw[i + 2] << 8) | raw[i + 3];
      if (length < 2) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        dh = (raw[i + 5] << 8) | raw[i + 6];
        dw = (raw[i + 7] << 8) | raw[i + 8];
        break;
      }
      i += 2 + length;
    }
  }
  if (webp && raw.length >= 30) {
    const kind = String.fromCharCode(...raw.slice(12, 16));
    if (kind === "VP8X") {
      dw = 1 + raw[24] + (raw[25] << 8) + (raw[26] << 16);
      dh = 1 + raw[27] + (raw[28] << 8) + (raw[29] << 16);
    } else if (kind === "VP8L") {
      dw = 1 + raw[21] + ((raw[22] & 63) << 8);
      dh = 1 + (raw[22] >> 6) + (raw[23] << 2) + ((raw[24] & 15) << 10);
    } else if (kind === "VP8 ") {
      dw = (raw[26] | (raw[27] << 8)) & 16383;
      dh = (raw[28] | (raw[29] << 8)) & 16383;
    }
  }
  if (dw * dh > 16000000)
    throw Error("Image exceeds 16 megapixels; resize it before importing.");
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error("Image could not be decoded"));
      image.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 16000000)
      throw Error("Image exceeds 16 megapixels; resize it before importing.");
    const canvas = document.createElement("canvas"),
      ratio = Math.min(
        1,
        1280 / Math.max(image.naturalWidth, image.naturalHeight),
      );
    let w = Math.max(1, Math.round(image.naturalWidth * ratio)),
      h = Math.max(1, Math.round(image.naturalHeight * ratio)),
      data;
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(image, 0, 0, w, h);
      data = canvas.toDataURL("image/webp", 0.8);
      if (data.length <= 600000) break;
      w = Math.round(w * 0.75);
      h = Math.round(h * 0.75);
    }
    validateImageData(data);
    return {
      data,
      width: w,
      height: h,
      alt: file.name.replace(/\.[^.]+$/, "").slice(0, 300),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function installCanvas(player, api) {
  const tools = document.createElement("div");
  tools.id = "canvas-tools";
  tools.hidden = true;
  tools.setAttribute("aria-label", "Selected element controls");
  tools.innerHTML =
    '<button class="canvas-grip" data-handle="move" aria-label="Move selected element" title="Drag to move; arrow keys nudge">✥</button><button class="canvas-rotate" data-handle="rotate" aria-label="Rotate selected element" title="Drag to rotate; Shift snaps to 15 degrees">↻</button>' +
    ["nw", "ne", "sw", "se"]
      .map(
        (c) =>
          `<button class="canvas-corner ${c}" data-handle="${c}" aria-label="Resize ${c} corner" title="Drag to resize; Shift toggles proportions"></button>`,
      )
      .join("");
  const guides = document.createElement("div");
  guides.id = "canvas-guides";
  guides.setAttribute("aria-hidden", "true");
  const bar = document.createElement("div");
  bar.id = "canvas-bar";
  bar.hidden = true;
  bar.innerHTML =
    '<button id="canvas-inspector">Inspector</button><button id="canvas-add-image">Add image</button><button id="canvas-background">Background</button><label><input type="checkbox" id="aspect-lock" checked> Keep proportions</label><span>Shift toggles proportions · Shift-rotate: 15°</span>';
  document.body.append(guides, tools, bar);
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.hidden = true;
  document.body.append(fileInput);
  const inspector = document.querySelector("#inspector");
  const imageSection = document.createElement("details");
  imageSection.innerHTML =
    '<summary>Images & background</summary><p class="editor-note">Images stay in this draft. PNG, JPEG, WebP; 8 MB input, 600 KB encoded per image, 1.5 MB total presentation. Export a backup before clearing browser data.</p><div class="button-row"><button id="inspector-add-image">Add image</button><button id="inspector-background">Choose background</button><button id="remove-background">Remove background</button></div><label>Background fit<select id="background-fit"><option value="cover">Cover</option><option value="contain">Contain</option></select></label><label>Background horizontal position<input id="background-x" type="range" min="0" max="100" value="50"></label><label>Background vertical position<input id="background-y" type="range" min="0" max="100" value="50"></label><button id="hide-canvas-element">Hide selected element in this state</button><button id="delete-image">Delete selected image from all states…</button>';
  inspector.insertBefore(imageSection, inspector.querySelector("details"));
  let gesture = null,
    textSession = null,
    pickBackground = false,
    selectedId = null;
  const editing = () =>
    document.body.classList.contains("editing") && !api.isPreview();
  const root = () => document.getElementById(player.slide.id);
  const element = () =>
    selectedId ? player.main.querySelector("#" + CSS.escape(selectedId)) : null;
  const clearGuides = () => guides.replaceChildren();
  function patch(id, changes, options) {
    const doc = api.getDocument();
    api.commit(
      applyPatch(doc, {
        schemaVersion: 1,
        presentationId: doc.id,
        baseRevision: doc.revision,
        slideId: player.slide.id,
        stateId: player.state.id,
        operations: [{ elementId: id, changes }],
      }),
      options,
    );
  }
  function prepareText() {
    for (const el of player.main.querySelectorAll(
      '[data-element-type="text"]',
    )) {
      if (editing() && !el.closest(".layout-placeholder")) {
        el.contentEditable = "true";
        el.spellcheck = true;
        el.setAttribute(
          "aria-label",
          "Edit text: " + el.textContent.trim().slice(0, 70),
        );
      } else el.removeAttribute("contenteditable");
    }
  }
  function textStart(el) {
    if (textSession?.el === el) return;
    textSession = { el, id: el.id, changed: false, last: el.textContent };
  }
  function textInput(el) {
    if (!editing()) return;
    textStart(el);
    if (el.textContent.length > 12000) {
      el.textContent = textSession.last;
      api.status("Text is limited to 12,000 characters.", true);
      return;
    }
    try {
      if (el.textContent !== textSession.last) {
        patch(
          el.id,
          { text: el.textContent },
          { render: false, history: !textSession.changed },
        );
        textSession.changed = true;
        textSession.last = el.textContent;
        updateOverlay();
      }
    } catch (e) {
      api.status(e.message, true);
    }
  }
  player.main.addEventListener("focusin", (e) => {
    if (e.target.matches('[contenteditable="true"]')) {
      textStart(e.target);
      player.select(e.target.id);
    }
  });
  player.main.addEventListener("input", (e) => {
    if (e.target.matches('[contenteditable="true"]')) textInput(e.target);
  });
  player.main.addEventListener("focusout", (e) => {
    if (textSession?.el === e.target) {
      textInput(e.target);
      textSession = null;
    }
  });
  player.main.addEventListener("paste", (e) => {
    if (!e.target.closest('[contenteditable="true"]')) return;
    e.preventDefault();
    document.execCommand(
      "insertText",
      false,
      (e.clipboardData?.getData("text/plain") || "").slice(0, 12000),
    );
  });
  player.main.addEventListener("keydown", (e) => {
    if (e.target.closest('[contenteditable="true"]') && e.key === "Escape") {
      e.preventDefault();
      e.target.blur();
    }
  });
  function measured(el) {
    const r = el.getBoundingClientRect(),
      scene = root();
    let matrix = new DOMMatrix();
    for (
      let current = el;
      current && current !== scene;
      current = current.parentElement
    ) {
      const cs = getComputedStyle(current);
      let m = new DOMMatrix();
      if (cs.rotate && cs.rotate !== "none")
        m = m.rotate(parseFloat(cs.rotate));
      if (cs.scale && cs.scale !== "none") {
        const v = cs.scale.split(" ").map(Number);
        m = m.scale(v[0], v[1] ?? v[0]);
      }
      if (cs.transform !== "none") m = m.multiply(new DOMMatrix(cs.transform));
      matrix = m.multiply(matrix);
    }
    const w =
        Math.max(1, el.offsetWidth || r.width) * Math.hypot(matrix.a, matrix.b),
      h =
        Math.max(1, el.offsetHeight || r.height) *
        Math.hypot(matrix.c, matrix.d),
      a = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
    return normalizedFrame(
      { x: r.left + r.width / 2, y: r.top + r.height / 2, w, h, angle: a },
      scene,
      {
        naturalWidth: Math.max(1, el.offsetWidth || r.width),
        naturalHeight: Math.max(1, el.offsetHeight || r.height),
      },
    );
  }
  function currentFrame(el) {
    return el.dataset.frame ? JSON.parse(el.dataset.frame) : measured(el);
  }
  function updateOverlay(frame) {
    const el = element();
    if (
      !editing() ||
      !el ||
      el === root() ||
      el.hidden ||
      el.closest("[hidden]") ||
      !el.getBoundingClientRect().width
    ) {
      tools.hidden = true;
      return;
    }
    const p = framePixels(frame || currentFrame(el), root());
    tools.hidden = false;
    Object.assign(tools.style, {
      left: p.x + "px",
      top: p.y + "px",
      width: p.w + "px",
      height: p.h + "px",
      transform: `translate(-50%,-50%) rotate(${p.angle}deg)`,
    });
  }
  function drawGuides(frame) {
    clearGuides();
    const scene = root(),
      sr = scene.getBoundingClientRect(),
      p = framePixels(frame, scene),
      rad = (p.angle * Math.PI) / 180,
      w = Math.abs(p.w * Math.cos(rad)) + Math.abs(p.h * Math.sin(rad)),
      h = Math.abs(p.w * Math.sin(rad)) + Math.abs(p.h * Math.cos(rad));
    const xs = [
        sr.left,
        sr.left + scene.clientWidth / 2,
        sr.left + scene.clientWidth,
      ],
      ys = [
        sr.top,
        sr.top + scene.clientHeight / 2,
        sr.top + scene.clientHeight,
      ];
    const el = element();
    for (const other of scene.querySelectorAll("[data-element-id]")) {
      if (
        other === scene ||
        other === el ||
        other.contains(el) ||
        el?.contains(other) ||
        other.closest("[hidden],.layout-placeholder")
      )
        continue;
      const b = other.getBoundingClientRect();
      if (b.width && b.height) {
        xs.push(b.left, b.left + b.width / 2, b.right);
        ys.push(b.top, b.top + b.height / 2, b.bottom);
      }
    }
    for (const [axis, values, points] of [
      ["x", xs, [p.x - w / 2, p.x, p.x + w / 2]],
      ["y", ys, [p.y - h / 2, p.y, p.y + h / 2]],
    ]) {
      const near = [
        ...new Set(
          values.filter((v) => points.some((n) => Math.abs(n - v) < 4)),
        ),
      ].slice(0, 3);
      for (const v of near) {
        const line = document.createElement("i");
        line.className = "alignment-guide " + axis;
        Object.assign(
          line.style,
          axis === "x"
            ? {
                left: v + "px",
                top: sr.top + "px",
                height: scene.clientHeight + "px",
              }
            : {
                top: v + "px",
                left: sr.left + "px",
                width: scene.clientWidth + "px",
              },
        );
        guides.append(line);
      }
    }
  }
  function stop(cancel = false) {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    clearGuides();
    try {
      if (!cancel && g.moved)
        patch(g.id, {
          ...g.style,
          frame: g.last,
          x: 0,
          y: 0,
          scale: 1,
          rotate: 0,
        });
      else if (g.moved) player.setDocument(api.getDocument());
    } catch (e) {
      player.setDocument(api.getDocument());
      api.status(e.message, true);
    }
    updateOverlay();
  }
  function beginGesture(e, el, handle, body = false) {
    e.preventDefault();
    document.activeElement?.blur();
    player.select(el.id);
    const f = currentFrame(el),
      p = framePixels(f, root()),
      cs = getComputedStyle(el);
    const style = el.dataset.frame
      ? {}
      : {
          fontSize: clamp(parseFloat(cs.fontSize), 8, 200),
          fontFamily:
            !/sans-serif/i.test(cs.fontFamily) &&
            /serif|Georgia|Times/i.test(cs.fontFamily)
              ? "serif"
              : "sans",
          color: color(cs.color),
          lineHeight: clamp(
            parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) || 1.2,
            0.5,
            4,
          ),
          letterSpacing: clamp(parseFloat(cs.letterSpacing) || 0, -20, 50),
        };
    gesture = {
      id: el.id,
      handle,
      body,
      frame: f,
      start: p,
      px: e.clientX,
      py: e.clientY,
      startAngle: Math.atan2(e.clientY - p.y, e.clientX - p.x),
      moved: false,
      last: f,
      style,
      pointerId: e.pointerId,
    };
    // Capture on a stable container: the element is replaced on first preview.
    (body ? player.main : tools).setPointerCapture(e.pointerId);
  }
  tools.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest("[data-handle]");
    if (!handle || !editing() || e.button !== 0) return;
    const el = element();
    if (el) beginGesture(e, el, handle.dataset.handle);
  });
  let suppressBodyClick = false;
  player.main.addEventListener(
    "pointerdown",
    (e) => {
      suppressBodyClick = false;
      if (!editing() || !e.isPrimary || e.button !== 0 || gesture) return;
      if (e.target.closest("input,textarea,select,[data-handle]")) return;
      const el = e.target.closest("[data-element-id]");
      if (!el || el === root() || !root().contains(el)) return;
      // Once a caret is active, native selection wins. Blur or use the grip to move.
      if (el.isContentEditable && document.activeElement === el) return;
      beginGesture(e, el, "move", true);
    },
    true,
  );
  player.main.addEventListener("dragstart", (e) => {
    if (editing() && gesture) e.preventDefault();
  });
  player.main.addEventListener(
    "click",
    (e) => {
      if (!suppressBodyClick) return;
      suppressBodyClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  function focusAtPoint(el, x, y) {
    el.focus({ preventScroll: true });
    let range;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position && el.contains(position.offsetNode)) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    } else if (document.caretRangeFromPoint)
      range = document.caretRangeFromPoint(x, y);
    if (range && el.contains(range.startContainer)) {
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  document.addEventListener("pointermove", (e) => {
    const g = gesture;
    if (!g || g.pointerId !== e.pointerId) return;
    if (
      !g.moved &&
      Math.hypot(e.clientX - g.px, e.clientY - g.py) < (g.body ? 5 : 2)
    )
      return;
    let p = { ...g.start };
    if (g.handle === "move") {
      p.x += e.clientX - g.px;
      p.y += e.clientY - g.py;
    } else if (g.handle === "rotate") {
      let a = angle(
        g.start.angle +
          ((Math.atan2(e.clientY - p.y, e.clientX - p.x) - g.startAngle) *
            180) /
            Math.PI,
      );
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      p.angle = a;
    } else
      p = resizedFrame(
        g.start,
        { x: e.clientX, y: e.clientY },
        g.handle,
        document.querySelector("#aspect-lock").checked !== e.shiftKey,
      );
    const f = normalizedFrame(p, root(), g.frame);
    f.width = clamp(f.width, 0.1, 300);
    f.height = clamp(f.height, 0.1, 300);
    f.x = clamp(f.x, -100, 200);
    f.y = clamp(f.y, -100, 200);
    g.last = f;
    if (!g.moved) {
      g.moved = true;
      const doc = api.getDocument();
      const preview = applyPatch(doc, {
        schemaVersion: 1,
        presentationId: doc.id,
        baseRevision: doc.revision,
        slideId: player.slide.id,
        stateId: player.state.id,
        operations: [
          {
            elementId: g.id,
            changes: { ...g.style, frame: f, x: 0, y: 0, scale: 1, rotate: 0 },
          },
        ],
      });
      player.setDocument(preview);
    }
    const el = element(),
      wrap = el?.closest(".free-frame");
    if (wrap) {
      el.dataset.frame = JSON.stringify(f);
      positionFrame(root(), wrap, el, f);
    }
    updateOverlay(f);
    drawGuides(f);
  });
  document.addEventListener("pointerup", (e) => {
    const g = gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.body) suppressBodyClick = true;
    stop();
    if (g.body && !g.moved) {
      const el = element();
      if (el?.isContentEditable) focusAtPoint(el, e.clientX, e.clientY);
    }
  });
  document.addEventListener("pointercancel", (e) => {
    if (e.pointerId === gesture?.pointerId) stop(true);
  });
  for (const capture of [tools, player.main])
    capture.addEventListener("lostpointercapture", (e) => {
      if (e.pointerId === gesture?.pointerId) stop(true);
    });
  tools.addEventListener("keydown", (e) => {
    const handle = e.target.dataset.handle;
    if (
      !handle ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const el = element();
    if (!el) return;
    const f = currentFrame(el),
      p = framePixels(f, root()),
      step = e.shiftKey ? 10 : 1;
    if (handle === "rotate")
      p.angle = angle(
        p.angle + (["ArrowLeft", "ArrowDown"].includes(e.key) ? -step : step),
      );
    else if (handle === "move") {
      p.x += e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
      p.y += e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
    } else {
      p.w = Math.max(
        12,
        p.w +
          (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
      );
      p.h = Math.max(
        12,
        p.h + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0),
      );
    }
    try {
      patch(el.id, {
        frame: normalizedFrame(p, root(), f),
        x: 0,
        y: 0,
        scale: 1,
        rotate: 0,
      });
    } catch (err) {
      api.status(err.message, true);
    }
    updateOverlay();
  });
  document.addEventListener("keydown", (e) => {
    if (!editing()) return;
    if (e.key === "Escape" && gesture) {
      stop(true);
      e.preventDefault();
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "z" &&
      !e.target.closest('input,textarea,[contenteditable="true"]')
    ) {
      e.preventDefault();
      stop(true);
      document.querySelector(e.shiftKey ? "#redo-edit" : "#undo-edit").click();
    }
  });
  async function addFiles(files, background = false, point) {
    if (!editing()) return;
    const revision = api.getDocument().revision,
      slideId = player.slide.id,
      stateId = player.state.id;
    if (!files.length) return;
    if (files.length > 4) {
      api.status("Import up to four images at a time.", true);
      return;
    }
    try {
      api.status("Preparing images locally…");
      const assets = await Promise.all(files.map(importImage));
      if (
        api.getDocument().revision !== revision ||
        player.slide.id !== slideId ||
        player.state.id !== stateId
      )
        throw Error(
          "The slide changed while images loaded. Import again on the intended state.",
        );
      const next = structuredClone(api.getDocument()),
        slide = next.slides.find((s) => s.id === slideId),
        state = slide.states.find((s) => s.id === stateId);
      next.assets ||= {};
      let last;
      assets.forEach((asset, i) => {
        const assetId = uid("asset-");
        next.assets[assetId] = asset;
        if (background) {
          state.background = { assetId, fit: "cover", x: 50, y: 50 };
          return;
        }
        const id = uid("image-"),
          sr = root().getBoundingClientRect(),
          w = Math.min(root().clientWidth * 0.45, asset.width),
          h = (w * asset.height) / asset.width;
        const center = point
          ? { x: point.x + i * 20, y: point.y + i * 20 }
          : {
              x: sr.left + root().clientWidth / 2,
              y: sr.top + root().clientHeight / 2,
            };
        const frame = normalizedFrame({ ...center, w, h, angle: 0 }, root(), {
          naturalWidth: asset.width,
          naturalHeight: asset.height,
        });
        slide.root.children.push({
          id,
          type: "image",
          tag: "img",
          assetId,
          base: { visible: false },
        });
        state.overrides[id] = { visible: true, frame };
        last = id;
      });
      pruneAssets(next);
      next.revision++;
      validateDocument(next);
      api.commit(next);
      if (last) player.select(last);
      syncBackground();
      api.status(
        "Images added to this local draft. Export a backup; nothing was uploaded.",
      );
    } catch (e) {
      api.status(e.message + " Your previous draft was kept.", true);
    }
  }
  player.main.addEventListener("dragover", (e) => {
    if (editing() && e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  player.main.addEventListener("drop", (e) => {
    if (!editing()) return;
    e.preventDefault();
    if (e.dataTransfer.files.length)
      addFiles([...e.dataTransfer.files], false, {
        x: e.clientX,
        y: e.clientY,
      });
  });
  function choose(background) {
    pickBackground = background;
    fileInput.multiple = !background;
    fileInput.click();
  }
  fileInput.onchange = () => {
    addFiles([...fileInput.files], pickBackground);
    fileInput.value = "";
  };
  document.querySelector("#canvas-add-image").onclick = () => choose(false);
  document.querySelector("#canvas-background").onclick = () => choose(true);
  document.querySelector("#inspector-add-image").onclick = () => choose(false);
  document.querySelector("#inspector-background").onclick = () => choose(true);
  document.querySelector("#canvas-inspector").onclick = () =>
    document.body.classList.toggle("inspector-collapsed");
  function changeBackground(changes) {
    if (!editing()) return;
    const next = structuredClone(api.getDocument()),
      state = next.slides[player.index].states[player.stateIndex];
    if (changes === null) delete state.background;
    else if (state.background) Object.assign(state.background, changes);
    else return;
    pruneAssets(next);
    next.revision++;
    api.commit(next);
    syncBackground();
  }
  function syncBackground() {
    const bg = player.state.background;
    document.querySelector("#background-fit").value = bg?.fit || "cover";
    document.querySelector("#background-x").value = bg?.x ?? 50;
    document.querySelector("#background-y").value = bg?.y ?? 50;
  }
  document.querySelector("#background-fit").onchange = (e) =>
    changeBackground({ fit: e.target.value });
  document.querySelector("#background-x").onchange = (e) =>
    changeBackground({ x: Number(e.target.value) });
  document.querySelector("#background-y").onchange = (e) =>
    changeBackground({ y: Number(e.target.value) });
  document.querySelector("#remove-background").onclick = () =>
    changeBackground(null);
  document.querySelector("#hide-canvas-element").onclick = () => {
    if (selectedId && selectedId !== player.slide.id)
      patch(selectedId, { visible: false });
  };
  document.querySelector("#delete-image").onclick = () => {
    const doc = api.getDocument(),
      node = flatten(player.slide.root).find((n) => n.id === selectedId);
    if (node?.type !== "image") {
      api.status("Select an added image to delete.", true);
      return;
    }
    if (
      !confirm(
        "Delete this image from all states of this slide? You can undo this action.",
      )
    )
      return;
    const next = structuredClone(doc),
      slide = next.slides[player.index];
    function remove(parent) {
      parent.children = (parent.children || []).filter(
        (n) => n.id !== selectedId,
      );
      for (const child of parent.children) if (child.children) remove(child);
    }
    remove(slide.root);
    for (const state of slide.states) delete state.overrides[selectedId];
    pruneAssets(next);
    next.revision++;
    api.commit(next);
    player.select(slide.root.id);
  };
  player.addEventListener("select", (e) => {
    selectedId = e.detail;
    updateOverlay();
  });
  player.addEventListener("render", () => {
    prepareText();
    updateOverlay();
    syncBackground();
  });
  player.addEventListener("beforeNavigate", () => {
    stop(true);
    textSession = null;
    clearGuides();
  });
  window.addEventListener("resize", () => {
    stop(true);
    requestAnimationFrame(() => updateOverlay());
  });
  document.addEventListener(
    "scroll",
    () => {
      if (!gesture) updateOverlay();
      clearGuides();
    },
    true,
  );
  window.addEventListener("blur", () => {
    stop(true);
    clearGuides();
  });
  const observer = new MutationObserver(() => {
    bar.hidden = !document.body.classList.contains("editing");
    prepareText();
    if (!editing()) {
      stop(true);
      tools.hidden = true;
      clearGuides();
    } else updateOverlay();
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return {
    refresh() {
      prepareText();
      syncBackground();
      updateOverlay();
    },
    cancel() {
      stop(true);
      clearGuides();
    },
  };
}
