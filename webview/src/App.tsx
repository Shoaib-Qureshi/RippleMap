import { DetailsDrawer } from './components/DetailsDrawer';
import { GraphCanvas } from './components/GraphCanvas';
import { Toolbar } from './components/Toolbar';
import { useStore } from './store';

export function App() {
  const init = useStore((s) => s.init);
  if (!init) return <p className="fl-empty">Connecting…</p>;
  return (
    <div className="fl-app" data-testid="status">
      <Toolbar />
      <div className="fl-main">
        <GraphCanvas />
        <DetailsDrawer />
      </div>
    </div>
  );
}
