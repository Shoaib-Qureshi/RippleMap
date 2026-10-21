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
│   │   │   ├── wordpress.ts      # add_action/add_filter/shortcodes/REST
│   │   │   ├── jsRoutes.ts       # Express/Next/React basics
│   │   │   └── pythonRoutes.ts
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
}

interface Snapshot { id: string; ts: number; editIds: string[]; graph: SerializedGraph; }

interface GraphDiff {
  addedNodes: string[]; removedNodes: string[]; modifiedNodes: string[];
  addedEdges: string[]; removedEdges: string[];
  summary: string;         // human-readable impact
}
```

Stable node IDs are essential — diffing relies on them. Use relative path + kind + qualified name; handle renames best-effort.

## 4. Edit capture

### 4.1 Claude Code hooks (primary)
- `FlowLens: Install Claude Code Hooks` merges entries into `.claude/settings.local.json` (project-level), never overwriting existing hooks. Backs up the file first.
- Hooks: `PreToolUse` and `PostToolUse` with matcher for file-editing tools (`Edit|Write|MultiEdit` — verify tool names against current Claude Code docs).
- Hook command: `node "<ext-path>/hook/hook-forwarder.js"`. It reads the JSON payload from stdin, reads port+token from a discovery file (`%TEMP%/flowlens/<workspaceHash>.json` or equivalent), POSTs to the HookServer with a 500 ms timeout, and **always exits 0**.
- `PreToolUse` → `EditEvent{status:'proposed'}`; `PostToolUse` → `status:'applied'`.
- Windows: quote paths, avoid shell-specific syntax, normalize `\` to `/` internally.

### 4.2 Fallback
- `workspace.onDidChangeTextDocument` + `createFileSystemWatcher` with debounce (150 ms). Mark source `manual` unless a recent hook event matches the file.

### 4.3 AgentAdapter interface
```ts
interface AgentAdapter {
  id: string;
  start(emit: (e: EditEvent) => void): Disposable;
}
```
New agents (Copilot, Cursor, etc.) plug in here.

## 5. Parsing & graph building

- `web-tree-sitter` (WASM) + prebuilt grammars (JS, TS/TSX, PHP, Python). **No native modules** (Windows-friendly, no build toolchain).
- `ParserService` keeps a per-file tree cache; on edit, re-parse incrementally using `tree.edit()` when ranges are known, else full-file parse.
- `GraphBuilder` runs extractors per file, producing per-file partial graphs; the workspace graph is the union. On edit, only that file's partial graph is rebuilt, and edges referencing it are re-resolved.
- Cross-file resolution: import resolution (relative paths, tsconfig paths basic, PHP `require/include`, `use`), then symbol-name matching with confidence levels.
- Initial index runs in a worker/chunked async loop with progress notification and respects `.gitignore` + configurable excludes (`node_modules`, `vendor`, `dist`, `wp-includes`, etc.).

## 6. Diffing & snapshots

- `SnapshotStore`: ring buffer (default 50) of serialized graphs; only deltas stored beyond a keyframe to save memory.
- `GraphDiffer`: set difference on node/edge IDs; "modified" = same ID with changed range/signature/meta hash.
- `insights.ts`: detect new cycles (Tarjan SCC on the changed neighborhood), orphaned functions, removed edges whose callers still textually reference the symbol.
- Summary generator: templated natural language (no LLM needed). Optional LLM explanation later.

## 7. Pre-edit preview

1. Receive `proposed` event with tool payload.
2. Compute proposed file text: for `Edit` apply `old_string→new_string` (require exactly one match, else mark `uncertain`); for `Write` use `content`; for `MultiEdit` apply sequentially.
3. Parse proposed text in an in-memory parser instance (not touching disk).
4. Build partial graph, merge into a *clone* of the current graph, diff against current.
5. Show in UI as a "Pending" diff badge; when `applied` arrives, promote to a real snapshot and discard the preview.

## 8. Webview

- React + **React Flow** (or Cytoscape.js) with **dagre/elkjs** layout. Use clustering by folder and collapse groups above a node threshold.
- State in zustand; the extension host is the source of truth and pushes `graph:update`, `diff:update`, `edits:update`.
- Diff colors: added `#2ea043`, removed `#f85149`, modified `#d29922`, plus icons (+ / − / ~) for color-blind safety. Use VS Code theme CSS variables for everything else.
- Strict CSP with nonce; no remote resources.

### Message protocol (typed)
```
host → webview: init, graph:update, diff:update, edits:update, selection:set, theme:change
webview → host: ready, openFile{file,line}, selectEdit{id}, setMode{current|after|diff}, scrub{snapshotId}, requestExport{format}
```

## 9. Security & privacy

- HookServer: `127.0.0.1`, random port, per-session token header, request-size cap (5 MB), JSON schema validation.
- Never execute workspace code. No network calls except optional, opt-in AI explanation with the user's own key.
- Store only in `ExtensionContext.workspaceState` / `globalStorageUri`.

## 10. Performance notes

- Debounce rebuilds; coalesce multiple rapid edits to one file.
- Throttle webview updates to ~10 Hz; send diffs rather than full graphs after the first load.
- Cap rendered nodes; default view = changed nodes + 1-hop neighborhood.

## 11. Testing

- Unit: extractors against fixtures (JS, WP plugin, Python) with golden graph JSON.
- Unit: `GraphDiffer`, `PendingEditPreview` (edit application edge cases).
- Integration: `@vscode/test-electron` launching the extension on fixture workspaces.
- Hook test: simulate Claude Code payloads to `HookServer`.
- Windows CI job (GitHub Actions `windows-latest`) in addition to Linux.

## 12. Tech stack summary

TypeScript · esbuild (extension) · Vite + React + React Flow + zustand (webview) · web-tree-sitter · dagre/elkjs · vitest · @vscode/test-electron · vsce for packaging.
