import { DetailsDrawer } from './components/DetailsDrawer';
import { DiffLegend } from './components/DiffLegend';
import { GraphCanvas } from './components/GraphCanvas';
import { Insights } from './components/Insights';
import { Scrubber } from './components/Scrubber';
import { Toolbar } from './components/Toolbar';
import { useStore } from './store';

export function App() {
  const init = useStore((s) => s.init);
  if (!init) return <p className="fl-empty">Connecting…</p>;
  return (
    <div className="fl-app" data-testid="status">
      <Toolbar />
      <DiffLegend />
      <Insights />
      <div className="fl-main">
        <GraphCanvas />
        <DetailsDrawer />
      </div>
      <Scrubber />
    </div>
  );
}
