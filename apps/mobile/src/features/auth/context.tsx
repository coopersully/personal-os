import { fetch as expoFetch } from "expo/fetch";
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import { toast } from "sonner-native";
import { createSession, resolveApiOrigin, type SessionState } from "./session";
import { sessionStorage } from "./storage";

export const mobileApiOrigin = resolveApiOrigin(
  process.env.EXPO_PUBLIC_API_URL ?? "https://nohmi-api.coopersully.me",
);
export const mobileAppOrigin = resolveApiOrigin(
  process.env.EXPO_PUBLIC_APP_URL ?? "https://nohmi.coopersully.me",
);
const Context = createContext<{
  state: SessionState;
  session: ReturnType<typeof createSession>;
} | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<SessionState>({ status: "checking", user: null });
  const [session] = useState(() =>
    createSession({
      origin: mobileApiOrigin,
      storage: sessionStorage(mobileApiOrigin),
      fetch: expoFetch,
      onChange: setState,
    }),
  );
  useEffect(() => {
    void session
      .restore()
      .catch(() =>
        toast.error("Couldn’t check your session. Check your connection and try again."),
      );
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active")
        void session
          .revalidate()
          .catch(() => toast.error("Couldn’t refresh your session. Check your connection."));
    });
    return () => listener.remove();
  }, [session]);
  return <Context.Provider value={{ state, session }}>{children}</Context.Provider>;
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("AuthProvider is missing.");
  return value;
}

/** Theme can render before authentication without creating a provider dependency. */
export function useOptionalAuth() {
  return useContext(Context);
}
