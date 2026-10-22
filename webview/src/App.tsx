import { DetailsDrawer } from './components/DetailsDrawer';
import { DiffLegend } from './components/DiffLegend';
import { GraphCanvas } from './components/GraphCanvas';
import { Insights } from './components/Insights';
import { Overview } from './components/Overview';
import { Scrubber } from './components/Scrubber';
import { Toolbar } from './components/Toolbar';
import { useStore } from './store';

export function App() {
  const init = useStore((s) => s.init);
  const selectedId = useStore((s) => s.selectedId);
  const overviewOpen = useStore((s) => s.overviewOpen);
  if (!init) return <p className="fl-empty">Connecting…</p>;
  return (
    <div className="fl-app" data-testid="status">
      <Toolbar />
      <DiffLegend />
      <Insights />
      <div className="fl-main">
        <GraphCanvas />
        {selectedId ? <DetailsDrawer /> : overviewOpen && <Overview />}
      </div>
      <Scrubber />
    </div>
  );
}
