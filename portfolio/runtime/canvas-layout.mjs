// Responsive frames use percentages of the visible slide canvas, not device pixels.
export function renderCanvasLayout(root, slide, state, doc) {
  if (state.background) {
    const bg = document.createElement("img"),
      asset = doc.assets[state.background.assetId];
    bg.className = "slide-background";
    bg.alt = "";
    bg.src = asset.data;
    bg.draggable = false;
    bg.style.objectFit = state.background.fit;
    bg.style.objectPosition = `${state.background.x}% ${state.background.y}%`;
    root.prepend(bg);
  }
  const layer = document.createElement("div");
  layer.className = "free-layer";
  root.append(layer);
  const placed = [];
  for (const el of [...root.querySelectorAll("[data-frame]")]) {
    if (!root.contains(el) || el.closest(".layout-placeholder")) continue;
    const frame = JSON.parse(el.dataset.frame);
    const inheritedHidden = !!el.closest("[hidden]");
    const placeholder = el.cloneNode(true);
    placeholder.classList.add("layout-placeholder");
    if (el.tagName === "IMG") placeholder.style.display = "none";
    placeholder.inert = true;
    placeholder.setAttribute("aria-hidden", "true");
    for (const n of [placeholder, ...placeholder.querySelectorAll("*")]) {
      n.removeAttribute("id");
      n.removeAttribute("data-element-id");
      n.removeAttribute("data-element-type");
      n.removeAttribute("role");
      n.removeAttribute("data-frame");
      n.removeAttribute("contenteditable");
    }
    el.replaceWith(placeholder);
    const wrap = document.createElement("div");
    wrap.className = "free-frame";
    wrap.hidden = inheritedHidden;
    wrap.style.zIndex = el.style.zIndex;
    wrap.dataset.frameFor = el.id;
    wrap.append(el);
    layer.append(wrap);
    Object.assign(el.style, {
      position: "relative",
      left: "auto",
      right: "auto",
      top: "auto",
      bottom: "auto",
      margin: "0",
      maxWidth: "none",
      width: `${frame.naturalWidth}px`,
      height: `${frame.naturalHeight}px`,
      minHeight: "0",
      transform: "none",
      translate: "none",
      rotate: "none",
      scale: "none",
      transformOrigin: "0 0",
      boxSizing: "border-box",
    });
    if (el.tagName === "IMG") {
      el.style.objectFit = "fill";
      el.style.display = "block";
    }
    placed.push([wrap, el, frame]);
  }
  // Called after mounting and on resize; inner content scales independently of flow.
  return () => {
    for (const [wrap, el, frame] of placed)
      positionFrame(root, wrap, el, frame);
  };
}
export function positionFrame(root, wrap, el, frame) {
  const w = (root.clientWidth * frame.width) / 100,
    h = (root.clientWidth * frame.height) / 100;
  Object.assign(wrap.style, {
    left: `${frame.x}%`,
    top: `${frame.y}%`,
    width: `${w}px`,
    height: `${h}px`,
    transform: `translate(-50%,-50%) rotate(${frame.angle}deg)`,
  });
  el.style.scale = `${w / frame.naturalWidth} ${h / frame.naturalHeight}`;
}
export function framePixels(frame, root) {
  const r = root.getBoundingClientRect();
  return {
    x: r.left - root.scrollLeft + (root.clientWidth * frame.x) / 100,
    y: r.top - root.scrollTop + (root.clientHeight * frame.y) / 100,
    w: (root.clientWidth * frame.width) / 100,
    h: (root.clientWidth * frame.height) / 100,
    angle: frame.angle,
  };
}
export function normalizedFrame(p, root, original) {
  const r = root.getBoundingClientRect();
  return {
    ...original,
    x: ((p.x - r.left + root.scrollLeft) / root.clientWidth) * 100,
    y: ((p.y - r.top + root.scrollTop) / root.clientHeight) * 100,
    width: (p.w / root.clientWidth) * 100,
    height: (p.h / root.clientWidth) * 100,
    angle: p.angle,
  };
}
export function resizedFrame(start, point, corner, locked) {
  const rad = (start.angle * Math.PI) / 180,
    c = Math.cos(rad),
    s = Math.sin(rad),
    sx = corner.includes("e") ? 1 : -1,
    sy = corner.includes("s") ? 1 : -1;
  const ax = start.x - (c * sx * start.w - s * sy * start.h) / 2,
    ay = start.y - (s * sx * start.w + c * sy * start.h) / 2;
  const dx = point.x - ax,
    dy = point.y - ay,
    lx = c * dx + s * dy,
    ly = -s * dx + c * dy;
  let w = Math.max(12, sx * lx),
    h = Math.max(12, sy * ly);
  if (locked) {
    const f = Math.max(
      0.05,
      (sx * lx * start.w + sy * ly * start.h) / (start.w ** 2 + start.h ** 2),
    );
    w = Math.max(12, start.w * f);
    h = Math.max(12, start.h * f);
  }
  return {
    x: ax + (c * sx * w - s * sy * h) / 2,
    y: ay + (s * sx * w + c * sy * h) / 2,
    w,
    h,
    angle: start.angle,
  };
}
