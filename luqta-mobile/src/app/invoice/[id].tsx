import React from "react";
import { Platform, Share } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Printer, Share2 } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { HtmlFrame } from "../../components/HtmlFrame";
import { Button, EmptyState, KeyValue, Notice, Row, Txt, Card } from "../../components/ui";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useMoney } from "../../lib/money";
import { useApi } from "../../lib/useApi";

type Invoice = { number: string; orderId: string; total: number; currency: string; payment: string; issuedAt: string };

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const invoice = useApi<{ invoice: Invoice; html: string }>(id ? `/orders/${encodeURIComponent(id)}/invoice` : null, { needsUser: true });
  if (!invoice.ready) return <Shell title="الفاتورة"><EmptyState title="سجّل الدخول" detail="الفاتورة متاحة لصاحب الطلب على خادم المتجر." action="تسجيل الدخول" href="/login" /></Shell>;
  const data = invoice.data;
  const share = () => data && Share.share({ title: data.invoice.number, message: `${data.invoice.number} — ${tr("الطلب")} ${data.invoice.orderId} — ${money.format(data.invoice.total, data.invoice.currency)}` });
  const print = () => {
    if (Platform.OS !== "web" || !data) return;
    const url = URL.createObjectURL(new Blob([data.html], { type: "text/html" }));
    const win = window.open(url, "_blank", "noopener");
    if (!win) window.location.href = url;
  };
  return (
    <Shell title="الفاتورة" subtitle={id} back testID="invoice">
      {invoice.error ? <Notice text={invoice.error} tone="danger" /> : null}
      {data ? <>
        <Card style={{ marginBottom: 12 }} testID="invoice-summary">
          <KeyValue label="رقم الفاتورة" value={data.invoice.number} />
          <KeyValue label="طريقة الدفع" value={data.invoice.payment} />
          <KeyValue label="الإجمالي" value={money.format(data.invoice.total, data.invoice.currency)} strong />
        </Card>
        <HtmlFrame title={tr("الفاتورة")} html={data.html} height={460} />
        <Row style={{ marginTop: 12 }}>
          <Button title={tr("مشاركة")} secondary icon={<Share2 size={16} color={t.ink} />} onPress={() => void share()} style={{ flex: 1 }} />
          {Platform.OS === "web" ? <Button title={tr("فتح للطباعة")} icon={<Printer size={16} color={t.onAccent} />} onPress={print} style={{ flex: 1 }} /> : null}
        </Row>
      </> : <Txt style={{ color: t.muted }}>{tr("جارٍ التحميل…")}</Txt>}
    </Shell>
  );
}
