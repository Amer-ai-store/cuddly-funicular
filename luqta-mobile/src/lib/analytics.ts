// Aggregated, anonymous usage counters (no user id, no device id) — opt-out per device.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

export type EventName = "view_product" | "add_to_cart" | "begin_checkout" | "search" | "open_tool" | "share";
const KEY = "luqta-analytics-optout";
let optedOut: boolean | null = null;
void AsyncStorage.getItem(KEY).then((v) => { optedOut = v === "1"; }).catch(() => { optedOut = false; });

export async function setAnalyticsOptOut(value: boolean) { optedOut = value; try { await AsyncStorage.setItem(KEY, value ? "1" : "0"); } catch { /* ignore */ } }
export async function isAnalyticsOptedOut() { if (optedOut !== null) return optedOut; try { optedOut = (await AsyncStorage.getItem(KEY)) === "1"; } catch { optedOut = false; } return optedOut; }
export function track(name: EventName) {
  if (optedOut || !api.baseUrl()) return;
  void api.post("/analytics/event", { name }).catch(() => {});
}
