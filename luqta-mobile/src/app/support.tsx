import React, { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CircleQuestionMark as HelpCircle, MessageCircle, Ticket } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Badge, Button, Card, Chip, EmptyState, Field, Notice, Row, Tabs, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";

type Chat = { id: string; orderId: string | null; subject: string; status: "bot" | "human" | "resolved"; updatedAt: string; lastMessage: { sender: string; body: string } | null };
type TicketItem = { id: string; subject: string; message: string; status: string; replies: { name: string; message: string }[] };
const STATUS: Record<string, [string, "primary" | "accent" | "success"]> = { bot: ["لُقطي يرد", "primary"], human: ["مع موظف", "accent"], resolved: ["مغلقة", "success"] };

export default function SupportScreen() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const { user } = useSession();
  const { orders } = useStore();
  const params = useLocalSearchParams<{ orderId?: string }>();
  const [tab, setTab] = useState<"chats" | "tickets">("chats");
  const chats = useApi<{ chats: Chat[] }>("/support/chats", { needsUser: true });
  const tickets = useApi<{ tickets: TicketItem[] }>("/tickets", { needsUser: true });
  const [orderId, setOrderId] = useState(params.orderId || "");
  const [message, setMessage] = useState("");
  const [ticket, setTicket] = useState({ subject: "", message: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user) return <Shell title="الدعم"><EmptyState title="سجّل الدخول للتحدث معنا" detail="يمكنك أيضًا تصفح مركز المساعدة دون حساب." action="مركز المساعدة" href="/help" /></Shell>;
  async function start() {
    setBusy(true); setError("");
    try { const r = await api.post<{ chat: { id: string } }>("/support/chats", { orderId: orderId || undefined, message: message.trim() || undefined }); setMessage(""); router.push(`/support/${r.chat.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر بدء المحادثة"); } finally { setBusy(false); }
  }
  async function openTicket() {
    setBusy(true); setError("");
    try { await api.post("/tickets", ticket); setTicket({ subject: "", message: "" }); tickets.reload(); } catch (e) { setError(e instanceof Error ? e.message : "تعذر فتح التذكرة"); } finally { setBusy(false); }
  }
  return (
    <Shell title="الدعم" subtitle="لُقطي يرد فورًا، وموظفونا عند الحاجة" robot="كيف أقدر أساعدك؟" testID="support">
      <Card onPress={() => router.push("/help")} accessibilityLabel={tr("مركز المساعدة")} style={{ marginBottom: 12 }}>
        <Row><HelpCircle size={20} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("مركز المساعدة والأسئلة الشائعة")}</Txt></Row>
      </Card>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "chats", label: "المحادثات", count: chats.data?.chats.length }, { id: "tickets", label: "التذاكر", count: tickets.data?.tickets.length }]} />
      {error ? <Notice text={error} tone="danger" /> : null}
      {tab === "chats" ? (
        <View style={{ gap: 10, marginTop: 12 }}>
          <Card style={{ gap: 8 }} testID="new-chat">
            <Txt weight="bold">{tr("محادثة جديدة")}</Txt>
            {orders.length ? <>
              <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("عن أي طلب؟ (اختياري)")}</Txt>
              <Row wrap><Chip label="سؤال عام" active={!orderId} onPress={() => setOrderId("")} />{orders.slice(0, 6).map((o) => <Chip key={o.id} testID={`chat-order-${o.id}`} label={o.id} active={orderId === o.id} onPress={() => setOrderId(o.id)} />)}</Row>
            </> : null}
            <Field label="رسالتك" testID="chat-first-message" value={message} onChangeText={setMessage} placeholder={tr("مثلًا: وين طلبي؟")} />
            <Button title={tr("ابدأ المحادثة")} testID="start-chat" busy={busy} icon={<MessageCircle size={17} color={t.onAccent} />} onPress={() => void start()} />
          </Card>
          {(chats.data?.chats || []).map((c) => (
            <Card key={c.id} onPress={() => router.push(`/support/${c.id}`)} accessibilityLabel={c.subject} testID={`chat-${c.id}`}>
              <Row style={{ justifyContent: "space-between" }}><Txt weight="bold" style={{ flex: 1 }} numberOfLines={1}>{c.subject}</Txt><Badge label={STATUS[c.status][0]} tone={STATUS[c.status][1]} /></Row>
              {c.lastMessage ? <Txt style={{ color: t.muted, fontSize: 12, marginTop: 4 }} numberOfLines={1}>{c.lastMessage.body}</Txt> : null}
            </Card>
          ))}
        </View>
      ) : (
        <View style={{ gap: 10, marginTop: 12 }}>
          <Card style={{ gap: 8 }} testID="new-ticket">
            <Row><Ticket size={18} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("تذكرة جديدة")}</Txt></Row>
            <Field label="الموضوع" testID="ticket-subject" value={ticket.subject} onChangeText={(subject) => setTicket((x) => ({ ...x, subject }))} />
            <Field label="التفاصيل" testID="ticket-message" value={ticket.message} onChangeText={(m) => setTicket((x) => ({ ...x, message: m }))} multiline />
            <Button title={tr("إرسال التذكرة")} testID="submit-ticket" busy={busy} disabled={ticket.subject.trim().length < 3 || ticket.message.trim().length < 5} onPress={() => void openTicket()} />
          </Card>
          {(tickets.data?.tickets || []).map((tk) => (
            <Card key={tk.id} style={{ gap: 4 }}>
              <Row style={{ justifyContent: "space-between" }}><Txt weight="bold">{tk.subject}</Txt><Badge label={tk.status === "resolved" ? "مغلقة" : "مفتوحة"} tone={tk.status === "resolved" ? "success" : "accent"} /></Row>
              <Txt style={{ color: t.muted, fontSize: 13 }}>{tk.message}</Txt>
              {tk.replies.map((r, i) => <Txt key={i} style={{ fontSize: 13 }}>↩︎ {r.name}: {r.message}</Txt>)}
            </Card>
          ))}
        </View>
      )}
    </Shell>
  );
}
