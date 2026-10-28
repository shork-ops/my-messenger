import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
    void import("@sentry/react")
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#090a0c", color: "#f4f4f5", fontFamily: "Inter, sans-serif" }}>
        <section style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>Что-то пошло не так</h1>
          <p style={{ color: "#a6a7ae", fontSize: 14, lineHeight: 1.6 }}>
            Интерфейс упал с ошибкой. Перезагрузите страницу — переписка и аккаунт не потеряны.
          </p>
          <pre style={{ marginTop: 16, padding: 12, borderRadius: 10, background: "#131418", color: "#ff9c9c", fontSize: 12, textAlign: "left", overflow: "auto" }}>
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, minHeight: 44, padding: "0 20px", borderRadius: 10, border: "1px solid #dedee2", background: "#ffd400", color: "#101010", fontWeight: 700, cursor: "pointer" }}
          >
            Перезагрузить
          </button>
        </section>
      </main>
    );
  }
}
