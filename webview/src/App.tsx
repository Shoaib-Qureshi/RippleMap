import { useStore } from './store';

export function App() {
  const init = useStore((s) => s.init);
  return (
    <main>
      <h1>FlowLens</h1>
      {init ? (
        <p data-testid="status">
          Connected · v{init.version} · {init.workspaceName ?? 'no workspace'}
        </p>
      ) : (
        <p>Connecting…</p>
      )}
    </main>
  );
}
