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

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
