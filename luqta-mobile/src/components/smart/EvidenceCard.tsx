// #18 Trust & Evidence Passport: hash-chained trail of the order (prices at purchase,
// coupon, payment attempts and every status change). Any later edit of history breaks the chain.
import React, { useState } from "react";
import { View } from "react-native";
import { Fingerprint } from "lucide-react-native";
import { Txt } from "../ui";
import { SmallButton } from "../design/kit";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme";

type Evidence = { head: string; coupon: string | null; payment: { method: string; status: string; attempts: { status: string; at: string }[] }; chain: { step: string; note?: string; at: string; hash: string }[] };
export function EvidenceCard({ orderId }: { orderId: string }) {
  const { colors: t } = useTheme();
  const [ev, setEv] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  return (
    <View style={{ gap: 6, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: t.line, backgroundColor: t.paper }} testID="order-evidence">
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}><Fingerprint size={22} color={t.purple} /><Txt weight="bold" style={{ color: t.title, fontSize: 17 }}>سجل الأدلة</Txt></View>
      {!ev ? <SmallButton title="عرض سجل الطلب الموثّق" tone="outline" onPress={() => { api.get<Evidence>(`/orders/${encodeURIComponent(orderId)}/evidence`).then(setEv).catch((e: unknown) => setError(e instanceof Error ? e.message : "تعذّر التحميل")); }} /> : <>
        {ev.chain.map((c) => <Txt key={c.hash} style={{ color: t.ink, fontSize: 13 }}>• {new Date(c.at).toLocaleString("ar-JO")} — {c.note || c.step} <Txt style={{ color: t.mutedSoft, fontSize: 11 }}>{c.hash.slice(0, 8)}</Txt></Txt>)}
        <Txt style={{ color: t.muted, fontSize: 12 }}>الدفع: {ev.payment.method} / {ev.payment.status}{ev.coupon ? ` · كوبون ${ev.coupon}` : ""}</Txt>
        <Txt style={{ color: t.muted, fontSize: 12 }}>بصمة السجل: {ev.head.slice(0, 16)}… — أي تعديل لاحق في التاريخ يغيّر البصمة.</Txt>
      </>}
      {error ? <Txt style={{ color: t.danger }}>{error}</Txt> : null}
    </View>
  );
}
