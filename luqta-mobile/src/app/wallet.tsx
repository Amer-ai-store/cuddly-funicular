import React, { useState } from "react";
import { router } from "expo-router";
import { Gift, Wallet } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Button, Card, EmptyState, Field, Notice, Row, SectionTitle, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { useRobot } from "../lib/robot";

type WalletData = { balance: number; currency: string; transactions: { id: string; amount: number; type: string; note: string; orderId: string | null; date: string }[] };
const TYPE: Record<string, string> = { purchase: "شراء", refund: "استرداد طلب ملغى", return_refund: "استرداد مرتجع", reward_redemption: "استبدال نقاط", adjustment: "تعديل من المتجر", gift_card: "بطاقة هدية" };

export default function WalletScreen() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const robot = useRobot();
  const wallet = useApi<WalletData>("/wallet", { needsUser: true });
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return <Shell title="المحفظة"><EmptyState title="سجّل الدخول" detail="المحفظة مرتبطة بحسابك." action="تسجيل الدخول" href="/login" /></Shell>;
  async function redeem() {
    setBusy(true); setMessage(null);
    try { const r = await api.post<{ amount: number; walletBalance: number }>("/gift-cards/redeem", { code: code.trim() }); setCode(""); wallet.reload(); robot.react("reward", tr("شحنت محفظتك 🎁")); setMessage({ text: tr("أُضيف {m} إلى محفظتك", { m: money.format(r.amount) }), tone: "success" }); }
    catch (e) { setMessage({ text: e instanceof Error ? e.message : "تعذر شحن البطاقة", tone: "danger" }); } finally { setBusy(false); }
  }
  return (
    <Shell title="المحفظة" subtitle="رصيدك واستردادك وبطاقات الهدايا" testID="wallet">
      <Card tone="primary" style={{ gap: 6 }}>
        <Row><Wallet size={22} color={t.onPrimary} /><Txt style={{ color: t.onPrimary, flex: 1 }}>{tr("الرصيد المتاح")}</Txt></Row>
        <Txt weight="extra" style={{ color: t.onPrimary, fontSize: 34 }} testID="wallet-balance">{money.format(wallet.data?.balance ?? 0)}</Txt>
        <Button title={tr("استبدل نقاطك برصيد")} secondary onPress={() => router.push("/rewards")} style={{ minHeight: 42, paddingVertical: 8 }} />
      </Card>
      {message ? <Notice text={message.text} tone={message.tone} /> : null}
      <Card style={{ marginTop: 12, gap: 8 }} testID="gift-card">
        <Row><Gift size={20} color={t.orange} /><Txt weight="bold" style={{ flex: 1 }}>{tr("شحن بطاقة هدية")}</Txt></Row>
        <Field label="رمز البطاقة" testID="gift-code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="LQ-XXXX-XXXX-XXXX" />
        <Button title={tr("اشحن المحفظة")} testID="redeem-gift" busy={busy} disabled={code.replace(/[^A-Za-z0-9]/g, "").length < 14} onPress={() => void redeem()} />
      </Card>
      <SectionTitle title="الحركات" />
      <Card testID="wallet-transactions">
        {(wallet.data?.transactions || []).map((x) => (
          <Row key={x.id} style={{ justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderColor: t.line }}>
            <Txt style={{ flex: 1, fontSize: 13 }}>{tr(TYPE[x.type] || x.type)}{x.orderId ? ` · ${x.orderId}` : ""}{"\n"}<Txt style={{ color: t.muted, fontSize: 11 }}>{new Date(x.date).toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB")}</Txt></Txt>
            <Txt weight="bold" style={{ color: x.amount >= 0 ? t.success : t.danger }}>{x.amount >= 0 ? "+" : ""}{money.format(x.amount)}</Txt>
          </Row>
        ))}
        {wallet.data && !wallet.data.transactions.length ? <Txt style={{ color: t.muted }}>{tr("لا توجد حركات بعد")}</Txt> : null}
      </Card>
    </Shell>
  );
}
