# CLAUDE.md — FlowLens

VS Code extension that visualizes AI-made code edits and the before/after change in an app's workflow graph, in real time. Read `PRD.md`, `ARCHITECTURE.md`, and `ROADMAP.md` before making changes.

## Environment
- Developer machine: **Windows**. All code, scripts, and npm scripts must work on Windows (no bash-only syntax in `package.json` scripts; use cross-platform tools like `cross-env`, `rimraf`, `node` scripts).
- Normalize all paths internally to workspace-relative **forward slashes**. Use `vscode.Uri` / `path` APIs, never string concatenation.
- No native Node modules (no node-gyp). Use `web-tree-sitter` (WASM).

## Commands
- `npm run build` — bundle extension (esbuild) + webview (Vite)
- `npm run watch` — rebuild on change
- `npm run typecheck` — tsc for host + webview (esbuild/Vite don't typecheck)
- `npm run lint` — eslint + prettier check (`npm run format` to fix)
- `npm test` — vitest unit tests
- `npm run test:integration` — @vscode/test-electron (downloads VS Code to `.vscode-test/` on first run)
- `npm run package` — build `.vsix` with vsce (added in M9)
- F5 in VS Code — launch Extension Development Host

## Conventions
- TypeScript strict mode. No `any` without a comment explaining why.
- Extension host is the source of truth; the webview is a view. All host↔webview messages are typed in a shared `messages.ts`.
- Small modules, one responsibility. Extractors implement the `Extractor` interface; agents implement `AgentAdapter`.
- Never block the extension host: debounce, chunk long work with `await` yields.
- Hook forwarder (`hook/hook-forwarder.js`) must **always exit 0**, within ~500 ms, with no output that could affect the agent.
- HookServer binds to `127.0.0.1` only and requires the token header.
- No telemetry. No network calls unless the user opts in to AI explanation.
- Webview: strict CSP with nonce, use VS Code theme CSS variables, no remote assets.

## Workflow rules
1. Work **one milestone at a time** from `ROADMAP.md`. Do not start the next until acceptance criteria pass.
2. Before coding a milestone, write a short plan; after coding, run build + tests and report results.
3. Add or update fixtures + tests for every extractor and the differ.
4. Commit at the end of each milestone with message `feat(M<n>): <summary>`.
5. If a Claude Code hook payload shape or tool name is uncertain, check the current Claude Code documentation instead of guessing, and isolate assumptions inside `ClaudeCodeAdapter`.
6. Keep docs current: if the architecture changes, update `ARCHITECTURE.md` in the same commit.

## Definition of done (per milestone)
- Builds cleanly on Windows, tests pass, acceptance criteria in `ROADMAP.md` demonstrably met, no lint errors, docs updated.
