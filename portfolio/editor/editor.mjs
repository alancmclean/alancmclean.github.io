import { installCanvas } from "./canvas.mjs";
import {
  applyPatch,
  contextFor,
  flatten,
  validateDocument,
  validatePatch,
  writeDraft,
  readDraft,
  DRAFT_KEY,
} from "../runtime/model.mjs";
const $ = (s) => document.querySelector(s);
const download = (name, text) => {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export async function startEditor(player, published) {
  const panel = $("#inspector");
  let doc = structuredClone(published),
    selected = player.slide.root.id,
    pending = null,
    conflict = false,
    storageBlocked = false,
    bridge = false,
    savePlan = null;
  let canvas;
  const undo = [],
    redo = [];
  panel.innerHTML = `<div class="inspector-heading"><div><span class="editor-kicker">LOCAL STUDIO</span><h2>Slide inspector</h2></div><button id="close-editor" aria-label="Close inspector">×</button></div>
  <p class="editor-note">Drafts stay in this browser. Published viewers always use repository data.</p>
  <p id="draft-status" role="status" aria-live="polite"></p><div class="button-row"><button id="undo-edit">Undo</button><button id="redo-edit">Redo</button><button id="play-edit">Play draft</button></div>
  <label>Slide<select id="slide-select"></select></label><label>Slide title<input id="slide-title" maxlength="200"></label><label>State<select id="state-select"></select></label><div class="button-row"><button id="add-state">Duplicate state</button><button id="delete-state">Delete state</button></div><label>State name<input id="state-name" maxlength="100"></label>
  <details open><summary>Elements <span id="element-count"></span></summary><p class="editor-note">Select here or click an element on the canvas. Changes affect this state only.</p><label>Selected element<select id="element-select"></select></label><div id="element-properties"></div><button id="reset-element">Reset state overrides</button></details>
  <details><summary>Prompt to edit</summary><p class="connection-label">Agent handoff · No live MCP connection</p><p class="editor-note">Export this slide and your prompt to Codex/Dot. Paste the returned JSON patch here, preview it, then apply. Prompts are not stored or sent automatically.</p><label>Your prompt<textarea id="agent-prompt" rows="3" placeholder="Move the title up 20px in this state…"></textarea></label><div class="button-row"><button id="copy-context">Copy context + prompt</button><button id="download-context">Download context</button></div><label>Returned JSON patch<textarea id="patch-input" rows="5" spellcheck="false" placeholder='{"schemaVersion":1,…}'></textarea></label><button id="preview-patch">Preview patch</button></details>
  <section id="preview-actions" hidden><strong>Preview only — not saved</strong><p id="preview-summary"></p><div class="button-row"><button id="apply-preview">Apply changes</button><button id="cancel-preview">Cancel preview</button></div></section>
  <details><summary>Storage & review</summary><p id="bridge-status" class="editor-note">Checking local save bridge…</p><div class="button-row"><button id="export-draft">Export draft JSON</button><button id="import-draft">Import draft</button></div><input id="draft-file" type="file" accept=".json,application/json" hidden><button id="save-review">Save to review branch…</button><p class="editor-note">Repository saves are public. Review every state and image before saving. Embedded draft images are included; prompts and unrelated browser storage are not.</p><div class="button-row"><button id="export-recovery">Export stored recovery data</button><button id="reset-draft">Reset local draft…</button></div><button id="load-other-tab" hidden>Load the other tab’s draft</button></details>
  <details><summary>Debug</summary><pre id="debug-output"></pre></details>
  <dialog id="save-dialog"><h2>Save a public review branch</h2><p id="save-summary"></p><p>This creates a Git commit on a new review branch. It does not merge or deploy. The saved JSON contains all slides and states, including hidden elements.</p><label class="check-row"><input type="checkbox" id="public-confirm">I reviewed all content and it is safe for this public repository.</label><div class="button-row"><button id="confirm-save">Push review branch</button><button id="cancel-save">Cancel</button></div><p id="save-result" role="status"></p></dialog>`;
  function status(text, error = false) {
    $("#draft-status").textContent = text;
    $("#draft-status").classList.toggle("error", error);
  }
  function open() {
    document.body.classList.remove("inspector-collapsed");
    panel.hidden = false;
    document.body.classList.add("editing");
    refresh();
    $("#close-editor").focus();
  }
  function close() {
    canvas?.cancel();
    document.activeElement?.blur();
    cancelPreview();
    panel.hidden = true;
    document.body.classList.remove("editing");
    $("#edit-toggle").focus();
  }
  function persist() {
    if (conflict || storageBlocked) {
      status(
        "Draft is in memory only. Export it before resetting or closing.",
        true,
      );
      return;
    }
    try {
      const time = writeDraft(localStorage, doc, published);
      status(
        `Saved locally · ${new Date(time).toLocaleTimeString()} · revision ${doc.revision}`,
      );
    } catch (e) {
      storageBlocked = true;
      status(
        "Local storage failed. Your changes are in memory; export draft JSON now. " +
          e.message,
        true,
      );
    }
  }
  function refresh() {
    const slide = doc.slides[player.index],
      state = slide.states[player.stateIndex];
    fill(
      $("#slide-select"),
      doc.slides.map((s) => [s.id, s.title]),
      slide.id,
    );
    fill(
      $("#state-select"),
      slide.states.map((s) => [s.id, s.label]),
      state.id,
    );
    $("#slide-title").value = slide.title;
    $("#slide-title").disabled = !!pending;
    $("#state-name").value = state.label;
    $("#state-name").disabled = !!pending;
    $("#delete-state").disabled = slide.states.length < 2 || !!pending;
    const nodes = flatten(slide.root);
    if (!nodes.some((n) => n.id === selected)) selected = slide.root.id;
    fill(
      $("#element-select"),
      nodes.map((n) => [
        n.id,
        `${n.type} · ${n.text?.trim().slice(0, 45) || n.id}`,
      ]),
      selected,
    );
    $("#element-count").textContent = `(${nodes.length})`;
    properties();
    $("#undo-edit").disabled = !undo.length || !!pending;
    $("#redo-edit").disabled = !redo.length || !!pending;
    $("#add-state").disabled = !!pending || slide.states.length >= 30;
    $("#save-review").disabled =
      !bridge || !!pending || conflict || storageBlocked;
    $("#debug-output").textContent = JSON.stringify(
      {
        schemaVersion: doc.schemaVersion,
        presentation: doc.id,
        revision: doc.revision,
        slide: slide.id,
        state: state.id,
        element: selected,
        preview: !!pending,
        storage: conflict
          ? "conflict"
          : storageBlocked
            ? "unavailable"
            : "local",
        bridge: bridge ? "connected" : "not connected",
      },
      null,
      2,
    );
  }
  function fill(select, options, value) {
    select.replaceChildren(
      ...options.map(([v, label]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        return o;
      }),
    );
    select.value = value;
  }
  function properties() {
    const slide = doc.slides[player.index],
      state = slide.states[player.stateIndex],
      node = flatten(slide.root).find((n) => n.id === selected),
      props = { ...node.base, ...state.overrides[selected] };
    const box = $("#element-properties");
    box.replaceChildren();
    const inputs = [
      ...(props.frame
        ? [
            ["frame.x", "Center X (%)", 50, -100, 200, 0.1],
            ["frame.y", "Center Y (%)", 50, -100, 200, 0.1],
            ["frame.width", "Width (% canvas width)", 20, 0.1, 300, 0.1],
            ["frame.height", "Height (% canvas width)", 20, 0.1, 300, 0.1],
            ["frame.angle", "Rotation (°)", 0, -360, 360, 1],
          ]
        : [
            ["x", "X offset", 0, -3000, 3000, 1],
            ["y", "Y offset", 0, -3000, 3000, 1],
            ["scale", "Scale", 1, 0.1, 5, 0.05],
            ["rotate", "Rotation offset", 0, -360, 360, 1],
            ["width", "Width", null, 20, 2400, 1],
          ]),
      ["opacity", "Opacity", 1, 0, 1, 0.05],
      ["zIndex", "Layer", 0, -10, 100, 1],
      ["fontSize", "Font size", null, 8, 200, 1],
    ];
    const grid = document.createElement("div");
    grid.className = "property-grid";
    box.append(grid);
    for (const [key, title, fallback, min, max, step] of inputs) {
      const label = document.createElement("label");
      label.textContent = title;
      const input = document.createElement("input");
      input.type = "number";
      input.id = "prop-" + key;
      input.min = min;
      input.max = max;
      input.step = step;
      input.placeholder = "Inherit";
      input.value =
        (key.startsWith("frame.") ? props.frame[key.slice(6)] : props[key]) ??
        fallback ??
        "";
      input.disabled = !!pending;
      input.onchange = () => {
        if (key.startsWith("frame.")) {
          change({
            frame: { ...props.frame, [key.slice(6)]: Number(input.value) },
          });
          return;
        }
        if (input.value === "") {
          removeProp(key);
          return;
        }
        change({ [key]: Number(input.value) });
      };
      label.append(input);
      grid.append(label);
    }
    for (const [key, title, values] of [
      ["animation", "Animation", ["none", "fade", "rise", "scale"]],
      [
        "transformOrigin",
        "Transform origin",
        ["center", "top left", "top right", "bottom left", "bottom right"],
      ],
    ]) {
      if (props.frame && key === "transformOrigin") continue;
      const label = document.createElement("label");
      label.textContent = title;
      const select = document.createElement("select");
      select.id = "prop-" + key;
      fill(
        select,
        values.map((v) => [v, v]),
        props[key] || values[0],
      );
      select.disabled = !!pending;
      select.onchange = () => change({ [key]: select.value });
      label.append(select);
      box.append(label);
    }
    for (const [key, title, fallback] of [
      ["animationDuration", "Duration (ms)", 260],
      ["animationDelay", "Delay (ms)", 0],
    ]) {
      const label = document.createElement("label");
      label.textContent = title;
      const input = document.createElement("input");
      input.id = "prop-" + key;
      input.type = "number";
      input.min = 0;
      input.max = 3000;
      input.value = props[key] ?? fallback;
      input.disabled = !!pending;
      input.onchange = () => change({ [key]: Number(input.value) });
      label.append(input);
      grid.append(label);
    }
    for (const key of ["color", "backgroundColor"]) {
      const label = document.createElement("label");
      label.textContent = key === "color" ? "Text color" : "Background";
      const input = document.createElement("input");
      input.id = "prop-" + key;
      input.placeholder = "#dce3d7 or transparent";
      input.value = props[key] ?? "";
      input.disabled = !!pending;
      input.onchange = () =>
        input.value ? change({ [key]: input.value }) : removeProp(key);
      label.append(input);
      box.append(label);
    }
    const visible = document.createElement("label");
    visible.className = "check-row";
    const check = document.createElement("input");
    check.id = "prop-visible";
    check.type = "checkbox";
    check.checked = props.visible !== false;
    check.disabled = !!pending;
    check.onchange = () => change({ visible: check.checked });
    visible.append(check, document.createTextNode("Visible in this state"));
    box.append(visible);
    if (node.type === "text") {
      const label = document.createElement("label");
      label.textContent = "Text";
      const textarea = document.createElement("textarea");
      textarea.id = "prop-text";
      textarea.rows = 3;
      textarea.value = props.text ?? node.text;
      textarea.disabled = !!pending;
      textarea.onchange = () => change({ text: textarea.value });
      label.append(textarea);
      box.append(label);
    }
    if (node.type === "link") {
      const label = document.createElement("label");
      label.textContent = "Link (https, /path, or #slide)";
      const input = document.createElement("input");
      input.id = "prop-href";
      input.value = props.href ?? node.attrs?.href ?? "";
      input.disabled = !!pending;
      input.onchange = () => change({ href: input.value });
      label.append(input);
      box.append(label);
    }
  }
  function commit(next, { render = true, history = true } = {}) {
    if (pending) throw Error("Apply or cancel the preview first");
    validateDocument(next);
    if (history) undo.push(structuredClone(doc));
    if (undo.length > 50) undo.shift();
    redo.length = 0;
    doc = next;
    if (render) {
      player.setDocument(doc);
      player.select(selected);
    } else player.document = doc;
    persist();
    refresh();
  }
  function change(changes) {
    try {
      commit(
        applyPatch(doc, {
          schemaVersion: 1,
          presentationId: doc.id,
          baseRevision: doc.revision,
          slideId: player.slide.id,
          stateId: player.state.id,
          operations: [{ elementId: selected, changes }],
        }),
      );
    } catch (e) {
      status(e.message, true);
    }
  }
  function removeProp(key) {
    if (pending) return;
    const copy = structuredClone(doc),
      state = copy.slides[player.index].states[player.stateIndex];
    if (state.overrides[selected]) delete state.overrides[selected][key];
    copy.revision++;
    commit(copy);
  }
  function cancelPreview() {
    if (!pending) return;
    pending = null;
    player.setDocument(doc);
    $("#preview-actions").hidden = true;
    refresh();
  }
  function preview(next, summary) {
    cancelPreview();
    pending = { document: next };
    player.setDocument(next);
    $("#preview-summary").textContent = summary;
    $("#preview-actions").hidden = false;
    refresh();
  }
  try {
    const draft = readDraft(localStorage, published);
    if (draft) {
      doc = draft.document;
      player.setDocument(doc);
      status("Restored local draft · revision " + doc.revision);
    } else status("No draft yet · Published data loaded");
  } catch (e) {
    storageBlocked = true;
    status("Stored draft was preserved but not loaded. " + e.message, true);
  }
  player.addEventListener("edit", () => (panel.hidden ? open() : close()));
  player.addEventListener("select", (e) => {
    selected = e.detail;
    properties();
    $("#element-select").value = selected;
  });
  player.addEventListener("beforeNavigate", cancelPreview);
  player.addEventListener("navigate", () => {
    selected = player.slide.root.id;
    refresh();
  });
  $("#close-editor").onclick = close;
  $("#play-edit").onclick = close;
  $("#slide-select").onchange = (e) =>
    player.go(doc.slides.findIndex((s) => s.id === e.target.value));
  $("#state-select").onchange = (e) =>
    player.go(
      player.index,
      player.slide.states.findIndex((s) => s.id === e.target.value),
    );
  $("#element-select").onchange = (e) => player.select(e.target.value);
  $("#slide-title").onchange = (e) => {
    if (pending) return;
    const copy = structuredClone(doc);
    copy.slides[player.index].title = e.target.value;
    copy.revision++;
    commit(copy);
  };
  $("#state-name").onchange = (e) => {
    if (pending) return;
    const copy = structuredClone(doc);
    copy.slides[player.index].states[player.stateIndex].label = e.target.value;
    copy.revision++;
    commit(copy);
  };
  $("#add-state").onclick = () => {
    if (pending) return;
    const copy = structuredClone(doc),
      slide = copy.slides[player.index],
      state = structuredClone(slide.states[player.stateIndex]);
    state.id =
      "state-" +
      Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) =>
        part.toString(16).padStart(8, "0"),
      ).join("");
    state.label += " copy";
    slide.states.push(state);
    copy.revision++;
    commit(copy);
    player.go(player.index, slide.states.length - 1);
  };
  $("#delete-state").onclick = () => {
    if (pending || player.slide.states.length === 1) return;
    const removed = player.state.id;
    const targets =
      flatten(player.slide.root).some(
        (n) =>
          n.action?.target === removed ||
          n.action?.activeStates?.includes(removed),
      ) ||
      player.slide.states.some((s) =>
        Object.values(s.overrides).some((p) => p.stateTarget === removed),
      );
    if (targets) {
      status(
        "This state is linked by an interactive element and cannot be deleted.",
        true,
      );
      return;
    }
    const copy = structuredClone(doc);
    copy.slides[player.index].states.splice(player.stateIndex, 1);
    copy.revision++;
    commit(copy);
  };
  $("#reset-element").onclick = () => {
    if (pending) return;
    const copy = structuredClone(doc);
    delete copy.slides[player.index].states[player.stateIndex].overrides[
      selected
    ];
    copy.revision++;
    commit(copy);
  };
  function historyMove(from, to) {
    canvas?.cancel();
    document.activeElement?.blur();
    if (pending || !from.length) return;
    to.push(structuredClone(doc));
    const next = from.pop();
    next.revision = doc.revision + 1;
    doc = next;
    player.setDocument(doc);
    persist();
    refresh();
  }
  $("#undo-edit").onclick = () => historyMove(undo, redo);
  $("#redo-edit").onclick = () => historyMove(redo, undo);
  const context = () =>
    JSON.stringify(
      contextFor(
        doc,
        player.slide.id,
        player.state.id,
        $("#agent-prompt").value,
      ),
      null,
      2,
    );
  $("#download-context").onclick = () =>
    download(`slide-${player.slide.id}-context.json`, context());
  $("#copy-context").onclick = async () => {
    try {
      await navigator.clipboard.writeText(context());
      status("Context copied. Paste into Codex/Dot; no request has been sent.");
    } catch {
      status("Clipboard unavailable. Use Download context.", true);
    }
  };
  $("#preview-patch").onclick = () => {
    cancelPreview();
    try {
      const patch = JSON.parse($("#patch-input").value);
      validatePatch(patch, doc);
      if (
        patch.slideId !== player.slide.id ||
        patch.stateId !== player.state.id
      )
        throw Error("Patch must target the currently selected slide and state");
      preview(
        applyPatch(doc, patch),
        `${patch.operations.length} validated change(s) to ${player.slide.title} / ${player.state.label}`,
      );
    } catch (e) {
      status(e.message, true);
    }
  };
  $("#apply-preview").onclick = () => {
    if (!pending) return;
    const next = pending.document;
    pending = null;
    $("#preview-actions").hidden = true;
    commit(next);
    $("#patch-input").value = "";
  };
  $("#cancel-preview").onclick = cancelPreview;
  $("#export-draft").onclick = () =>
    download("portfolio-draft.json", JSON.stringify(doc, null, 2));
  $("#export-recovery").onclick = () => {
    try {
      download(
        "portfolio-recovery.json",
        localStorage.getItem(DRAFT_KEY) || "null",
      );
    } catch (e) {
      status(e.message, true);
    }
  };
  $("#import-draft").onclick = () => $("#draft-file").click();
  $("#draft-file").onchange = async (e) => {
    cancelPreview();
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1500000) throw Error("Draft exceeds 1.5 MB");
      const next = validateDocument(JSON.parse(await file.text()));
      if (next.id !== doc.id)
        throw Error("This draft belongs to another presentation");
      next.revision = doc.revision + 1;
      preview(
        next,
        "Imported draft · All slides and states will replace your local draft after applying.",
      );
    } catch (e) {
      status(e.message, true);
    }
    e.target.value = "";
  };
  $("#reset-draft").onclick = () => {
    if (
      !confirm(
        "Reset this browser’s draft to repository data? Export a backup first if needed.",
      )
    )
      return;
    cancelPreview();
    try {
      localStorage.removeItem(DRAFT_KEY);
      storageBlocked = false;
      conflict = false;
      doc = structuredClone(published);
      undo.length = redo.length = 0;
      player.setDocument(doc);
      $("#load-other-tab").hidden = true;
      status("Local draft reset. Repository data loaded.");
      refresh();
    } catch (e) {
      status(e.message, true);
    }
  };
  window.addEventListener("storage", (e) => {
    if (e.key !== DRAFT_KEY) return;
    conflict = true;
    $("#load-other-tab").hidden = false;
    status(
      "Another tab changed the draft. Export your current work or load its version before continuing.",
      true,
    );
    refresh();
  });
  $("#load-other-tab").onclick = () => {
    try {
      cancelPreview();
      const draft = readDraft(localStorage, published);
      doc = structuredClone(draft?.document || published);
      conflict = false;
      storageBlocked = false;
      undo.length = redo.length = 0;
      player.setDocument(doc);
      $("#load-other-tab").hidden = true;
      status("Loaded the other tab’s version.");
      refresh();
    } catch (e) {
      status(e.message, true);
    }
  };
  window.addEventListener("beforeunload", (e) => {
    if (storageBlocked || conflict || pending) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  $("#save-review").onclick = async () => {
    if (!bridge || pending || conflict || storageBlocked) return;
    try {
      const response = await fetch("/__portfolio/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: doc }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      savePlan = result;
      $("#save-summary").textContent = result.summary;
      $("#public-confirm").checked = false;
      $("#save-result").textContent = "";
      $("#confirm-save").disabled = false;
      $("#save-dialog").showModal();
    } catch (e) {
      status("Review save unavailable: " + e.message, true);
    }
  };
  $("#cancel-save").onclick = () => $("#save-dialog").close();
  $("#confirm-save").onclick = async () => {
    if (!$("#public-confirm").checked) {
      $("#save-result").textContent =
        "Confirm the content is safe for this public repository first.";
      return;
    }
    $("#confirm-save").disabled = true;
    $("#save-result").textContent = "Creating the review branch…";
    try {
      const response = await fetch("/__portfolio/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: savePlan.planId,
          confirmedPublic: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      $("#save-result").textContent = result.message + " ";
      if (result.reviewURL) {
        const a = document.createElement("a");
        a.href = result.reviewURL;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open review";
        $("#save-result").append(a);
      }
      status("Saved to review branch. Live site unchanged.");
    } catch (e) {
      $("#save-result").textContent =
        e.message + " Check the branch before attempting another save.";
    }
  };
  try {
    const response = await fetch("/__portfolio/status");
    if (response.ok) {
      const result = await response.json();
      bridge = result.service === "portfolio-local-bridge-v1" && result.canSave;
      $("#bridge-status").textContent = bridge
        ? "Local bridge connected. Git authentication stays on this machine."
        : "Local bridge is read-only: " + result.reason;
    }
  } catch {}
  if (!bridge)
    $("#bridge-status").textContent =
      "Repository save is not connected. Run “npm run dev” in portfolio/ on your authenticated local checkout. Export/import still work here.";
  canvas = installCanvas(player, {
    getDocument: () => doc,
    commit,
    status,
    isPreview: () => !!pending,
  });
  refresh();
  open();
}
