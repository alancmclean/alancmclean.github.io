# Selected work — player and local studio

The public player is `/portfolio/`; the editor is `/portfolio/editor/`. This implementation is on a review branch, **not deployed**. The homepage, CV, existing assets, CNAME, and Pages configuration are unchanged.

## Run locally

From `portfolio/`, with Node 24 or later:

```sh
npm run dev
```

Open http://127.0.0.1:8787/portfolio/ or http://127.0.0.1:8787/portfolio/editor/. No runtime dependencies, API keys, or credential entry are required. `PORTFOLIO_PORT` changes the port. The bridge binds only to loopback and serves portfolio assets, not the homepage, Git metadata, tests, or server source.

A plain static server also runs the player/editor (`python -m http.server 8000` from repository root). On static hosting, local drafts and agent handoff work; repository save is explicitly disconnected.

## Interaction

- **Up / Down:** previous / next slide.
- **Left / Right:** previous / next state. Boundaries do not wrap or change slide.
- Mobile: slide arrow buttons and state controls; horizontal swipes change state. Vertical movement remains scrolling.
- Double-click the empty backdrop to edit. Double-clicking text, cards, links, or controls does not open editing. The visible **Edit** button is the touch/keyboard alternative.
- In edit mode, click an element or select it in the left inspector. **Play draft** closes the inspector and restores product interactions.
- The inspector supports slide/state naming, state duplication/deletion, offsets, scale, rotation offset, opacity, layer, width, font size, colors, alignment, visibility, animation preset/duration/delay, text, and links. Changes affect the selected state only. Position/rotation offsets compose with authored CSS.
- Inputs, selects, textareas, contenteditable fields, dialogs, modifier shortcuts, and inspector controls keep normal keyboard behavior. Inactive slides are inert; state changes are announced; reduced motion disables element animations.

The Docs example has four explicit states: context, refinement, accepted edit, and style. Existing tabs and accept/reset actions navigate the same states. Other slides start with one state; duplicate it to build additional interactions.

## Data contract

`presentation.json` is the source of truth:

```text
presentation (schemaVersion: 1, id, revision, title)
  slides[] (id, title)
    root: typed element tree
    states[] (id, label, overrides: elementId → properties)
```

Reusable types are `group`, `text`, `link`, `button`, and `shape`, using allowlisted semantic tags/attributes and stable IDs. States override base properties; they cannot execute code. Buttons target named states and can declare which states count as active tabs.

Shared `runtime/model.mjs` validation enforces types, bounds, existing targets, size/depth limits, safe links, and exact schema versions. HTML, JavaScript, arbitrary CSS, event attributes, unknown fields, and prototype keys are rejected. Future schema versions require explicit migrations; unsupported versions are preserved for recovery, never guessed at.

`index.html` and `editor/index.html` keep the original static overview as a loading/no-JavaScript fallback. After substantive data-copy changes, update that fallback in the same reviewed change if no-JavaScript parity is needed. `presentation.js` is the preserved legacy script and is no longer loaded.

## Local drafts and recovery

Only the editor reads `alan-portfolio-editor:draft:v1` in localStorage. The public player fetches repository JSON and never reads drafts or imports the editing module. Storage is origin-specific, not a private cloud account or a security boundary against other scripts on the same origin.

Validated edits are revisioned and synchronously persisted with a timestamp and original published-data fingerprint. Undo/redo keeps up to 50 snapshots. Quota/private-mode failures preserve the in-memory draft for export. Corrupt, unsupported, and stale-base drafts are not automatically overwritten. Recovery export downloads raw storage; reset is explicit. Other-tab changes pause persistence until the user resolves the conflict.

Draft JSON export/import works offline; import requires validation and preview/apply. Prompts are not persisted or saved to Git. Hidden elements and all states **are** included in repository saves, so review all content before publishing.

## Prompt-to-edit handoff

There is **no live MCP/model connection** in this static app. The panel states that explicitly. No browser credentials or unrestricted MCP calls are used.

1. Select the exact slide/state and write a prompt.
2. Copy/download context: only that slide, its tree/states, the current revision, and a patch contract.
3. Give it to Codex/Dot and request a JSON patch. Do not invent personal case evidence.
4. Paste the result and preview. Validation checks revision, current slide/state, target IDs, property types, safe links, and bounds. Preview never persists.
5. Apply saves the patch locally; cancel restores the previous document. Navigation cancels preview. Stale or other-slide patches are rejected.

Example (use the actual current revision and IDs from the export):

```json
{
  "schemaVersion": 1,
  "presentationId": "alan-selected-work",
  "baseRevision": 1,
  "slideId": "docs",
  "stateId": "base",
  "operations": [
    {
      "elementId": "docs-title",
      "changes": {
        "x": 20,
        "scale": 1.05,
        "animation": "rise",
        "animationDuration": 250
      }
    }
  ]
}
```

## Save to a review branch

The local bridge uses existing Git authentication and author identity on the user's machine. It does not read/return tokens, accept credentials, change permissions, configure identity, or invoke a model. Authentication can still fail when pushing; the UI reports that failure.

The bridge is pinned to `https://github.com/alancmclean/alancmclean.github.io.git`. Commit tracked implementation changes first: dirty tracked checkouts are refused. **Save to review branch…** prepares an immutable snapshot, then a separate confirmation dialog identifies the target and requires acknowledgment that every slide/state is safe for this public repository.

The bridge revalidates the document, creates a temporary detached worktree at local HEAD, writes/stages **only `portfolio/presentation.json`**, verifies that path, commits, and pushes a new `review/portfolio-data-…` branch without force. It returns an exact GitHub compare link for opening a PR against `gh-pages`. It never merges or deploys. The new branch includes the current committed implementation; uncommitted implementation changes are excluded.

Host/Origin checks, same-origin JSON requests, an HttpOnly SameSite session cookie, loopback binding, body limits, fixed command arguments, and asset allowlists constrain access. Save plans expire after ten minutes. Repeated requests for one plan share one operation. After a failed push, the exact remote branch is inspected; an uncertain result is reported and never automatically retried. No prompt or frontend secret enters the commit.

Deploy to the live branch only after separate approval.

## Tests

```sh
npm test
npm install
npx playwright install chromium
# Start npm run dev separately, then:
npm run test:browser
```

Browser tests use `/usr/bin/chromium` when installed, otherwise Playwright's browser. `CHROMIUM_PATH` and `PORTFOLIO_TEST_URL` override them. Tests do not push: bridge tests inject a Git adapter, and UI save tests intercept save endpoints. Coverage includes scoped patches, unsafe data, draft recovery, save idempotency/uncertain outcomes, navigation, backdrop detection, form keys, inspector overrides, state isolation, prompt privacy, public/draft separation, mobile/touch, and reduced motion.

## Editorial boundaries and sources

Public launch copy and personal-case placeholders are preserved. No contributions, outcomes, confidential process artifacts, or second-project subject were invented. Biography comes from the public homepage. Conceptual illustrations remain labeled; official demos are linked, not presented as Alan's process artifacts.

- April 22 launch: https://workspaceupdates.googleblog.com/2026/04/new-gemini-capabilities-in-google-docs-help-you-go-from-blank-page-to-brilliance.html
- March 10 announcement: https://workspace.google.com/blog/product-announcements/reimagining-content-creation
- Launch film: https://www.youtube.com/watch?v=8wtKHwlKMBQ&t=75s
- Help me create: https://www.youtube.com/watch?v=5G8KoU0Sjh0
- Help me write: https://www.youtube.com/watch?v=-PlUaej62Sg
- Match writing style: https://www.youtube.com/watch?v=2UF3NYT2nLU

No analytics added. Google Fonts remain optional with system fallbacks. `noindex` is not access control.
