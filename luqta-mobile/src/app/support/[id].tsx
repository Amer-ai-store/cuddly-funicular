import React, { useEffect, useState } from "react";
import { Image, Pressable, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Camera, Send, UserRound, X } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { Robot } from "../../components/Robot";
import { Badge, Button, EmptyState, Notice, Row, Txt } from "../../components/ui";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useApi } from "../../lib/useApi";
import { api } from "../../lib/api";
import { pickPhoto } from "../../lib/photos";
import { useRobot } from "../../lib/robot";

type Message = { id: string; sender: "user" | "bot" | "agent"; body: string; uploadId: string | null; createdAt: string };
type Chat = { id: string; orderId: string | null; subject: string; status: "bot" | "human" | "resolved"; messages: Message[] };

function Attachment({ id }: { id: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => { let active = true; api.get<{ upload: { dataUrl: string } }>(`/uploads/${id}`).then((r) => { if (active) setUri(r.upload.dataUrl); }).catch(() => {}); return () => { active = false; }; }, [id]);
  return uri ? <Image source={{ uri }} style={{ width: 180, height: 140, borderRadius: 14, marginTop: 6 }} accessibilityLabel="صورة مرفقة" /> : null;
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const { user } = useSession();
  const robot = useRobot();
  const chat = useApi<{ chat: Chat }>(id ? `/support/chats/${encodeURIComponent(id)}` : null, { needsUser: true });
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const timer = setInterval(() => chat.reload(), 15000); return () => clearInterval(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return <Shell title="المحادثة"><EmptyState title="سجّل الدخول" detail="المحادثات مرتبطة بحسابك." action="تسجيل الدخول" href="/login" /></Shell>;
  const data = chat.data?.chat;
  async function send() {
    setBusy(true); setError("");
    try {
      const r = await api.post<{ chat: Chat }>(`/support/chats/${encodeURIComponent(id!)}/messages`, { message: text.trim() || undefined, image: image || undefined });
      chat.setData(r); setText(""); setImage(null);
      const last = r.chat.messages[r.chat.messages.length - 1];
      if (last?.sender === "bot") robot.play("talk", "");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر الإرسال"); } finally { setBusy(false); }
  }
  async function attach() {
    try { const img = await pickPhoto({ width: 640, format: "jpeg" }); if (img) setImage(img); } catch { setError("اسمح بالوصول إلى الصور لإرفاق صورة."); }
  }
  async function escalate() {
    setBusy(true);
    try { chat.setData(await api.post<{ chat: Chat }>(`/support/chats/${encodeURIComponent(id!)}/escalate`, {})); } catch (e) { setError(e instanceof Error ? e.message : "تعذر التحويل"); } finally { setBusy(false); }
  }
  return (
    <Shell title={data?.subject || "المحادثة"} subtitle={data?.orderId ? tr("مرتبطة بالطلب {o}", { o: data.orderId }) : undefined} back testID="chat">
      {data ? <Row style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <Badge label={data.status === "human" ? "مع موظف دعم" : data.status === "resolved" ? "مغلقة" : "لُقطي يرد تلقائيًا"} tone={data.status === "human" ? "accent" : "primary"} />
        {data.status === "bot" ? <Button title={tr("طلب موظف")} testID="escalate" secondary busy={busy} icon={<UserRound size={16} color={t.ink} />} onPress={() => void escalate()} style={{ minHeight: 40, paddingVertical: 6 }} /> : null}
      </Row> : null}
      {error ? <Notice text={error} tone="danger" /> : null}
      <View style={{ gap: 10 }} testID="messages">
        {(data?.messages || []).map((m) => {
          const mine = m.sender === "user";
          return (
            <Row key={m.id} style={{ justifyContent: mine ? "flex-start" : "flex-end", alignItems: "flex-end" }}>
              {!mine ? (m.sender === "bot" ? <Robot size={40} motion="idle" bubble="none" reduceMotion /> : <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.orangeSoft, alignItems: "center", justifyContent: "center" }}><UserRound size={18} color={t.orange} /></View>) : null}
              <View testID={`message-${m.sender}`} style={{ maxWidth: "78%", backgroundColor: mine ? t.primary : t.paper, borderRadius: 20, borderWidth: mine ? 0 : 1, borderColor: t.line, padding: 12 }}>
                {m.sender === "agent" ? <Txt weight="bold" style={{ fontSize: 11, color: t.orange }}>{tr("فريق الدعم")}</Txt> : null}
                <Txt style={{ color: mine ? t.onPrimary : t.ink, lineHeight: 22 }}>{m.body}</Txt>
                {m.uploadId ? <Attachment id={m.uploadId} /> : null}
              </View>
            </Row>
          );
        })}
      </View>
      {image ? <View style={{ marginTop: 10 }}><Image source={{ uri: image }} style={{ width: 120, height: 90, borderRadius: 12 }} /><Pressable accessibilityRole="button" accessibilityLabel={tr("إزالة الصورة")} onPress={() => setImage(null)} style={{ position: "absolute", top: 4, left: 4, backgroundColor: t.paper, borderRadius: 12, padding: 4 }}><X size={14} color={t.ink} /></Pressable></View> : null}
      <Row style={{ marginTop: 12, backgroundColor: t.paper, borderRadius: 22, borderWidth: 1, borderColor: t.line, padding: 6 }}>
        <Pressable testID="chat-attach" accessibilityRole="button" accessibilityLabel={tr("إرفاق صورة")} onPress={() => void attach()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.orangeSoft, alignItems: "center", justifyContent: "center" }}><Camera size={18} color={t.orange} /></Pressable>
        <TextInput testID="chat-input" accessibilityLabel={tr("اكتب رسالتك")} value={text} onChangeText={setText} onSubmitEditing={() => void send()} placeholder={tr("اكتب رسالتك…")} placeholderTextColor={t.muted} style={{ flex: 1, minHeight: 40, color: t.ink, fontFamily: "Tajawal_500Medium", paddingHorizontal: 8 }} />
        <Pressable testID="chat-send" accessibilityRole="button" accessibilityLabel={tr("إرسال")} disabled={busy || (!text.trim() && !image)} onPress={() => void send()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: busy || (!text.trim() && !image) ? 0.5 : 1 }}><Send size={17} color={t.onPrimary} /></Pressable>
      </Row>
    </Shell>
  );
}
