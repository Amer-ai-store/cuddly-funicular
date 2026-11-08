import AsyncStorage from "@react-native-async-storage/async-storage";

const ENDPOINT_KEY = "luqta-commerce-endpoint-v1";
const REQUEST_TIMEOUT = 15_000;
type ApiEvent = "configured" | "connected" | "network" | "unauthorized";
type Listener = (event: ApiEvent) => void;
const listeners = new Set<Listener>();
let token: string | undefined;
let endpoint = "";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function validateServerUrl(value: string): string {
  const input = value.trim().replace(/\/+$/, "");
  if (!input) return "";
  if (input.length > 2048) throw new ApiError("عنوان الخادم أطول من الحد المسموح.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError("أدخل عنوان الخادم كاملًا، مثل https://store.example.com");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const octets = host.split(".").map(Number);
  const isIpv4 = octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  const privateIpv4 = isIpv4 && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  const local = host === "localhost" || host === "::1" || privateIpv4;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new ApiError("الخادم العام يجب أن يستخدم HTTPS. يُسمح بـHTTP فقط على عنوان محلي أو شبكة خاصة.");
  }
  if (url.username || url.password || url.search || url.hash || !["", "/", "/api"].includes(url.pathname)) {
    throw new ApiError("استخدم أصل الخادم فقط، دون بيانات دخول أو مسار أو معاملات، مثل https://store.example.com");
  }
  return url.origin;
}

try {
  endpoint = validateServerUrl(process.env.EXPO_PUBLIC_API_URL || "");
} catch {
  // Invalid build-time configuration must not send a session token anywhere.
}

function emit(event: ApiEvent) {
  listeners.forEach((listener) => listener(event));
}

async function requestAt<T>(origin: string, path: string, method: string, body?: unknown, bearer?: string): Promise<T> {
  if (!origin) throw new ApiError("لم يتم ربط خادم المتجر. افتح إعداد الاتصال أولًا.", 0, "NOT_CONFIGURED");
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path)) throw new ApiError("مسار الطلب غير صالح.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      signal: controller.signal,
    });
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new ApiError("الخادم لم يُرجع استجابة JSON صالحة. تحقق من عنوان الربط.", response.status);
    }
    if (!response.ok) {
      const error = result as { error?: string; message?: string; code?: string };
      throw new ApiError(error.error || error.message || `تعذر تنفيذ العملية (${response.status}).`, response.status, error.code);
    }
    return result as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(controller.signal.aborted ? "انتهت مهلة الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة." : "تعذر الوصول إلى خادم المتجر. تحقق من الاتصال وعنوان الخادم.", 0, "NETWORK");
  } finally {
    clearTimeout(timeout);
  }
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const origin = endpoint;
  try {
    const result = await requestAt<T>(origin, path, method, body, token);
    if (origin === endpoint) emit("connected");
    return result;
  } catch (error) {
    if (origin === endpoint && error instanceof ApiError) {
      if (error.status === 401) {
        token = undefined;
        emit("unauthorized");
      } else if (error.status === 0) emit("network");
    }
    throw error;
  }
}

export type CommerceHealth = { ok: boolean; service: string; currency?: string; facebookConfigured?: boolean };
export const api = {
  baseUrl: () => endpoint,
  configured: () => Boolean(endpoint),
  setToken: (value?: string) => { token = value; },
  hasToken: () => Boolean(token),
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  initialize: async () => {
    const saved = await AsyncStorage.getItem(ENDPOINT_KEY);
    if (saved !== null) {
      try { endpoint = validateServerUrl(saved); } catch { endpoint = ""; }
    }
    return endpoint;
  },
  configure: async (value: string) => {
    const origin = validateServerUrl(value);
    await AsyncStorage.setItem(ENDPOINT_KEY, origin);
    if (origin !== endpoint) token = undefined;
    endpoint = origin;
    emit("configured");
  },
  testConnection: async (value: string): Promise<CommerceHealth> => {
    const origin = validateServerUrl(value);
    const result = await requestAt<CommerceHealth>(origin, "/health", "GET");
    if (!result.ok || result.service !== "luqta-commerce") throw new ApiError("هذا العنوان لا يشغّل خادم لُقطة التجاري المتوافق.");
    return result;
  },
  // Raw text downloads (CSV exports and sync logs) with the same session token.
  text: async (path: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(`${endpoint}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "omit", signal: controller.signal });
      const body = await response.text();
      if (!response.ok) { let message = body; try { message = (JSON.parse(body) as { error?: string }).error || body; } catch { /* plain text error */ } throw new ApiError(message, response.status); }
      return body;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("تعذر تنزيل الملف من خادم المتجر.", 0, "NETWORK");
    } finally { clearTimeout(timer); }
  },
  get: <T,>(path: string) => request<T>(path, "GET"),
  post: <T,>(path: string, body?: unknown) => request<T>(path, "POST", body),
  put: <T,>(path: string, body?: unknown) => request<T>(path, "PUT", body),
  patch: <T,>(path: string, body?: unknown) => request<T>(path, "PATCH", body),
  delete: <T,>(path: string, body?: unknown) => request<T>(path, "DELETE", body),
};
