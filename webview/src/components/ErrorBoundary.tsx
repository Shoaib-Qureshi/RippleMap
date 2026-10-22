import { Component, type ReactNode } from 'react';

/** Shows render errors instead of a blank panel and reports them to the host log. */
export class ErrorBoundary extends Component<
  /** onReset: put the state that caused the error back to safe defaults before retrying. */
  { onError: (e: unknown) => void; onReset?: () => void; children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch(e: unknown) {
    this.props.onError(e);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fl-empty" role="alert">
        <p>FlowLens hit an error rendering the graph: {this.state.error}</p>
        <button
          onClick={() => {
            this.props.onReset?.();
            this.setState({ error: null });
          }}
        >
          {this.props.onReset ? 'Reset view and retry' : 'Retry'}
        </button>
      </div>
    );
  }
}
