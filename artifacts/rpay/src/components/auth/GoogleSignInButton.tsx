/**
 * GoogleSignInButton — loads Google Identity Services (GSI) once and renders
 * the standard "Sign in with Google" button.
 *
 * Usage:
 *   <GoogleSignInButton
 *     clientId="YOUR_GOOGLE_CLIENT_ID"
 *     onCredential={(idToken) => { ... }}
 *     onError={(msg) => { ... }}
 *     disabled={false}
 *   />
 *
 * The component is purely presentation-level; actual token verification
 * happens on the backend (POST /api/auth/merchant/google or /admin/google).
 */

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: object) => void;
          renderButton: (element: HTMLElement, options: object) => void;
          prompt: () => void;
          cancel: () => void;
        };
      };
    };
  }
}

interface GoogleSignInButtonProps {
  clientId: string;
  onCredential: (idToken: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  text?: "signin_with" | "signup_with" | "continue_with";
}

const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";
let gsiLoaded = false;
let gsiLoading = false;
const gsiCallbacks: Array<() => void> = [];

function loadGsiScript(onLoad: () => void): void {
  if (gsiLoaded) { onLoad(); return; }
  gsiCallbacks.push(onLoad);
  if (gsiLoading) return;
  gsiLoading = true;
  const script = document.createElement("script");
  script.src = GSI_SCRIPT_URL;
  script.async = true;
  script.defer = true;
  script.onload = () => {
    gsiLoaded = true;
    gsiLoading = false;
    gsiCallbacks.splice(0).forEach(cb => cb());
  };
  script.onerror = () => {
    gsiLoading = false;
    gsiCallbacks.splice(0);
  };
  document.head.appendChild(script);
}

export function GoogleSignInButton({
  clientId,
  onCredential,
  onError,
  disabled = false,
  text = "continue_with",
}: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadGsiScript(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current || !window.google) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response: { credential?: string; error?: string }) => {
        if (response.credential) {
          onCredential(response.credential);
        } else {
          onError?.(response.error ?? "Google sign-in failed");
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    window.google.accounts.id.renderButton(containerRef.current, {
      theme: "filled_black",
      size: "large",
      shape: "rectangular",
      width: containerRef.current.offsetWidth || 360,
      text,
    });
  }, [ready, clientId, text]);

  if (!ready) {
    return (
      <div className="w-full h-10 rounded-md bg-muted animate-pulse" />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden rounded-md transition-opacity ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      style={{ minHeight: 40 }}
    />
  );
}
