import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { TOKEN_KEY } from "./lib/auth";
import { ErrorBoundary } from "./components/error-boundary";

// Wire up JWT auth token from localStorage for all API calls
setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

// Force dark mode always
document.documentElement.classList.add("dark");

// Unregister any stale service workers and clear old caches so stale
// chunk hashes from previous deploys never cause a blank screen.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  }).catch(() => {});
}
if ("caches" in window) {
  caches.keys().then((keys) => {
    keys.forEach((k) => caches.delete(k));
  }).catch(() => {});
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
