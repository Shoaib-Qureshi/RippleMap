import type { NodeKind } from '../../../src/shared/messages';
import { useStore } from '../store';
import { inBrowser, vscode } from '../vscode';
import { FlowPicker } from './FlowPicker';
import { KIND_ICON } from './FlowNode';

const FUNCTION_KINDS: NodeKind[] = ['function', 'method', 'class', 'component', 'hook', 'route', 'shortcode'];

export function Toolbar() {
  const {
    level,
    mode,
    focus,
    layout,
    search,
    folder,
    hiddenKinds,
    graph,
    progress,
    simple,
    set,
    toggleKind,
  } = useStore();
  return (
    <header className="fl-toolbar" role="toolbar">
      <span className="fl-segmented" role="radiogroup" aria-label="Graph mode">
        {(['current', 'after', 'diff'] as const).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={mode === m}
            className={mode === m ? 'active' : ''}
            title={
              {
                current: 'Graph before the change',
                after: 'Graph after the change',
                diff: 'Before + after, colored',
              }[m]
            }
            onClick={() => set({ mode: m })}
          >
            {{ current: 'Current', after: 'After', diff: 'Diff' }[m]}
          </button>
        ))}
      </span>
      <FlowPicker />
      <select
        aria-label="Graph level"
        value={level}
        onChange={(e) => set({ level: e.target.value as typeof level, flowRoot: null })}
      >
        <option value="files">Files</option>
        <option value="functions">Functions</option>
      </select>
      <select
        aria-label="Scope"
        value={focus}
        onChange={(e) => set({ focus: e.target.value as typeof focus })}
      >
        <option value="changed">Changed + neighbors</option>
        <option value="all">All nodes</option>
      </select>
      <select
        aria-label="Layout"
        value={layout}
        onChange={(e) => set({ layout: e.target.value as typeof layout })}
      >
        <option value="LR">Left → right</option>
        <option value="TB">Top → down</option>
        <option value="cluster">Clustered by folder</option>
      </select>
      <label
        className="fl-check"
        title="Hide lines into files many others use (shown as a 'used by N' badge). Hover or click a block to see all its lines."
      >
        <input type="checkbox" checked={simple} onChange={(e) => set({ simple: e.target.checked })} />
        Simple
      </label>
      <input
        type="search"
        placeholder="Search…"
        aria-label="Search nodes"
        value={search}
        onChange={(e) => set({ search: e.target.value })}
      />
      <input
        placeholder="Folder (e.g. src/lib)"
        aria-label="Folder filter"
        value={folder}
        onChange={(e) => set({ folder: e.target.value })}
      />
      {level === 'functions' && (
        <span className="fl-kinds">
          {FUNCTION_KINDS.map((k) => (
            <label key={k} title={k}>
              <input type="checkbox" checked={!hiddenKinds.has(k)} onChange={() => toggleKind(k)} />
              {KIND_ICON[k]} {k}
            </label>
          ))}
        </span>
      )}
      <span className="fl-spacer" />
      {!inBrowser && (
        <span className="fl-popout">
          <button
            title="Open the graph in a separate VS Code window"
            onClick={() => vscode.postMessage({ type: 'popout', target: 'window' })}
          >
            ⧉ New window
          </button>
          <button
            title="Open the graph in your web browser (live, local only)"
            onClick={() => vscode.postMessage({ type: 'popout', target: 'browser' })}
          >
            ↗ Browser
          </button>
        </span>
      )}
      <span className="fl-muted">
        {progress
          ? `Indexing ${progress.done}/${progress.total}…`
          : `${graph.nodes.length} nodes · ${graph.edges.length} edges`}
      </span>
    </header>
  );
}
