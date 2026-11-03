# Selected work presentation

Standalone static presentation at `/portfolio/`. The existing home, CSS, CV, CNAME, and deployment configuration are unchanged. Based on the live `gh-pages` branch at `cffbf5d331037070c72b00afdbacd86b05f769cd`.

## Run

From repository root: `python -m http.server 8000`, then open http://localhost:8000/portfolio/ . No build or package installation required. The root package.json is an existing empty file; check JavaScript with `node --check < portfolio/presentation.js`.

## Interaction and access

Six deep-linked chapters; index, previous/next controls, arrow keys, Home/End, mobile horizontal swipes. Individual chapters scroll when needed. The capability tabs support arrow keys. Reduced-motion preference disables transitions. Inactive chapters are inert. Print and no-JavaScript fallbacks included. Google Fonts are optional; system fallbacks work. No analytics added. `noindex` is a search-engine request, not access control: this is public GitHub Pages.

## Editorial status

This is a public-safe working portfolio, not a completed personal case study. Case 1 contains launch facts, clearly labeled conceptual illustrations, and official video links. Alan’s individual contributions, decisions, process, outcomes, and reflections remain to be supplied. Case 2 intentionally has no invented subject. No private documents or performance metrics are included.

The brief biography is supported by the live site's existing public biography. The Docs overview describes public product capabilities, not Alan's sole authorship.

## Sources

- Google Workspace Updates, April 22, 2026: https://workspaceupdates.googleblog.com/2026/04/new-gemini-capabilities-in-google-docs-help-you-go-from-blank-page-to-brilliance.html
- Google Workspace, March 10, 2026: https://workspace.google.com/blog/product-announcements/reimagining-content-creation
- Official launch film, Docs at 1:15: https://www.youtube.com/watch?v=8wtKHwlKMBQ&t=75s
- Help me create: https://www.youtube.com/watch?v=5G8KoU0Sjh0
- Help me write: https://www.youtube.com/watch?v=-PlUaej62Sg
- Match writing style: https://www.youtube.com/watch?v=2UF3NYT2nLU

The March announcement precedes the April broader rollout. No current availability or quota claims are made. The abstract atmospheric background is original CSS, not copied album artwork. Google video links open on YouTube; no video tracking is loaded by this page.

## Deployment

Publish these four files to the existing `gh-pages` branch using a normal fast-forward push after confirming the remote has not changed. Do not replace the branch with `master`. Expected canonical path: https://alanmclean.org/portfolio/ . Verify the Pages deployment run and published HTML after pushing.
