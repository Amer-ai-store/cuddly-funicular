import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "./api";
import { useSession } from "./session";

// Loads a server resource when the screen gains focus. Without a configured server (sample mode) it stays empty,
// and with `needsUser` it waits for a signed-in account.
export function useApi<T>(path: string | null, { needsUser = false }: { needsUser?: boolean } = {}) {
  const { user, configured, baseUrl } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const userId = user?.id;
  useFocusEffect(useCallback(() => {
    let active = true;
    setError("");
    if (!path || !configured || (needsUser && !userId)) { setData(null); setLoading(false); return; }
    setLoading(true);
    api.get<T>(path).then((value) => { if (active) setData(value); }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "تعذر تحميل البيانات."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // revision deliberately re-runs the request after a mutation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, configured, baseUrl, userId, needsUser, revision]));
  return { data, setData, loading, error, reload: () => setRevision((value) => value + 1), ready: configured && (!needsUser || !!userId) };
}
