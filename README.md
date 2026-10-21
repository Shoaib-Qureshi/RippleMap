# FlowLens

See what your AI agent just changed, and what that change does to your app's flow, in real time.

FlowLens watches edits (from Claude Code hooks, or any save / file change), keeps a live **file graph** and **call graph** of your workspace, and shows the **before → after diff** of that graph: added in green, removed in red, modified in amber. When Claude Code proposes an edit, FlowLens previews the graph change **before the file is written**.

![File-level diff](media/screenshots/file-diff.png)

Everything runs locally. No telemetry, no network calls, no code leaves your machine.

## What you get

| | |
|---|---|
| **Edit Feed** (Activity Bar → FlowLens) | Every edit with file, `+/−` lines, changed ranges, touched functions, grouped by agent session. Click to open the diff. |
| **Gutter highlights** | Recently edited lines are highlighted and fade out over time. |
| **Graph panel** (`FlowLens: Open Panel`) | Files or Functions level; **Current / After / Diff** modes; scope "Changed + neighbors" or "All"; left-right, top-down or clustered-by-folder layout; search and folder filter. Click a node to jump to the code. |
| **Pending preview** | Claude Code's proposed `Edit`/`Write` is applied in memory; the diff appears while the agent waits, and is dropped if the edit is rejected or fails. |
| **Framework flows** | WordPress `add_action`/`add_filter`/`do_action`, shortcodes, REST routes (WooCommerce hooks flagged); Express and Next.js route handlers; Flask/FastAPI routes. |
| **Insights** | New circular imports, new call cycles, functions that lost all callers, calls to functions that were removed. |
| **Time scrubber** | Step back through every edit and see the graph diff at that point. |
| **Export** | PNG, SVG or Mermaid of exactly what is visible. |

![Function-level diff](media/screenshots/function-diff.png)
![WordPress hook flow](media/screenshots/wordpress-flow.png)
![Insights](media/screenshots/insights.png)

Languages: JavaScript, TypeScript/TSX, PHP, Python (parsed with tree-sitter, compiled to WebAssembly, so no native build tools are needed).

## Install

```bash
npm install
npm run package          # builds flowlens.vsix
code --install-extension flowlens.vsix
```

Or press **F5** in this folder to run it in an Extension Development Host.

## Connect Claude Code

1. Open your project in VS Code.
2. Run **FlowLens: Install Claude Code Hooks**. This adds `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` and `Stop` hooks to `.claude/settings.local.json` in each workspace folder. Your existing hooks are kept, and the file is backed up first.
3. Start a **new** Claude Code session in that folder. AI edits now show as *Claude Code* in the feed, with a pending preview before each edit lands.

The hook runs a tiny Node script that forwards the event to FlowLens on `127.0.0.1` with a per-session token. It never prints anything, always exits 0, and gives up after 0.7 s, so it can't block or slow the agent. If VS Code isn't open, it just exits. **FlowLens: Remove Claude Code Hooks** removes only the FlowLens entries.

Other agents (Copilot, Cursor, …) still show up through the file-change fallback, labelled *manual*.

## Commands

| Command | |
|---|---|
| FlowLens: Open Panel | Graph panel |
| FlowLens: Install / Remove Claude Code Hooks | See above |
| FlowLens: Re-index Workspace | Rebuild the graph from disk |
| FlowLens: Clear Edit History | Empty the feed (and drop any pending preview) |

## Settings

| Setting | Default | |
|---|---|---|
| `flowlens.excludeFolders` | `node_modules`, `vendor`, `dist`, `build`, `.git`, `wp-includes`, `wp-admin`, … | Folder names ignored for tracking and indexing |
| `flowlens.indexOnStartup` | `true` | Index the workspace graph at startup |
| `flowlens.maxNodes` | `1500` | Nodes rendered at once (changed nodes are kept first) |
| `flowlens.snapshotLimit` | `50` | Graph history kept for diff and scrubber |
| `flowlens.decorationFadeSeconds` | `60` | How long edited-line highlights last |

## Good to know

- **Static analysis.** Calls are resolved by name and import proximity. Dashed edges are medium/low confidence. Dynamic dispatch and string-built hook names aren't followed.
- **Before text.** Files FlowLens hasn't seen yet (not indexed, never opened) produce a first entry with *before unknown*. Indexing fills these baselines in.
- **History is in memory.** Snapshots are not kept across VS Code restarts.
- **Excludes are folder names.** `.gitignore` isn't read.

## Development

```bash
npm run build             # esbuild (extension) + Vite (webview)
npm run watch
npm run typecheck && npm run lint
npm test                  # vitest: extractors (golden graphs), differ, preview, insights, hooks
npm run test:integration  # real VS Code: feed, hooks via the forwarder, index, diff timing, preview
npm run test:vsix         # same suite against the packaged .vsix
```

See `ARCHITECTURE.md` for the design and `CLAUDE.md` for conventions. CI runs on Ubuntu and Windows.
