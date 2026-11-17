import { Player } from "./player.mjs";
const editor = document.body.dataset.mode === "editor";
try {
  const response = await fetch(
    new URL("../presentation.json", import.meta.url),
    { cache: "no-cache" },
  );
  if (!response.ok) throw Error("Presentation data could not be loaded");
  const published = await response.json();
  const player = new Player(published, { editor });
  // The public player never reads draft storage or imports the editing module.
  if (editor) {
    const { startEditor } =
      await import("../editor/editor.mjs?release=body-drag-20261117");
    await startEditor(player, published);
  }
} catch (error) {
  const message = document.createElement("p");
  message.className = "load-error";
  message.setAttribute("role", "alert");
  message.textContent = `${error.message}. The original presentation remains available below.`;
  document.body.prepend(message);
}
