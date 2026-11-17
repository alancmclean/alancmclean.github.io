import { validateDocument, flatten } from "./model.mjs";
export class Player extends EventTarget {
  constructor(documentData, { editor = false } = {}) {
    super();
    this.document = validateDocument(documentData);
    this.editor = editor;
    this.index = 0;
    this.stateIndex = 0;
    this.selected = null;
    this.main = document.querySelector("#main");
    this.menu = document.querySelector("#chapter-index");
    this.toggle = document.querySelector("#index-toggle");
    this.readHash();
    this.bind();
    this.render();
  }
  get slide() {
    return this.document.slides[this.index];
  }
  get state() {
    return this.slide.states[this.stateIndex];
  }
  readHash() {
    const [slideId, stateId] = location.hash.slice(1).split("/");
    const i = this.document.slides.findIndex((s) => s.id === slideId);
    this.index = Math.max(0, i);
    this.stateIndex = Math.max(
      0,
      this.slide.states.findIndex((s) => s.id === stateId),
    );
  }
  setDocument(doc) {
    this.document = validateDocument(doc);
    this.index = Math.min(this.index, doc.slides.length - 1);
    this.stateIndex = Math.min(this.stateIndex, this.slide.states.length - 1);
    this.render();
  }
  go(slideIndex, stateIndex = 0) {
    if (slideIndex < 0 || slideIndex >= this.document.slides.length) return;
    const slide = this.document.slides[slideIndex];
    if (stateIndex < 0 || stateIndex >= slide.states.length) return;
    this.dispatchEvent(new Event("beforeNavigate"));
    this.index = slideIndex;
    this.stateIndex = stateIndex;
    history.replaceState(
      null,
      "",
      `#${slide.id}/${slide.states[stateIndex].id}`,
    );
    this.render();
    this.dispatchEvent(new Event("navigate"));
  }
  moveSlide(delta) {
    this.go(this.index + delta, 0);
  }
  moveState(delta) {
    this.go(this.index, this.stateIndex + delta);
  }
  select(id) {
    this.selected = id;
    document
      .querySelectorAll("[data-element-id]")
      .forEach((el) =>
        el.classList.toggle("element-selected", el.dataset.elementId === id),
      );
    this.dispatchEvent(new CustomEvent("select", { detail: id }));
  }
  closeIndex() {
    this.menu.hidden = true;
    this.toggle.setAttribute("aria-expanded", "false");
  }
  bind() {
    document.querySelector("#previous").onclick = () => this.moveSlide(-1);
    document.querySelector("#next-chapter").onclick = () => this.moveSlide(1);
    document.querySelector("#state-previous").onclick = () =>
      this.moveState(-1);
    document.querySelector("#state-next").onclick = () => this.moveState(1);
    this.toggle.onclick = () => {
      this.menu.hidden = !this.menu.hidden;
      this.toggle.setAttribute("aria-expanded", String(!this.menu.hidden));
    };
    document.addEventListener("click", (e) => {
      if (
        !this.menu.hidden &&
        !this.menu.contains(e.target) &&
        !this.toggle.contains(e.target)
      )
        this.closeIndex();
      if (e.target.closest("#inspector")) return;
      if (
        this.editor &&
        document.body.classList.contains("editing") &&
        this.main.contains(e.target)
      ) {
        const el = e.target.closest("[data-element-id]");
        if (el) {
          e.preventDefault();
          e.stopPropagation();
          this.select(el.dataset.elementId);
          return;
        }
      }
      const button = e.target.closest("[data-state-target]");
      if (button) {
        const index = this.slide.states.findIndex(
          (s) => s.id === button.dataset.stateTarget,
        );
        this.go(this.index, index);
        return;
      }
      const anchor = e.target.closest('a[href^="#"]');
      if (anchor && anchor.hash !== "#main") {
        const [id, state] = anchor.hash.slice(1).split("/");
        const index = this.document.slides.findIndex((s) => s.id === id);
        if (index >= 0) {
          e.preventDefault();
          this.go(
            index,
            state
              ? Math.max(
                  0,
                  this.document.slides[index].states.findIndex(
                    (s) => s.id === state,
                  ),
                )
              : 0,
          );
        }
      }
    });
    document.addEventListener("keydown", (e) => {
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.shiftKey ||
        e.target.closest(
          'input,textarea,select,[contenteditable="true"],#inspector,dialog',
        )
      )
        return;
      if (e.key === "Escape") {
        this.closeIndex();
        return;
      }
      if (!this.menu.hidden) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveSlide(1);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveSlide(-1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        this.moveState(1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.moveState(-1);
      }
    });
    let touch;
    this.main.addEventListener(
      "touchstart",
      (e) => {
        if (
          e.target.closest("a,button,input,textarea") ||
          document.body.classList.contains("editing")
        )
          return;
        touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      },
      { passive: true },
    );
    this.main.addEventListener(
      "touchend",
      (e) => {
        if (!touch) return;
        const dx = e.changedTouches[0].clientX - touch.x,
          dy = e.changedTouches[0].clientY - touch.y;
        touch = null;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2)
          this.moveState(dx < 0 ? 1 : -1);
      },
      { passive: true },
    );
    window.addEventListener("hashchange", () => {
      this.dispatchEvent(new Event("beforeNavigate"));
      this.readHash();
      this.render();
      this.dispatchEvent(new Event("navigate"));
    });
    document.addEventListener("dblclick", (e) => {
      const backdrop =
        e.target === document.body ||
        e.target === this.main ||
        e.target.matches(".scene,.landscape,.landscape > div");
      if (!backdrop) return;
      if (this.editor) this.dispatchEvent(new Event("edit"));
      else
        location.href = new URL(
          "editor/" + location.hash,
          document.baseURI,
        ).href;
    });
    document.querySelector("#edit-toggle").onclick = () =>
      this.editor
        ? this.dispatchEvent(new Event("edit"))
        : location.assign(new URL("editor/" + location.hash, document.baseURI));
  }
  renderNode(node, slide, state) {
    const el = document.createElement(node.tag);
    el.id = node.id;
    el.dataset.elementId = node.id;
    el.dataset.elementType = node.type;
    for (const [name, value] of Object.entries(node.attrs || {}))
      el.setAttribute(name, value);
    if (node.type === "link" && el.target === "_blank")
      el.rel = "noopener noreferrer";
    const props = { ...node.base, ...state.overrides[node.id] };
    if (
      ["span", "em", "strong", "small", "mark", "i"].includes(node.tag) &&
      ["x", "y", "scale", "rotate", "width", "animation"].some(
        (k) => props[k] !== undefined,
      )
    )
      el.style.display = "inline-block";
    if (node.type === "text") el.textContent = props.text ?? node.text;
    else
      for (const child of node.children || [])
        el.append(this.renderNode(child, slide, state));
    if (props.href !== undefined) el.href = props.href;
    if (props.visible === false) {
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
    }
    if (props.x !== undefined || props.y !== undefined)
      el.style.translate = `${props.x || 0}px ${props.y || 0}px`;
    if (props.scale !== undefined) el.style.scale = String(props.scale);
    if (props.rotate !== undefined) el.style.rotate = `${props.rotate}deg`;
    for (const key of [
      "opacity",
      "zIndex",
      "color",
      "backgroundColor",
      "fontWeight",
      "textAlign",
      "transformOrigin",
    ])
      if (props[key] !== undefined) el.style[key] = String(props[key]);
    for (const key of ["fontSize", "width"])
      if (props[key] !== undefined) el.style[key] = `${props[key]}px`;
    if (props.zIndex !== undefined) el.style.position = "relative";
    if (node.action) {
      el.dataset.stateTarget = props.stateTarget || node.action.target;
      if (el.getAttribute("role") === "tab") {
        const selected = (
          node.action.activeStates || [node.action.target]
        ).includes(state.id);
        el.setAttribute("aria-selected", String(selected));
        el.tabIndex = selected ? 0 : -1;
      }
    }
    if (props.animation && props.animation !== "none")
      el.dataset.animation = JSON.stringify({
        name: props.animation,
        duration: props.animationDuration ?? 260,
        delay: props.animationDelay ?? 0,
      });
    if (this.selected === node.id) el.classList.add("element-selected");
    return el;
  }
  render() {
    const focusId = document.activeElement?.id;
    const fragment = document.createDocumentFragment();
    this.document.slides.forEach((slide, i) => {
      const state = i === this.index ? this.state : slide.states[0],
        el = this.renderNode(slide.root, slide, state);
      el.classList.add("scene");
      el.classList.toggle("active", i === this.index);
      el.inert = i !== this.index;
      el.setAttribute("aria-hidden", String(i !== this.index));
      fragment.append(el);
    });
    this.main.replaceChildren(fragment);
    const activeTab = this.main.querySelector(
        ".active [role=tab][aria-selected=true]",
      ),
      tabPanel = this.main.querySelector(".active [role=tabpanel]");
    if (activeTab && tabPanel)
      tabPanel.setAttribute("aria-labelledby", activeTab.id);
    document.body.dataset.scene = this.slide.id;
    document.title = `${this.slide.title} — Alan McLean${this.editor ? " · Local editor" : ""}`;
    const label = document.querySelector("#page-number");
    label.textContent = String(this.index + 1).padStart(2, "0");
    document.querySelector(".divider").textContent =
      `/ ${String(this.document.slides.length).padStart(2, "0")}`;
    document.querySelector("#page-label").textContent = this.slide.title;
    document.querySelector("#state-label").textContent =
      `${this.stateIndex + 1} / ${this.slide.states.length} · ${this.state.label}`;
    document.querySelector("#previous").disabled = this.index === 0;
    document.querySelector("#next-chapter").disabled =
      this.index === this.document.slides.length - 1;
    document.querySelector("#state-previous").disabled = this.stateIndex === 0;
    document.querySelector("#state-next").disabled =
      this.stateIndex === this.slide.states.length - 1;
    document.querySelector("#state-controls").hidden =
      this.slide.states.length === 1 && !this.editor;
    const progress = document.querySelector(".progress");
    progress.replaceChildren();
    this.menu.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "eyebrow";
    heading.textContent = "In this presentation";
    this.menu.append(heading);
    this.document.slides.forEach((slide, i) => {
      const a = document.createElement("a");
      a.href = "#" + slide.id;
      a.setAttribute("aria-label", slide.title);
      if (i === this.index) a.setAttribute("aria-current", "step");
      progress.append(a);
      const item = a.cloneNode(true);
      item.textContent = `${String(i + 1).padStart(2, "0")}  ${slide.title}`;
      this.menu.append(item);
    });
    this.closeIndex();
    const announcement = document.querySelector("#player-announcement");
    announcement.textContent = `Slide ${this.index + 1}: ${this.slide.title}. State ${this.stateIndex + 1}: ${this.state.label}.`;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.main.querySelectorAll(".active [data-animation]").forEach((el) => {
        if (el.closest("[hidden]")) return;
        const a = JSON.parse(el.dataset.animation);
        const frames =
          a.name === "rise"
            ? [
                { opacity: 0, translate: "0 14px" },
                { opacity: 1, translate: el.style.translate || "0 0" },
              ]
            : a.name === "scale"
              ? [
                  { opacity: 0, scale: 0.94 },
                  { opacity: 1, scale: el.style.scale || 1 },
                ]
              : [{ opacity: 0 }, { opacity: el.style.opacity || 1 }];
        el.animate(frames, {
          duration: a.duration,
          delay: a.delay,
          easing: "ease-out",
        });
      });
    }
    if (focusId && this.main.querySelector("#" + CSS.escape(focusId)))
      this.main
        .querySelector("#" + CSS.escape(focusId))
        .focus({ preventScroll: true });
  }
}
