import { useStore } from '../store';

const ICON = { cycle: '⟳', orphan: '⊘', dangling: '⚠' } as const;

/** Risk warnings for the change being viewed. Clicking one selects its first node. */
export function Insights() {
  const { graph, set } = useStore();
  if (!graph.insights.length) return null;
  return (
    <ul className="fl-insights" aria-label="Warnings">
      {graph.insights.map((w, i) => (
        <li key={i}>
          <button className="fl-link" onClick={() => set({ selectedId: w.nodeIds[0] ?? null, focus: 'all' })}>
            <span aria-hidden>{ICON[w.kind]}</span> {w.message}
          </button>
        </li>
      ))}
    </ul>
  );
}
