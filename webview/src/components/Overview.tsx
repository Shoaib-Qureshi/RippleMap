import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { overview, type OverviewItem } from '../view';

const SHOWN = 8;

/** "Start here": what a senior would point a newcomer at first. Shown when no node is selected. */
export function Overview() {
  const { graph, set, showFlow } = useStore();
  const o = useMemo(() => overview(graph), [graph]);
  return (
    <aside className="fl-drawer fl-overview" aria-label="Project overview">
      <button className="fl-close" aria-label="Close overview" onClick={() => set({ overviewOpen: false })}>
        ×
      </button>
      <h2>Start here</h2>
      <p className="fl-muted">{o.stats}</p>
      <Section
        title="Entry points"
        note="Where requests and events enter the app. Click one to follow its flow."
        items={o.entries}
        onPick={(id) => showFlow(id)}
      />
      <Section
        title="Core files"
        note="Many files depend on these. Change them with care."
        items={o.core}
        onPick={(id) => set({ selectedId: id })}
      />
      <Section
        title="Not imported by other code"
        note="May be loaded another way (framework, script tag, cron), or no longer used."
        items={o.unused}
        onPick={(id) => set({ selectedId: id })}
      />
    </aside>
  );
}

function Section(props: {
  title: string;
  note: string;
  items: OverviewItem[];
  onPick: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (!props.items.length) return null;
  const items = all ? props.items : props.items.slice(0, SHOWN);
  return (
    <section>
      <h3>
        {props.title} ({props.items.length})
      </h3>
      <p className="fl-muted fl-note-text">{props.note}</p>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <button className="fl-link" title={i.hint} onClick={() => props.onPick(i.id)}>
              {i.label}
            </button>{' '}
            <span className="fl-muted">{i.hint}</span>
          </li>
        ))}
      </ul>
      {props.items.length > SHOWN && (
        <button className="fl-link" onClick={() => setAll(!all)}>
          {all ? 'Show less' : `+${props.items.length - SHOWN} more`}
        </button>
      )}
    </section>
  );
}
