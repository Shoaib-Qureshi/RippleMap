# FlowLens — Product Requirements Document

> Working name: **FlowLens**. A VS Code extension that shows, in real time while you vibecode, *what the AI changed*, *how your app's workflow works now*, and *how that workflow changes after the edit*.

**Status:** Draft v0.1 · **Owner:** Shoaib · **Platform:** VS Code (Windows, macOS, Linux; developed on Windows)

---

## 1. Problem

When vibecoding with an AI agent (Claude Code, Copilot agent, Cursor-style tools), code changes arrive faster than a developer can understand them. Existing tools show *diffs* (text) or *agent activity* (tool calls), but none show the **effect of the edit on the application's logic flow**. Developers accept changes they don't fully understand, lose the mental model of their codebase, and discover broken flows late.

## 2. Existing landscape (why build this)

| Tool | What it does | Gap |
|---|---|---|
| Codag | Live workflow graphs for LLM/AI pipelines, AST-diff live updates | AI/LLM code only; no before/after of pending edits |
| Agent Flow | Visualizes Claude Code agent orchestration in real time | Shows agent behavior, not your app's flow |
| Argus | Claude Code session debugger/analyzer | Session analytics, not code-flow |
| OptiMap | Graphs AI agent workflow/skill files | Agent config, not application code |

**Unmet need:** live edit tracking + app-flow graph + before/after preview of the change, for general code (including PHP/WordPress, JS/TS, Python).

## 3. Goals

1. Show every AI-made edit as it happens: **which file, which lines/functions**.
2. Render the **current workflow** of the codebase as an interactive graph.
3. Show the **after-edit workflow** and a **graph diff** (added / removed / changed) in real time.
4. Let the user **preview a pending edit's impact before it lands** (when the agent exposes the proposed change).
5. Stay fast (<300 ms graph update for a single-file edit) and local-first (no code leaves the machine by default).

## 4. Non-goals (v1)

- Not an AI agent or code generator itself.
- No runtime tracing / profiling (static analysis only in v1).
- No cloud sync, accounts, or team features.
- No support for editors other than VS Code.

## 5. Target users

- Solo developers and agency owners vibecoding across multiple client projects.
- Developers reviewing AI-generated changes who want to understand impact quickly.

## 6. Feature list

### 6.1 Edit Tracking
- F1. Live **Edit Feed** panel: timestamped list of edits (file, +/- lines, affected symbols, source: AI agent vs manual).
- F2. Detect AI-agent edits via Claude Code hooks (primary), and fall back to file-system/document-change heuristics for other agents.
- F3. Per-edit detail view: inline diff + list of functions/classes/hooks touched.
- F4. Editor decorations: gutter markers and highlights on recently AI-edited lines (fade over time).
- F5. Session grouping: group edits by agent session/prompt.

### 6.2 Workflow Graph
- F6. **File-level graph:** import/require/include dependency graph.
- F7. **Function-level graph:** call graph (functions, methods, classes) built with Tree-sitter.
- F8. **Framework-aware flow layer** (pluggable extractors):
  - WordPress/PHP: `add_action`, `add_filter`, shortcodes, REST routes, WooCommerce hooks.
  - JS/TS: module imports, Express/Next routes, React component tree (basic).
  - Python: imports, function calls, Flask/FastAPI routes (basic).
- F9. Click-to-source: clicking a node opens the file at the exact line.
- F10. Filters: by folder, language, edit recency, node type; search box.
- F11. Layout options (top-down, left-right, clustered by folder) and zoom/minimap.

### 6.3 Before/After & Diff
- F12. **Snapshot store:** graph snapshot before each edit batch.
- F13. **Graph diff view:** nodes/edges colored green (added), red (removed), amber (modified), grey (unchanged, dimmed).
- F14. **Time scrubber:** step back/forward through edit history and see the graph at each step.
- F15. **Pre-edit preview (pending change):** from the agent's proposed edit (PreToolUse hook), compute the would-be graph and show the diff *before* the change is applied.
- F16. Impact summary: "This edit adds 2 functions, removes 1 call edge, changes 3 callers" in plain language.

### 6.4 Insights
- F17. Highlight risky changes: new circular dependencies, orphaned functions, removed callers that still have references.
- F18. Optional AI explanation of an edit's flow impact (opt-in, uses user's own API key / VS Code Language Model API).

### 6.5 Integration & Export
- F19. One-command setup: **"FlowLens: Install Claude Code Hooks"** writes hook config safely.
- F20. Optional local **MCP server** exposing the current graph to agents.
- F21. Export graph / diff as PNG, SVG, or Mermaid.
- F22. Theme-aware UI (light/dark).

## 7. User stories

- As a vibecoder, I see a live list of files my agent just changed, so I know the blast radius.
- As a developer, I see the flow graph update the moment an edit lands, so I keep my mental model current.
- As a reviewer, I see what the graph will look like *after* a proposed edit before I accept it.
- As an agency dev, I open any client project and get a workable graph without configuration.

## 8. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Extension activates on workspace open and on command; no impact on startup time (>200 ms budget) | P0 |
| FR-2 | Receive edit events from Claude Code hooks over localhost HTTP with a per-session auth token | P0 |
| FR-3 | Parse JS/TS and PHP and Python via `web-tree-sitter` (WASM) incrementally | P0 |
| FR-4 | Build and cache file-level and function-level graphs per workspace | P0 |
| FR-5 | Compute graph diff between two snapshots | P0 |
| FR-6 | Webview graph with click-to-source | P0 |
| FR-7 | Edit Feed with diff view | P0 |
| FR-8 | Pre-edit preview via proposed-content parsing | P1 |
| FR-9 | WordPress hook/shortcode extractor | P1 |
| FR-10 | Time scrubber across snapshots | P1 |
| FR-11 | Editor gutter decorations | P1 |
| FR-12 | Risk insights (cycles, orphans) | P2 |
| FR-13 | Optional AI explanation | P2 |
| FR-14 | MCP server and exports | P2 |

## 9. Non-functional requirements

- **Performance:** single-file graph update <300 ms; initial workspace index of 2,000 files <15 s with progress UI; webview stays smooth up to ~1,500 visible nodes (collapse/cluster beyond that).
- **Privacy:** fully local; no telemetry by default; any AI feature is opt-in with user's own key.
- **Security:** hook server binds to `127.0.0.1` only, random port, random token, rejects unauthenticated requests; never executes code from the workspace.
- **Reliability:** hook forwarder must never block or fail the agent (always exit 0 fast).
- **Cross-platform:** works on Windows paths (backslashes, drive letters, CRLF); no native modules that require a build toolchain.
- **Accessibility:** keyboard navigation of the Edit Feed; color-blind-safe diff palette plus icons.

## 10. UX overview

- **Activity Bar icon → FlowLens sidebar:** Edit Feed (tree view) + filters.
- **Main panel (webview):** graph canvas with top toolbar [Current | After | Diff] toggle, layout selector, search, time scrubber at bottom.
- **Details drawer:** selected node/edit with code snippet, callers/callees, and impact summary.
- **Status bar item:** "FlowLens: 3 edits · +2 nodes · −1 edge" click to open panel.

## 11. Success metrics

- Time from edit landing to graph updated: p95 < 500 ms.
- User can identify "what this edit changed in the flow" in <10 s (qualitative test).
- Graph diff correctness: >95% accuracy on a fixture suite of known edits.
- Zero agent failures caused by FlowLens hooks.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Static call graphs are imprecise (dynamic dispatch, WP hooks) | Label edges with confidence; framework extractors; clear "static analysis" messaging |
| Large repos make graph unreadable | Default to file-level + changed-neighborhood view; clustering; node caps |
| Agent hook APIs change | Isolate in an `AgentAdapter` interface; verify against current Claude Code docs; keep fallback watcher |
| Pre-edit preview needs proposed content | Apply `old_string→new_string` / `content` from hook payload to current file text in memory |
| Tree-sitter WASM bundling in VS Code | Use `web-tree-sitter` + prebuilt grammars; copy WASM in build step |

## 13. Open questions

1. Support Copilot agent / Cursor edits in v1, or Claude Code only?
2. Should pre-edit preview ever *block* an edit awaiting approval (hook-based gating), or be passive only?
3. Which framework extractors beyond WordPress matter most?
4. Publish to Marketplace, or private `.vsix` for own use first?

## 14. Milestones

See `ROADMAP.md`.
