# FlowLens — Architecture

## 1. Overview

Two runtimes:

1. **Extension host** (Node, TypeScript): edit capture, parsing, graph building, diffing, state.
2. **Webview** (React + React Flow, bundled with Vite/esbuild): rendering and interaction.

They communicate via typed `postMessage` messages. Everything is local.

```
 Claude Code ──hooks──► hook-forwarder.js ──HTTP(127.0.0.1)──► HookServer ─┐
 Manual edits ─► workspace.onDidChangeTextDocument / FileSystemWatcher ───┤
                                                                           ▼
                                                                    EditTracker
                                                                           │ EditEvent
                                                     ┌─────────────────────┴───────────────┐
                                                     ▼                                     ▼
                                              SnapshotStore ◄──── GraphBuilder ◄──── Parser (web-tree-sitter)
                                                     │                 ▲                   ▲
                                                     ▼                 │                   │
                                                GraphDiffer      Extractors (file, call, wordpress, js, python)
                                                     │
                                                     ▼
                                           WebviewBridge ◄──► React Webview (graph, feed, scrubber)
```

## 2. Directory structure

```
flowlens/
├── package.json                  # extension manifest, commands, views, settings
├── tsconfig.json
├── esbuild.config.mjs            # bundles extension
├── CLAUDE.md
├── src/
│   ├── extension.ts              # activate/deactivate, wiring
│   ├── commands/                 # installHooks, openPanel, clearHistory, exportGraph
│   ├── capture/
│   │   ├── EditTracker.ts        # normalizes edits from all sources
│   │   ├── HookServer.ts         # localhost HTTP server + token auth
│   │   ├── AgentAdapter.ts       # interface
│   │   ├── ClaudeCodeAdapter.ts  # parses hook payloads
│   │   └── ManualEditAdapter.ts  # document-change / watcher fallback
│   ├── parse/
│   │   ├── ParserService.ts      # loads WASM grammars, incremental parse cache
│   │   └── grammars/             # copied .wasm files at build
│   ├── graph/
│   │   ├── types.ts              # Graph, Node, Edge, Snapshot, GraphDiff
│   │   ├── GraphBuilder.ts       # orchestrates extractors → Graph
│   │   ├── extractors/
│   │   │   ├── Extractor.ts      # interface
│   │   │   ├── imports.ts        # file-level deps
│   │   │   ├── calls.ts          # function-level call graph
│   │   │   ├── framework.ts      # shared: entry nodes, closure nodes (meta.anchor), registers edges
│   │   │   ├── wordpress.ts      # add_action/add_filter/do_action, shortcodes, REST routes, WooCommerce flag
│   │   │   ├── jsRoutes.ts       # Express app.get(...), Next.js app/**/route.ts exports
│   │   │   └── pythonRoutes.ts   # Flask/FastAPI decorators, add_url_rule
│   │   ├── GraphDiffer.ts
│   │   ├── SnapshotStore.ts      # ring buffer + persistence in workspaceState
│   │   └── insights.ts           # cycles, orphans, removed-caller checks
│   ├── preview/
│   │   └── PendingEditPreview.ts # apply proposed edit in memory → graph → diff
│   ├── ui/
│   │   ├── EditFeedProvider.ts   # TreeDataProvider
│   │   ├── PanelProvider.ts      # webview host
│   │   ├── Decorations.ts        # gutter/line highlights
│   │   └── StatusBar.ts
│   ├── mcp/                      # optional MCP server (P2)
│   ├── shared/messages.ts        # typed host↔webview protocol, imported by both bundles
│   └── util/                     # paths (Windows-safe), logger, debounce
├── hook/
│   └── hook-forwarder.js         # tiny Node script invoked by Claude Code hooks
├── webview/                      # no index.html: PanelProvider writes the HTML (CSP + nonce)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/ (GraphCanvas, EditFeed, DiffLegend, Scrubber, DetailsDrawer, Toolbar)
│   │   ├── state/ (store.ts via zustand)
│   │   └── vscode.ts             # acquireVsCodeApi wrapper (typed postMessage)
│   └── vite.config.mts           # fixed output names: dist/webview/main.js + main.css
└── test/
    ├── fixtures/                 # small projects (js, php/wp-plugin, python) + expected graphs
    ├── unit/*.test.ts            # vitest
    └── integration/              # runTests.mjs launcher + suite.ts (tiny runner, no mocha), bundled to out/
```

## 3. Core data models (TypeScript)

```ts
type NodeKind = 'file' | 'function' | 'method' | 'class' | 'hook' | 'route' | 'shortcode' | 'component';
type EdgeKind = 'imports' | 'calls' | 'registers' | 'renders' | 'extends';

interface GraphNode {
  id: string;              // stable: `${relPath}::${kind}::${name}`
  kind: NodeKind;
  label: string;
  file: string;            // workspace-relative, forward slashes
  range?: { startLine: number; endLine: number };
  meta?: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  confidence: 'high' | 'medium' | 'low';
}

interface Graph { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge>; }

interface EditEvent {
  id: string;
  ts: number;
  source: 'claude-code' | 'manual' | 'other-agent';
  sessionId?: string;
  file: string;
  kind: 'create' | 'modify' | 'delete';
  status: 'proposed' | 'applied';
  before?: string;         // text before
  after?: string;          // text after (or proposed)
  changedRanges: { startLine: number; endLine: number }[];
  added?: number; removed?: number; // undefined = before unknown
}
// Lives in src/capture/EditEvent.ts (with RawEdit, what adapters emit).

interface Snapshot { id: string; ts: number; label: string; editIds: string[]; graph: Graph; }

interface GraphDiff {
  addedNodes: string[]; removedNodes: string[]; modifiedNodes: string[];
  addedEdges: string[]; removedEdges: string[];
  summary: string;         // human-readable impact
}
```

Stable node IDs are essential — diffing relies on them. Use relative path + kind + qualified name; handle renames best-effort.

## 4. Edit capture

### 4.1 Claude Code hooks (primary)
Verified against https://code.claude.com/docs/en/hooks (Oct 2026); all assumptions live in `ClaudeCodeAdapter.ts`.
- `FlowLens: Install Claude Code Hooks` merges entries into `.claude/settings.local.json` of each workspace folder. Existing hooks are kept; FlowLens groups (identified by the `flowlens-hook-forwarder` filename) are replaced, so it is idempotent. The file is backed up first (`settings.local.json.flowlens-backup-<ts>`); invalid JSON is never overwritten. `FlowLens: Remove Claude Code Hooks` removes only FlowLens groups.
- Events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` (matcher `Edit|Write|MultiEdit`; MultiEdit is no longer documented but harmless to match) and `Stop` (no matcher). `timeout: 5` (seconds).
- Payload: `session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input` (`file_path` is absolute), `tool_use_id`, `tool_response` (Post).
- Hook command: `node "<globalStorage>/flowlens-hook-forwarder.js"` — shell form with forward slashes works in both Git Bash and PowerShell (Claude Code's Windows shells). The forwarder is copied to global storage on every activation so the path survives extension updates.
- Forwarder: reads stdin, walks up from `CLAUDE_PROJECT_DIR`/`cwd` looking for `%TEMP%/flowlens/<sha256(normalized dir)[0:16]>.json` (port + token, written by `HookServer`), POSTs with a 400 ms timeout, hard-exits at 700 ms, **always exits 0**. It prints nothing unless HookServer answers 200 with a JSON body (see Agent notes below).
- Agent notes: the user can attach an instruction to any graph node (details drawer → "Instructions for the AI"; stored in `workspaceState` under `flowlens.notes` with the node's file/label/kind). On a `PreToolUse` edit of a file that has notes, HookServer replies 200 with `{hookSpecificOutput: {hookEventName: 'PreToolUse', additionalContext}}` (built by `hookReply` in `ClaudeCodeAdapter`); the forwarder prints it and Claude reads it next to the tool result. Guidance only: FlowLens never denies a tool call.
- Simple mode (webview only): `sharedNodes()` marks nodes with >= 5 incoming edges; `simpleEdges()` drops their unchanged incoming edges unless the hovered/selected node is an endpoint. Layout runs on the simplified edges, and edgeless nodes are placed in a grid below the dagre graph (`layoutGraph`, non-cluster modes).
- Node activity line: `GraphPayload.agent` names who made the shown change (from the step's edit sources, or the pending proposal); the webview's `activities()` turns statuses into "Claude Code: added save, changed load" per changed node.
- `PreToolUse` → `proposed` (proposed text computed in memory: `Edit` old→new, exactly-one-match else `uncertain`, LF strings matched against CRLF files; `Write` content). `PostToolUse` → `applied` (text read from disk). `PostToolUseFailure`/`PermissionDenied` → discard that proposal; `Stop` → discard all remaining proposals (manual denial of a permission dialog fires no hook, so Stop is the cleanup point).
- `HookServer` replies 204 before processing; payloads are handled serially so Pre/Post order is kept.

### 4.2 Fallback
- `ManualEditAdapter`: one edit per **save** (`onDidSaveTextDocument`) + `createFileSystemWatcher` for changes made outside the editor, debounced 150 ms per file.
- `EditTracker` keeps last-known text per file (seeded from open documents and, from M3, the workspace index). Files with no baseline produce an edit with **unknown before** (no +/- counts) until the next edit.
- Merging (3 s window, same file): a manual event identical to a recent agent event is dropped; an agent event arriving after a watcher event replaces it (relabelled as AI); an `applied` event replaces its `proposed` event (matched by `tool_use_id`).
- Activation is `onStartupFinished`, so tracking starts without slowing startup.

### 4.3 AgentAdapter interface
```ts
interface AgentAdapter {
  id: string;
  start(emit: (e: RawEdit) => void): Disposable;   // EditTracker turns RawEdit into EditEvent
}
```
New agents (Copilot, Cursor, etc.) plug in here.

## 5. Parsing & graph building

- `@vscode/tree-sitter-wasm` (Microsoft's build of web-tree-sitter + grammars, versions guaranteed compatible): JS, TS, TSX, PHP, Python. The build copies the `.wasm` files to `dist/grammars`. **No native modules.**
- `ParserService` does a full re-parse per change (no tree cache / `tree.edit()`): a single file parses well inside the 300 ms budget. Trees are `delete()`d right after extraction (WASM memory).
- `GraphBuilder` runs extractors per file into **`FileFacts`** (nodes with stable ids + content hash, unresolved `imports`, name-based `refs`, and direct `edges`). `resolve()` (graph/resolve.ts) turns *all* facts into the workspace graph in one pass; on edit only the changed file is re-extracted, then resolution reruns (cheap: no parsing). `GraphService` debounces rebuilds (30 ms) and emits `update`.
- Cross-file resolution: import resolution (relative paths, tsconfig paths basic, PHP `require/include`, `use`), then symbol-name matching with confidence levels.
- `calls.ts` (runs last): definitions (function / method / class / React component = capitalised function containing JSX) with ids `file::kind::qualified.name`, and refs: calls, `new X()`, `extends`, JSX `<X/>` renders. `this.`/`$this->`/`self.` receivers prefer methods of the same class. Classes hash only their header, so editing a method marks just that method modified. Framework extractors that run earlier can add closure nodes with `meta.anchor = startIndex`; calls inside that closure are attributed to it.
- Framework layer (runs before `calls`): WordPress hooks are workspace-global nodes `wp::hook::<name>` (first registering file owns the node); `add_action/add_filter` → `registers` edge hook → callback (string, `'Class::m'`, `[$this,'m']`, `array(...)`, or a closure node); `do_action/apply_filters` → `calls` edge from the enclosing function to the hook; `add_shortcode` → `wp::shortcode::<tag>`; `register_rest_route` → `wp::route::<METHOD> /ns/route` (linked from an enclosing closure, e.g. inside `rest_api_init`). Routes for Express/Next/Flask/FastAPI are `file::route::<METHOD> <path>`. Plain name refs never resolve to hook/route/shortcode nodes.
- Ref resolution confidence: same file / same class / imported file → high; unique name elsewhere → medium (`obj.x()` → low); 2–3 candidates → low each; more → dropped.
- Initial index (`Indexer.ts`): chunked async loop (25 files, `setImmediate` yields) with window progress; excludes are folder names from `flowlens.excludeFolders` (not `.gitignore`). It also seeds EditTracker baselines.

## 6. Diffing & snapshots

- `SnapshotStore`: in-memory ring buffer (`flowlens.snapshotLimit`, default 50) of `Graph`s. A snapshot is taken after the initial index (baseline) and after each rebuild caused by applied edits (rapid edits coalesce into one). Unchanged node/edge objects are shared between snapshots, so each costs ~Map overhead + what changed. Not persisted across reloads.
- `GraphService.view()`: the inspected step *i* (latest by default) → `base = snapshot[i-1]`, `after = snapshot[i]`, `diff`. `payload.ts` sends the base+after union with a `status` per element; the webview's **Current** hides `added`, **After** hides `removed`, **Diff** colors everything (unchanged dimmed).
- `GraphDiffer`: set difference on node/edge IDs; "modified" = same ID with a different content hash (text of the symbol/file), so lines merely shifting do not count.
- `insights.ts`, computed for the change being viewed (pending, latest or scrubbed step): **new cycles** (iterative Tarjan SCC over import edges and over call edges; reported only if the SCC contains an edge added by this change), **newly orphaned** functions/methods (had incoming calls/registrations, now none; framework entry nodes and closures excluded), and **dangling calls** (a removed symbol whose name is still referenced in current facts; latest/pending only).
- Time scrubber: `scrub {index}` selects snapshot *i* (shows *i−1 → i*); `null` follows the latest. Scrubbing takes precedence over a live pending preview.
- Summary generator: templated natural language (no LLM needed). Optional LLM explanation later.

## 7. Pre-edit preview

1. Receive `proposed` event with tool payload.
2. Compute proposed file text: for `Edit` apply `old_string→new_string` (require exactly one match, else mark `uncertain`); for `Write` use `content`; for `MultiEdit` apply sequentially.
3. Parse proposed text in an in-memory parser instance (not touching disk).
4. `previewGraph()` extracts facts for the proposed text and resolves against a *copy* of the facts map (the builder's real facts are untouched), then `GraphService.view()` diffs current → would-be graph.
5. Shown as a "Pending edit" banner + diff. Cleared when: the matching `applied` arrives (then the real rebuild makes a snapshot), the proposal is discarded (`PostToolUseFailure` / `PermissionDenied` / `Stop`), history is cleared, or a newer proposal replaces it (one preview at a time).

## 8. Webview

- React + **React Flow** (or Cytoscape.js) with **dagre/elkjs** layout. Use clustering by folder and collapse groups above a node threshold.
- State in zustand; the extension host is the source of truth and pushes `graph:update`, `diff:update`, `edits:update`.
- Diff colors: added `#2ea043`, removed `#f85149`, modified `#d29922`, plus icons (+ / − / ~) for color-blind safety. Use VS Code theme CSS variables for everything else.
- Strict CSP with nonce; no remote resources.

- Webview runtime errors are posted back (`error` message) and logged to the "FlowLens" output channel; an integration test asserts none occur.

### Message protocol (typed)
Defined in `src/shared/messages.ts` (single source of truth):
```
host → webview: init{version,workspaceName,maxNodes}, graph:update{GraphPayload}, index:progress{done,total}
webview → host: ready, openFile{file,line?}, scrub{index|null}, error{message}   (+ export messages from M9)
```
`GraphPayload` = before+after union with per-element `status`, summary, counts, step + steps (scrubber), pending, insights. Mode (Current/After/Diff), level, scope, layout and filters are webview-local state. Theme follows VS Code CSS variables automatically, so there is no theme message.

### Views: panel, new window, browser
The same webview bundle runs in three places; the host fans every message out to all of them (`post()` in extension.ts).
- VS Code panel (`PanelProvider`); "new window" = open the panel, then `workbench.action.moveEditorToNewWindow`.
- Browser tab (`BrowserBridge`): HTTP server on `127.0.0.1`, random port, 48-hex-char token required for the page, `/events` (SSE, host → page) and `/msg` (POST, page → host, validated with `isWebviewMessage`, 30 MB cap). Only `main.js`/`main.css` are served without the token (no data in them). Host header must be `127.0.0.1:<port>` (DNS-rebinding guard). A tiny inline shim provides `acquireVsCodeApi()` and re-dispatches SSE messages as window `message` events, so the React app is unchanged; it re-sends `ready` on every (re)connect. Theme: built-in light/dark fallbacks for the `--vscode-*` variables. Started lazily on first use.

### Export
PNG/SVG/Mermaid of exactly what is visible. SVG is generated from our own layout (`webview/src/svgExport.ts`: boxes, clusters, bezier edges, theme colors resolved at export time); PNG rasterizes that SVG on a canvas at 2×. (DOM-screenshot libraries dropped React Flow's edge paths and need CSP exceptions.) The webview posts `export{format,data}`; the host validates the data URL, caps size (25 MB) and writes via a save dialog.

## 9. Security & privacy

- HookServer: `127.0.0.1`, random port, per-session token header, request-size cap (5 MB), JSON schema validation.
- Never execute workspace code. No network calls except optional, opt-in AI explanation with the user's own key.
- Store only in `ExtensionContext.workspaceState` / `globalStorageUri`.

## 10. Performance notes

- Debounce rebuilds; coalesce multiple rapid edits to one file.
- Throttle webview updates to ~10 Hz; send diffs rather than full graphs after the first load.
- Cap rendered nodes (`flowlens.maxNodes`, changed nodes kept first); default scope = changed nodes + 1-hop neighborhood ("All nodes" toggle).
- After each rebuild, the edits behind the newest snapshot get `symbols` (nodes overlapping their changed lines + removed nodes) for the Edit Feed tooltip.

## 11. Testing

- Unit: extractors against fixtures (JS, WP plugin, Python) with golden graph JSON.
- Unit: `GraphDiffer`, `PendingEditPreview` (edit application edge cases).
- Integration: `@vscode/test-electron` launching the extension on fixture workspaces.
- Hook test: simulate Claude Code payloads to `HookServer`.
- Packaged test: `npm run test:vsix` builds the `.vsix`, unpacks it, and runs the full integration suite against the unpacked copy (proves bundle, WASM grammars and hook forwarder are all shipped).
- Windows CI job (GitHub Actions `windows-latest`) in addition to Linux.
- Measured (M9, 2,000 real JS files / 15.8 MB, macOS): index 4.1 s (parse 4.0 s, resolve 0.09 s), 21k nodes / 47k edges; single-file update incl. diff, insights and payload 140–230 ms; ~300 MB heap.

## 12. Tech stack summary

TypeScript · esbuild (extension) · Vite + React + React Flow (@xyflow/react) + zustand (webview) · @vscode/tree-sitter-wasm · dagre · jsdiff · vitest · @vscode/test-electron · vsce (`--no-dependencies`: everything is bundled).
