import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { ListChecks, Users } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Badge, Button, Card, Chip, EmptyState, Field, Notice, Row, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";

type ListSummary = { id: string; name: string; kind: "personal" | "family"; role: string; itemCount: number; checkedCount: number; estimatedTotal: number; members: { name: string }[] };

export default function Lists() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const lists = useApi<{ lists: ListSummary[] }>("/lists", { needsUser: true });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"personal" | "family">("personal");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  if (!user) return <Shell title="قوائمي"><EmptyState title="سجّل الدخول لقوائمك" detail="أنشئ قوائم تسوق وشاركها مع عائلتك برمز." action="تسجيل الدخول" href="/login" /></Shell>;
  async function create() {
    setError("");
    try { const r = await api.post<{ list: { id: string } }>("/lists", { name: name.trim(), kind }); setName(""); router.push(`/list/${r.list.id}`); } catch (e) { setError(e instanceof Error ? e.message : "تعذر إنشاء القائمة"); }
  }
  async function join() {
    setError("");
    try { const r = await api.post<{ list: { id: string } }>("/lists/join", { code: code.trim() }); setCode(""); router.push(`/list/${r.list.id}`); } catch (e) { setError(e instanceof Error ? e.message : "تعذر الانضمام"); }
  }
  return (
    <Shell title="قوائمي" subtitle="قوائم شخصية وعائلية تتحدث للجميع" robot testID="lists">
      {error ? <Notice text={error} tone="danger" /> : null}
      <View style={{ gap: 10 }}>
        {(lists.data?.lists || []).map((l) => (
          <Card key={l.id} onPress={() => router.push(`/list/${l.id}`)} accessibilityLabel={l.name} testID={`list-${l.id}`}>
            <Row>
              <View style={{ width: 44, height: 44, borderRadius: 16, backgroundColor: l.kind === "family" ? t.orangeSoft : t.primarySoft, alignItems: "center", justifyContent: "center" }}>{l.kind === "family" ? <Users size={20} color={t.orange} /> : <ListChecks size={20} color={t.primary} />}</View>
              <View style={{ flex: 1 }}>
                <Txt weight="bold">{l.name}</Txt>
                <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("{n} عناصر · {c} منجزة", { n: l.itemCount, c: l.checkedCount })}{l.kind === "family" ? ` · ${tr("{m} أفراد", { m: l.members.length })}` : ""}</Txt>
              </View>
              {l.kind === "family" ? <Badge label="عائلية" tone="accent" /> : null}
              <Txt weight="bold" style={{ color: t.orange }}>{money.format(l.estimatedTotal)}</Txt>
            </Row>
          </Card>
        ))}
        {lists.data && !lists.data.lists.length ? <Txt style={{ color: t.muted }}>{tr("لا توجد قوائم بعد — أنشئ أول قائمة.")}</Txt> : null}
      </View>
      <Card style={{ marginTop: 16, gap: 10 }} testID="new-list">
        <Txt weight="bold">{tr("قائمة جديدة")}</Txt>
        <Field label="اسم القائمة" testID="list-name" value={name} onChangeText={setName} placeholder={tr("مشتريات الأسبوع")} />
        <Row><Chip label="شخصية" active={kind === "personal"} onPress={() => setKind("personal")} /><Chip label="عائلية مشتركة" testID="kind-family" active={kind === "family"} onPress={() => setKind("family")} /></Row>
        <Button title={tr("إنشاء القائمة")} testID="create-list" disabled={!name.trim()} onPress={() => void create()} />
      </Card>
      <Card style={{ marginTop: 12, gap: 10 }} testID="join-list">
        <Txt weight="bold">{tr("انضم لقائمة العائلة")}</Txt>
        <Field label="رمز المشاركة" testID="join-code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="ABCD2345" />
        <Button title={tr("انضمام")} testID="join-submit" secondary disabled={code.trim().length !== 8} onPress={() => void join()} />
      </Card>
    </Shell>
  );
}
