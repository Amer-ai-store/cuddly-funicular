import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "./api";
import { useSession } from "./session";

export function useAccountResource<T>(path: string) {
  const { user, baseUrl } = useSession();
  const userId = user?.id;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setData(null); setError(""); setLoading(true);
    if (!userId || api.baseUrl() !== baseUrl) { setLoading(false); return; }
    api.get<T>(path).then((value) => { if (active) setData(value); }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "تعذر تحميل بيانات الحساب."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // Changing revision deliberately refreshes a focused screen after a mutation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, baseUrl, path, revision]));
  return { data, setData, loading, error, reload: () => setRevision((value) => value + 1) };
}
