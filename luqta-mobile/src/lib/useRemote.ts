// Loads a server resource for the G14 screens; when the store server is not linked it
// returns the provided demo computation (screens label it "تجريبي") instead of failing.
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "./api";
import { useSession } from "./session";

export function useRemote<T>(path: string | null, options: { demo?: () => T; auth?: boolean } = {}) {
  const { configured, user, baseUrl } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);
  const [revision, setRevision] = useState(0);
  const demoRef = useRef(options.demo);
  useEffect(() => { demoRef.current = options.demo; });
  const needsUser = options.auth === true;
  useFocusEffect(useCallback(() => {
    let active = true;
    setError(""); setLoading(true);
    if (!path) { setLoading(false); return; }
    if (!configured || (needsUser && !user)) {
      const fallback = demoRef.current;
      setData(fallback ? fallback() : null); setDemo(!!fallback); setLoading(false);
      return;
    }
    api.get<T>(path).then((v) => { if (active) { setData(v); setDemo(false); } })
      .catch((e: unknown) => { if (!active) return; const fallback = demoRef.current; if (fallback) { setData(fallback()); setDemo(true); } setError(e instanceof Error ? e.message : "تعذّر تحميل البيانات"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, configured, user?.id, baseUrl, revision, needsUser]));
  return { data, setData, loading, error, demo, reload: () => setRevision((r) => r + 1) };
}
