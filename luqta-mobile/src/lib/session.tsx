import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api, ApiError, validateServerUrl } from "./api";

export type SessionUser = { id: string; name: string; email: string; role: "customer" | "admin" | "driver"; createdAt?: string };
type StoredSession = { token: string; origin: string };
type Session = {
  user: SessionUser | null;
  hydrated: boolean;
  configured: boolean;
  baseUrl: string;
  connected: boolean;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<string>;
  deleteAccount: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  configure: (url: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Accept a session returned by phone OTP / Google / one-time-code exchange. */
  adoptSession: (result: { token: string; user: SessionUser }) => Promise<void>;
};
const Context = createContext<Session | null>(null);
const STORAGE_KEY = "luqta-commerce-session-v1";

async function readSession(): Promise<StoredSession | null> {
  const raw = Platform.OS === "web"
    ? (typeof window !== "undefined" ? window.sessionStorage.getItem(STORAGE_KEY) : null)
    : await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value.token === "string" && typeof value.origin === "string" ? value : null;
  } catch { return null; }
}
async function saveSession(value: StoredSession | null) {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return;
    if (value) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } else if (value) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value));
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
}

// Names this device in the account's signed-in devices list; browsers are named by the server from their user agent.
function deviceInfo(): { device?: string } {
  if (Platform.OS === "web") return {};
  const model = (Platform.constants as { Model?: string } | undefined)?.Model;
  return { device: `${Platform.OS === "android" ? "Android" : "iPhone"}${model ? ` · ${model}` : ""} · تطبيق لُقطة`.slice(0, 80) };
}
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [configured, setConfigured] = useState(api.configured());
  const [baseUrl, setBaseUrl] = useState(api.baseUrl());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => api.subscribe((event) => {
    if (event === "connected") { setConnected(true); setError(""); }
    if (event === "network") setConnected(false);
    if (event === "configured") { setConfigured(api.configured()); setBaseUrl(api.baseUrl()); setConnected(false); }
    if (event === "unauthorized") {
      setUser(null);
      void saveSession(null).catch(() => {});
    }
  }), []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const origin = await api.initialize();
        if (!active) return;
        setConfigured(Boolean(origin));
        setBaseUrl(origin);
        const saved = await readSession();
        if (!active) return;
        if (saved && saved.origin === origin) {
          api.setToken(saved.token);
          const result = await api.get<{ user: SessionUser }>("/auth/me");
          if (active) setUser(result.user);
        } else {
          await saveSession(null);
          if (origin) await api.testConnection(origin);
          if (active) setConnected(Boolean(origin));
        }
      } catch (failure) {
        if (active) {
          setConnected(false);
          setError(failure instanceof Error ? failure.message : "تعذرت استعادة جلسة الحساب.");
        }
      } finally { if (active) setHydrated(true); }
    })();
    return () => { active = false; };
  }, []);

  const acceptSession = useCallback(async (result: { token: string; user: SessionUser }, origin: string) => {
    if (!result.token || !result.user?.id) throw new ApiError("استجابة تسجيل الدخول غير مكتملة.");
    if (origin !== api.baseUrl()) throw new ApiError("تغيّر عنوان الخادم أثناء الدخول؛ أعد المحاولة على الخادم الحالي.");
    await saveSession({ token: result.token, origin });
    api.setToken(result.token);
    setUser(result.user);
    setConnected(true);
    setError("");
  }, []);
  const login = useCallback(async (email: string, password: string) => {
    const origin = api.baseUrl();
    const result = await api.post<{ token: string; user: SessionUser }>("/auth/login", { email: email.trim().toLowerCase(), password, ...deviceInfo() });
    await acceptSession(result, origin);
  }, [acceptSession]);
  const register = useCallback(async (name: string, email: string, password: string) => {
    const origin = api.baseUrl();
    const result = await api.post<{ token: string; user: SessionUser; recoveryCode: string }>("/auth/register", { name: name.trim(), email: email.trim().toLowerCase(), password, ...deviceInfo() });
    await acceptSession(result, origin);
    if (!result.recoveryCode) throw new ApiError("لم يصدر الخادم رمز استرداد الحساب. راجع إدارة المتجر.");
    return result.recoveryCode;
  }, [acceptSession]);
  const deleteAccount = useCallback(async (password: string) => {
    await api.delete<{ ok: boolean }>("/auth/me", { password, confirm: "حذف حسابي" });
    api.setToken();
    await saveSession(null);
    setUser(null);
    setError("");
  }, []);
  const logout = useCallback(async () => {
    let revocationFailed = false;
    try { await api.post("/auth/logout"); } catch { revocationFailed = true; }
    api.setToken();
    await saveSession(null);
    setUser(null);
    setError(revocationFailed ? "تم تسجيل الخروج من هذا الجهاز؛ تعذر التأكد من إبطال الجلسة على الخادم غير المتصل." : "");
  }, []);
  const configure = useCallback(async (url: string) => {
    const normalized = validateServerUrl(url);
    if (api.baseUrl() === normalized) return;
    if (api.hasToken()) {
      try { await api.post("/auth/logout"); } catch { /* Old server may be unreachable; credentials are still removed locally. */ }
    }
    api.setToken();
    await saveSession(null);
    setUser(null);
    setError("");
    await api.configure(normalized);
  }, []);
  const refreshUser = useCallback(async () => {
    const result = await api.get<{ user: SessionUser }>("/auth/me");
    setUser(result.user);
    setError("");
  }, []);
  const adoptSession = useCallback(async (result: { token: string; user: SessionUser }) => { await acceptSession(result, api.baseUrl()); }, [acceptSession]);
  return <Context.Provider value={{ user, hydrated, configured, baseUrl, connected, error, login, register, deleteAccount, logout, configure, refreshUser, adoptSession }}>{children}</Context.Provider>;
}

export function useSession() {
  const session = useContext(Context);
  if (!session) throw new Error("SessionProvider is required");
  return session;
}
