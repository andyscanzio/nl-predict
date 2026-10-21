import { Component, type ComponentChildren } from "preact";

const ISSUES_URL = "https://github.com/andyscanzio/nl-predict/issues";

/** What the page shows when projecting fails: what happened, a way to try again, and where to report it. */
export function ProjectionFailed({ message }: { message: string }) {
  return (
    <div class="warning" role="alert">
      <p>
        <strong>The projection failed.</strong> Something went wrong while playing out the season, so there are no tables to
        show. Reloading usually fixes it; if it keeps happening, please <a href={ISSUES_URL}>report it</a>.
      </p>
      <p class="meta">{message}</p>
      <button type="button" class="warning-button" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}

/** Keeps a failing projection from leaving a blank page: the error is shown with a way out. */
export class ErrorBoundary extends Component<{ children: ComponentChildren }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const { error } = this.state as { error: Error | null };
    return error ? <ProjectionFailed message={error.message} /> : this.props.children;
  }
}
