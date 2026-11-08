export type AssistantMessage = { role: "user" | "assistant"; content: string };
const base = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");
export const hasAssistantEndpoint = Boolean(base);
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeout: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
export async function checkAssistant(): Promise<boolean> {
  if (!base) return false;
  try {
    const r = await fetchWithTimeout(`${base}/health`, {}, 5000);
    return r.ok && (await r.json()).configured === true;
  } catch {
    return false;
  }
}
export async function askAssistant(
  message: string,
  history: AssistantMessage[],
) {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${base}/api/assistant`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: history.slice(-6) }),
      },
      30000,
    );
  } catch {
    throw new Error("تعذّر الاتصال بالمساعد. تحقق من الاتصال ثم حاول مجددًا.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("لم تصل استجابة واضحة من المساعد. حاول مجددًا.");
  }
  if (!response.ok)
    throw new Error(
      typeof result.error?.message === "string"
        ? result.error.message
        : "تعذّر الاتصال بالمساعد. حاول مجددًا.",
    );
  if (
    typeof result.message !== "string" ||
    !Array.isArray(result.productIds) ||
    !result.productIds.every((id: unknown) => typeof id === "string")
  )
    throw new Error("تعذّر عرض اقتراحات المساعد. حاول مجددًا.");
  return result as { message: string; productIds: string[]; mode: "ai" };
}
