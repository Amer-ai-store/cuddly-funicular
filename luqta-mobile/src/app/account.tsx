import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { MapPin, Pencil, Star, Trash } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { AddressForm, AddressDraft, addressPayload, addressProblem, draftFrom, emptyAddress } from "../components/AddressForm";
import { Badge, Button, Card, EmptyState, Field, Notice, Row, Toggle, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import type { Address } from "../lib/commerce-types";

const AVATARS = ["😀", "🦊", "🐱", "🐼", "🦁", "🌸", "⭐", "🤖", "🧕", "👨‍🍳"];
type Profile = { name: string; email: string; phone: string; avatar: string; birthday: string };

export default function AccountScreen() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const { user, refreshUser } = useSession();
  const profile = useApi<{ profile: Profile }>("/me/profile", { needsUser: true });
  const addresses = useApi<{ addresses: (Address & { id: string })[] }>("/addresses", { needsUser: true });
  const [edits, setEdits] = useState<Partial<Profile>>({});
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<AddressDraft>(emptyAddress);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return <Shell title="بياناتي وعناويني"><EmptyState title="سجّل الدخول" detail="بياناتك وعناوينك محفوظة في حسابك." action="تسجيل الدخول" href="/login" /></Shell>;
  const current = { ...(profile.data?.profile || { name: user.name, email: user.email, phone: "", avatar: "", birthday: "" }), ...edits };
  async function saveProfile() {
    setBusy(true); setMessage(null);
    try {
      const r = await api.patch<{ profile: Profile }>("/me/profile", { name: current.name.trim(), phone: current.phone.trim(), avatar: current.avatar, birthday: current.birthday.trim() });
      profile.setData(r); setEdits({}); await refreshUser?.().catch(() => {});
      setMessage({ text: "حُفظت بياناتك", tone: "success" });
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "تعذر الحفظ", tone: "danger" }); } finally { setBusy(false); }
  }
  async function saveAddress() {
    const problem = addressProblem(draft); if (problem) { setMessage({ text: problem, tone: "danger" }); return; }
    setBusy(true); setMessage(null);
    try {
      if (editing === "new") await api.post("/addresses", addressPayload(draft)); else await api.patch(`/addresses/${editing}`, addressPayload(draft));
      setEditing(null); setDraft(emptyAddress); addresses.reload(); setMessage({ text: "حُفظ العنوان", tone: "success" });
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "تعذر حفظ العنوان", tone: "danger" }); } finally { setBusy(false); }
  }
  async function remove(id: string) { try { await api.delete(`/addresses/${id}`); addresses.reload(); } catch (e) { setMessage({ text: e instanceof Error ? e.message : "تعذر الحذف", tone: "danger" }); } }
  async function makeDefault(a: Address & { id: string }) { try { await api.patch(`/addresses/${a.id}`, { isDefault: true }); addresses.reload(); } catch { /* the list stays as it was */ } }
  return (
    <Shell title="بياناتي وعناويني" back testID="account">
      {message ? <Notice text={message.text} tone={message.tone} /> : null}
      <Card style={{ gap: 10, marginTop: 8 }} testID="profile-form">
        <Txt weight="bold">{tr("صورتي الرمزية")}</Txt>
        <Row wrap>{AVATARS.map((e) => <Pressable key={e} testID={`avatar-${e}`} accessibilityRole="button" accessibilityLabel={e} aria-selected={current.avatar === `emoji:${e}`} onPress={() => setEdits((x) => ({ ...x, avatar: `emoji:${e}` }))} style={{ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: current.avatar === `emoji:${e}` ? t.primarySoft : t.secondary, borderWidth: 2, borderColor: current.avatar === `emoji:${e}` ? t.primary : "transparent" }}><Txt style={{ fontSize: 22 }}>{e}</Txt></Pressable>)}</Row>
        <Field label="الاسم" testID="profile-name" value={current.name} onChangeText={(name) => setEdits((x) => ({ ...x, name }))} />
        <Field label="رقم الهاتف" testID="profile-phone" value={current.phone} onChangeText={(phone) => setEdits((x) => ({ ...x, phone }))} keyboardType="phone-pad" placeholder="+9627XXXXXXXX" />
        <Field label="تاريخ الميلاد (اختياري)" testID="profile-birthday" value={current.birthday} onChangeText={(birthday) => setEdits((x) => ({ ...x, birthday }))} placeholder="1995-04-12" />
        <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("البريد الإلكتروني: {e}", { e: current.email })}</Txt>
        <Button title={tr("حفظ البيانات")} testID="save-profile" busy={busy} disabled={!Object.keys(edits).length} onPress={() => void saveProfile()} />
      </Card>
      <Row style={{ justifyContent: "space-between", marginTop: 20, marginBottom: 8 }}>
        <Txt weight="extra" style={{ fontSize: 20 }}>{tr("عناويني")}</Txt>
        {editing === null ? <Button title={tr("+ عنوان جديد")} testID="add-address" secondary onPress={() => { setEditing("new"); setDraft(emptyAddress); }} style={{ minHeight: 40, paddingVertical: 6 }} /> : null}
      </Row>
      {editing !== null ? (
        <Card style={{ gap: 10 }} testID="address-editor">
          <AddressForm value={draft} onChange={setDraft} />
          <Toggle label="اجعله العنوان الافتراضي" value={draft.isDefault} onChange={(isDefault) => setDraft((d) => ({ ...d, isDefault }))} />
          <Row><Button title={tr("حفظ العنوان")} testID="save-address" busy={busy} onPress={() => void saveAddress()} style={{ flex: 1 }} /><Button title={tr("إلغاء")} secondary onPress={() => setEditing(null)} style={{ flex: 1 }} /></Row>
        </Card>
      ) : null}
      <View style={{ gap: 8, marginTop: 8 }}>
        {(addresses.data?.addresses || []).map((a) => (
          <Card key={a.id} testID={`address-${a.id}`}>
            <Row style={{ alignItems: "flex-start" }}>
              <MapPin size={20} color={t.orange} />
              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={6}><Txt weight="bold">{a.label || a.city}</Txt>{a.isDefault ? <Badge label="افتراضي" tone="success" /> : null}</Row>
                <Txt style={{ color: t.muted, fontSize: 13 }}>{[a.city, a.district, a.street, a.building, a.details].filter(Boolean).join("، ")}</Txt>
                <Txt style={{ color: t.muted, fontSize: 12 }}>{a.name} · {a.phone}{a.latitude !== undefined ? " · 📍" : ""}</Txt>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={tr("تعديل")} onPress={() => { setEditing(a.id); setDraft(draftFrom(a)); }} style={{ padding: 6 }}><Pencil size={16} color={t.primary} /></Pressable>
              {!a.isDefault ? <Pressable accessibilityRole="button" accessibilityLabel={tr("اجعله افتراضيًا")} onPress={() => void makeDefault(a)} style={{ padding: 6 }}><Star size={16} color={t.warning} /></Pressable> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={tr("حذف")} onPress={() => void remove(a.id)} style={{ padding: 6 }}><Trash size={16} color={t.danger} /></Pressable>
            </Row>
          </Card>
        ))}
        {addresses.data && !addresses.data.addresses.length && editing === null ? <Txt style={{ color: t.muted }}>{tr("لا توجد عناوين محفوظة بعد.")}</Txt> : null}
      </View>
    </Shell>
  );
}
