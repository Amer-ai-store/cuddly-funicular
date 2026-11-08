// Deep-link target luqta://auth?code=… after Google sign-in: exchanges the one-time code.
import React, { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Shell } from "../components/Shell";
import { CTA, ErrorBlock, LoadingBlock } from "../components/design/kit";
import { RecoveryNotice } from "../components/AuthExtras";
import { api } from "../lib/api";
import { useSession, type SessionUser } from "../lib/session";

export default function AuthCallback() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { adoptSession, hydrated } = useSession();
  const [error, setError] = useState(""); const [recovery, setRecovery] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (!hydrated || started.current) return;
    started.current = true;
    if (!code) return;
    api.post<{ token: string; user: SessionUser; isNew?: boolean; recoveryCode?: string }>("/auth/exchange", { code })
      .then(async (r) => { await adoptSession(r); if (r.isNew && r.recoveryCode) setRecovery(r.recoveryCode); else router.replace("/profile"); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "تعذّر إكمال الدخول"));
  }, [code, hydrated, adoptSession]);
  if (recovery) return <Shell title="مرحبًا بك في لُقطة"><RecoveryNotice code={recovery} onDone={() => router.replace("/profile")} /></Shell>;
  const shownError = error || (!code ? "رابط الدخول غير مكتمل." : "");
  return <Shell title="جارٍ إكمال الدخول">{shownError ? <><ErrorBlock message={shownError} /><CTA title="العودة لتسجيل الدخول" onPress={() => router.replace("/login")} /></> : <LoadingBlock label="نتحقق من حسابك…" />}</Shell>;
}
