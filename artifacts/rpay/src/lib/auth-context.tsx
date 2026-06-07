import { createContext, useContext, ReactNode, useEffect, useState } from "react";
import { useGetMe, User } from "@workspace/api-client-react";
import { getToken, removeToken, setToken } from "./auth";
import { useLocation } from "wouter";

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

  const { data: user, isLoading: isUserLoading, error } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    } as any,
  });

  const isLoading = isUserLoading && !!token;

  useEffect(() => {
    if (error) {
      removeToken();
      setLocalToken(null);
    }
  }, [error]);

  const login = (newToken: string) => {
    setToken(newToken);
    setLocalToken(newToken);
  };

  const logout = () => {
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
