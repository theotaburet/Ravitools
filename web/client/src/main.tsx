import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// Don't let a stray rejected promise vanish silently (AUDIT §5).
window.addEventListener("unhandledrejection", (e) => {
  console.error("Ravitools: unhandled promise rejection", e.reason);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
