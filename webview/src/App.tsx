import { DetailsDrawer } from './components/DetailsDrawer';
import { DiffLegend } from './components/DiffLegend';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GraphCanvas } from './components/GraphCanvas';
import { Insights } from './components/Insights';
import { Overview } from './components/Overview';
import { Scrubber } from './components/Scrubber';
import { Toolbar } from './components/Toolbar';
import { useStore } from './store';
import { vscode } from './vscode';

const report = (e: unknown) =>
  vscode.postMessage({
    type: 'error',
    message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
  });
/** View settings back to defaults, so a layout/filter combination that crashed can't crash again. */
const resetView = () =>
  useStore.getState().set({ layout: 'LR', flowRoot: null, search: '', folder: '', hiddenKinds: new Set() });

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
        {/* Only the canvas: the toolbar stays usable if the graph fails to render. */}
        <ErrorBoundary onError={report} onReset={resetView}>
          <GraphCanvas />
        </ErrorBoundary>
        {selectedId ? <DetailsDrawer /> : overviewOpen && <Overview />}
      </div>
      <Scrubber />
    </div>
  );
}
