import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes anywhere in the tree and shows a recovery screen
 * instead of a white page (AUDIT §5). Does not catch async/event-handler errors —
 * a global unhandledrejection listener in main.tsx logs those.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Ravitools crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{ maxWidth: 640, margin: "4rem auto", padding: "2rem", fontFamily: "monospace" }}
      >
        <h1 style={{ fontWeight: 900, marginBottom: "0.5rem" }}>Something broke.</h1>
        <p>
          Ravitools hit an unexpected error and stopped. Your GPX file was never uploaded
          anywhere — it stays in your browser.
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            overflow: "auto",
            background: "#1a1a1a",
            color: "#a3e635",
            padding: "0.75rem",
            marginTop: "1rem",
          }}
        >
          {this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: "1rem", fontWeight: 800, padding: "0.5rem 1rem", cursor: "pointer" }}
        >
          Reload
        </button>
      </div>
    );
  }
}
