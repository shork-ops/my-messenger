import React from "react";
import ReactDOM from "react-dom/client";
// Load the messenger only after authentication has admitted the account.
const App = React.lazy(() => import("./App"));
import AuthGate from "./lib/AuthGate";
import ErrorBoundary from "./components/ErrorBoundary";
import { initMonitoring } from "./lib/monitoring";
import "./styles.css";
import "./disappearing.css";

initMonitoring();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthGate>
        <React.Suspense fallback={<div role="status">Загружаем чаты…</div>}>
          <App />
        </React.Suspense>
      </AuthGate>
    </ErrorBoundary>
  </React.StrictMode>
);
