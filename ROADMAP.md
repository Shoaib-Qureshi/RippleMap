# FlowLens — Roadmap & Milestones

Each milestone ends with a working, demoable extension and a git commit/tag.

## M0 — Scaffold (½ day)
- Extension scaffold (TypeScript, esbuild), webview scaffold (Vite + React), F5 debug works on Windows.
- Command `FlowLens: Open Panel` shows an empty webview with typed messaging.
- Lint, format, vitest set up.
**Accept:** panel opens; round-trip `ready` ↔ `init` message works.

## M1 — Edit tracking (1–2 days)
- `EditTracker`, `ManualEditAdapter` (document change + watcher), Edit Feed tree view, status bar.
- Inline diff view for an edit; gutter decorations that fade.
**Accept:** editing any file creates a feed entry with file, +/- lines, and changed ranges.

## M2 — Claude Code hooks (1–2 days)
- `HookServer` with token auth, `hook-forwarder.js`, `FlowLens: Install Claude Code Hooks` (safe merge + backup).
- `ClaudeCodeAdapter` for Pre/PostToolUse; source labeling (AI vs manual).
**Accept:** running Claude Code on a test repo produces `proposed` then `applied` events; agent never slowed or blocked.

## M3 — Parsing + file-level graph (2 days)
- `ParserService` with web-tree-sitter (JS/TS/PHP/Python), import extractor, workspace indexing with progress.
- Graph rendered in webview with click-to-source, filters, layouts.
**Accept:** open a real project, see an accurate dependency graph; click a node opens the file.

## M4 — Before/after diff (2 days)
- `SnapshotStore`, `GraphDiffer`, diff coloring, [Current | After | Diff] toggle, impact summary text.
**Accept:** an edit that adds/removes an import visibly adds/removes an edge in green/red within 500 ms.

## M5 — Function-level graph (2–3 days)
- Call-graph extractor, node kinds (function/method/class), changed-neighborhood default view, clustering.
**Accept:** editing one function highlights it and its callers/callees; diff shows added/removed calls.

## M6 — Pending-edit preview (2 days)
- `PendingEditPreview`: apply proposed edit in memory, build cloned graph, show "Pending" diff; promote on `applied`.
**Accept:** the diff appears before the file on disk changes; discarded cleanly if the edit is rejected.

## M7 — WordPress/PHP flow layer (2 days)
- `add_action`/`add_filter` registration edges, shortcodes, REST routes, WooCommerce hooks.
**Accept:** a sample WP plugin shows hook → callback flows; changing a callback updates the graph.

## M8 — Time scrubber + insights (2 days)
- Scrubber over snapshots, cycle/orphan/removed-caller warnings.
**Accept:** scrubbing reproduces past graphs; a seeded cycle is flagged.

## M9 — Polish & ship (2–3 days)
- Exports (PNG/SVG/Mermaid), theming, settings, README with GIFs, icon, Windows CI, `.vsix` packaging, optional Marketplace publish.
- (Stretch) MCP server; opt-in AI explanation of an edit's flow impact.
**Accept:** clean install from `.vsix` on a fresh Windows machine; all fixture tests green.

## Backlog / ideas
- Copilot / Cursor adapters · runtime tracing overlay · Webflow/Elementor export awareness · team sharing of snapshots · PR-diff mode (graph diff for a git branch).
