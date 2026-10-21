import { Component, type ReactNode } from 'react';

/** Shows render errors instead of a blank panel and reports them to the host log. */
export class ErrorBoundary extends Component<
  { onError: (e: unknown) => void; children: ReactNode },
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
        <button onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
  }
}
