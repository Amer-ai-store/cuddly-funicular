// Feature flags (kill switches) set by the store owner — G16 governance.
import { useRemote } from "./useRemote";

export const FLAG_DEFAULTS = { reels: true, game: true, merchant: true, ai: true, express: true, pickup: true, studio: true, stampCard: true, lists: true, analytics: true };
export type FlagKey = keyof typeof FLAG_DEFAULTS;
export type Flags = Record<FlagKey, boolean>;
/** Which smart tools depend on which flag. */
export const TOOL_FLAGS: Record<string, FlagKey> = { reels: "reels", game: "game", merchant: "merchant", studio: "studio", lists: "lists", lens: "ai", receipts: "ai", voice: "ai" };

export function useFlags(): Flags {
  const { data } = useRemote<{ flags: Partial<Flags> }>("/flags", { demo: () => ({ flags: FLAG_DEFAULTS }) });
  return { ...FLAG_DEFAULTS, ...(data?.flags || {}) };
}
