import { useStore } from '../store';
import { vscode } from '../vscode';

/** Step through snapshot history: step i shows snapshot i-1 -> i. */
export function Scrubber() {
  const { graph } = useStore();
  const { steps, step, pending } = graph;
  if (steps.length < 2) return null;
  const last = steps.length - 1;
  const current = step?.index ?? last;
  const live = current === last;
  const scrub = (index: number | null) => vscode.postMessage({ type: 'scrub', index });
  return (
    <footer className="fl-scrubber">
      <button aria-label="Previous step" disabled={current <= 1} onClick={() => scrub(current - 1)}>
        ◀
      </button>
      <input
        type="range"
        aria-label="Edit history"
        min={1}
        max={last}
        value={Math.max(1, current)}
        onChange={(e) => scrub(Number(e.target.value))}
      />
      <button aria-label="Next step" disabled={live} onClick={() => scrub(current + 1)}>
        ▶
      </button>
      <span className="fl-muted">
        Step {current}/{last} · {step ? `${step.label} · ${new Date(step.ts).toLocaleTimeString()}` : ''}
      </span>
      <span className="fl-spacer" />
      {!live && <button onClick={() => scrub(null)}>Back to latest{pending ? '' : ''}</button>}
    </footer>
  );
}
