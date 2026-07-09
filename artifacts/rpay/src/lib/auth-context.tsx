import { createContext, useContext, ReactNode, useEffect, useState } from "react";
import { useGetMe, User, getGetMeQueryKey } from "@workspace/api-client-react";
import { getToken, removeToken, setToken } from "./auth";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setLocalToken] = useState<string | null>(getToken());
  const [_, setLocation] = useLocation();
  const queryClient = useQueryClient();

  /**
   * True while we have set a new token but haven't yet received the fresh
   * /api/auth/me response. This prevents React Query's stale cache from a
   * previous session (e.g. a merchant user) from being briefly visible as
   * the current user, which caused ProtectedRoute to redirect admins to
   * /merchant/dashboard.
   */
  const [tokenChanging, setTokenChanging] = useState(false);

  const [authTimedOut, setAuthTimedOut] = useState(false);

  const { data: user, isLoading: isUserLoading, error } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      networkMode: "always" as const,
    } as any,
  });

  // Once we receive the fresh user (or an error) after a token change, stop blocking.
  useEffect(() => {
    if (tokenChanging && (user || error)) {
      setTokenChanging(false);
    }
  }, [user, error, tokenChanging]);

  // Spinner is shown while: token is set AND (waiting for /me response OR
  // token just changed and we haven't received fresh data yet).
  // authTimedOut is a safety net — after 10 s of no response, stop spinning.
  const isLoading = !authTimedOut && (isUserLoading || tokenChanging) && !!token;

  // Reset timeout whenever the token changes; start a fresh 10-second window.
  useEffect(() => {
    setAuthTimedOut(false);
    if (!token) return;
    const t = setTimeout(() => setAuthTimedOut(true), 10_000);
    return () => clearTimeout(t);
  }, [token]);

  useEffect(() => {
    if (!error) return;
    // Only treat this as "logged out" when the server explicitly rejects the
    // token (401 = invalid/expired, 403 = forbidden/revoked). Any other
    // failure (5xx from a backend restart, network blip, timeout, etc.) is
    // transient — keep the token and stored user in storage so
    // ProtectedRoute's fallback keeps a valid session alive instead of
    // bouncing the user back to login.
    const status = (error as unknown as { status?: number })?.status;
    if (status === 401 || status === 403) {
      removeToken();
      setLocalToken(null);
    }
  }, [error]);

  const login = (newToken: string) => {
    // 1. Evict ANY cached /api/auth/me data from the previous session so
    //    the stale user object never bleeds into the new session's auth check.
    queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    // 2. Hold the loading gate open until the fresh response arrives.
    setTokenChanging(true);
    // 3. Persist and activate the new token (triggers useGetMe refetch).
    setToken(newToken);
    setLocalToken(newToken);
  };

  const logout = () => {
    // Clear all cached data so nothing from this session leaks after logout.
    queryClient.clear();
    removeToken();
    setLocalToken(null);
    setLocation("/");
  };

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
