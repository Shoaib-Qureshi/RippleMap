import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { KIND_ICON } from './FlowNode';

/** Searchable list of functions/methods/hooks/routes; picking one shows its flow. */
export function FlowPicker() {
  const { graph, flowRoot, flowDepth, set, showFlow } = useStore();
  const [text, setText] = useState('');
  // Option text must be unique: the id's qualified name (`outer.inner`, `#2` for repeats) plus the file.
  const byText = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes)
      if (n.kind !== 'file' && n.status !== 'removed')
        m.set(`${KIND_ICON[n.kind]} ${n.id.split('::').pop()} — ${n.file}`, n.id);
    return new Map([...m].sort(([a], [b]) => a.localeCompare(b)));
  }, [graph.nodes]);
  const root = flowRoot ? graph.nodes.find((n) => n.id === flowRoot) : undefined;

  const exit = () => {
    showFlow(null);
    setText('');
  };

  return (
    <span className="fl-flow">
      <input
        list="fl-symbols"
        placeholder={`ƒ Show flow of… (${byText.size})`}
        aria-label="Show the flow of a function, method, hook or route"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const id = byText.get(e.target.value);
          if (id) showFlow(id);
        }}
      />
      <datalist id="fl-symbols">
        {[...byText.keys()].map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {root && (
        <>
          <select
            aria-label="Flow depth"
            title="How many calls deep to follow"
            value={flowDepth}
            onChange={(e) => set({ flowDepth: Number(e.target.value) })}
          >
            {[1, 2, 3, 5, 0].map((d) => (
              <option key={d} value={d}>
                {d === 0 ? 'All depths' : `Depth ${d}`}
              </option>
            ))}
          </select>
          <button onClick={exit} title="Back to the full graph">
            ✕ Exit flow
          </button>
        </>
      )}
    </span>
  );
}
