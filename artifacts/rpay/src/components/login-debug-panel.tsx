import { useEffect, useState } from "react";

export interface LoginDebugState {
  apiSuccess: boolean | null;
  tokenExists: boolean | null;
  role: string;
  merchantType: string;
  targetPath: string;
  redirectCalled: boolean;
}

export const INITIAL_LOGIN_DEBUG_STATE: LoginDebugState = {
  apiSuccess: null,
  tokenExists: null,
  role: "",
  merchantType: "",
  targetPath: "",
  redirectCalled: false,
};

/**
 * Visible debug panel rendered directly on the login page after a login
 * attempt (marker: live-login-debug-hardredirect-v4). Shows exactly what the
 * client believes happened: API result, token presence, resolved role/
 * merchantType, the computed redirect target, whether the redirect was
 * actually invoked, and — after a 1s delay — what the browser's current path
 * actually is. This lets a live incognito session prove or disprove whether
 * the redirect fired at all, with no console access required.
 */
export function LoginDebugPanel({ state }: { state: LoginDebugState }) {
  const [pathAfter1s, setPathAfter1s] = useState<string | null>(null);

  useEffect(() => {
    if (!state.redirectCalled) return;
    const timer = setTimeout(() => {
      setPathAfter1s(window.location.pathname);
    }, 1000);
    return () => clearTimeout(timer);
  }, [state.redirectCalled]);

  if (state.apiSuccess === null) return null;

  return (
    <div
      data-testid="login-debug-panel"
      className="mt-6 rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs font-mono text-amber-200 space-y-1"
    >
      <div className="text-amber-300 font-semibold mb-1">
        Debug (live-login-debug-hardredirect-v4)
      </div>
      <div>API success: {String(state.apiSuccess)}</div>
      <div>token exists: {String(state.tokenExists)}</div>
      <div>user.role: {state.role || "(empty)"}</div>
      <div>user.merchantType: {state.merchantType || "(empty)"}</div>
      <div>target redirect path: {state.targetPath || "(none)"}</div>
      <div>redirect called: {String(state.redirectCalled)}</div>
      <div>
        current path after 1s:{" "}
        {pathAfter1s === null ? "(pending)" : pathAfter1s}
      </div>
    </div>
  );
}
