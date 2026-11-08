import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ClipboardCheck, Megaphone, ScrollText, Store, UserPlus } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { Badge, Button, Card, Chip, EmptyState, Field, Notice, ProgressRing, Row, Tabs, Txt } from "../../components/ui";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useApi } from "../../lib/useApi";
import { api } from "../../lib/api";

type Feature = { id: string; area: string; title: string; titleEn: string; surfaces: string[]; app: string | null; api: string | null; dashboard: string | null; status: "verified" | "implemented" | "failing"; tests: string[]; evidence?: Record<string, { passed: number; failed: number }> };
type Features = { total: number; verified: number; failing: number; testedAt: string | null; areas: { id: string; title: string; titleEn: string }[]; features: Feature[] };
type Vendor = { id: string; name: string; status: string; commission: number; products: number; members: { userId: string; name: string; email: string; role: string }[] };
type Campaign = { id: string; title: string; subtitle: string; color: string; link: string; endsAt: string; active: boolean };
type Entry = { id: string; kind: string; title: string; body: string; version: string; author: string; createdAt: string };
type TestLog = { testedAt: string | null; summary: { total: number; passed: number; failed: number } | null; tests: { name: string; passed: boolean; features: string[]; file: string }[] };
const STATUS: Record<Feature["status"], [string, "success" | "primary" | "danger"]> = { verified: ["مُتحقق بالاختبارات", "success"], implemented: ["منفّذ", "primary"], failing: ["اختبار فاشل", "danger"] };

export default function ProjectScreen() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const { user } = useSession();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<"vendors" | "campaigns" | "features" | "evidence">(params.tab === "vendors" || params.tab === "campaigns" || params.tab === "evidence" ? params.tab : "features");
  const features = useApi<Features>("/admin/features", { needsUser: true });
  const vendors = useApi<{ vendors: Vendor[] }>("/admin/vendors", { needsUser: true });
  const campaigns = useApi<{ campaigns: Campaign[] }>("/admin/campaigns", { needsUser: true });
  const devlog = useApi<{ entries: Entry[] }>("/admin/devlog", { needsUser: true });
  const testLog = useApi<TestLog>("/admin/test-log", { needsUser: true });
  const [area, setArea] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [vendor, setVendor] = useState({ name: "", commission: "10", email: "" });
  const [campaign, setCampaign] = useState({ title: "", subtitle: "", link: "/offers", days: "7" });
  const [entry, setEntry] = useState({ title: "", body: "" });
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const run = async (fn: () => Promise<string>) => { setMessage(null); try { setMessage({ text: await fn(), tone: "success" }); } catch (e) { setMessage({ text: e instanceof Error ? e.message : "تعذر تنفيذ العملية", tone: "danger" }); } };
  const shown = useMemo(() => (features.data?.features || []).filter((f) => !area || f.area === area), [features.data, area]);
  const pending = (features.data?.features || []).filter((f) => f.status !== "verified").slice(0, 3);
  if (user?.role !== "admin") return <Shell title="إدارة المشروع"><EmptyState title="هذه المساحة للمديرين" detail="سجّل الدخول بحساب مدير." action="" /></Shell>;
  const fd = features.data;
  return (
    <Shell title="إدارة المشروع" subtitle="الميزات والبائعون والحملات وأدلة الاختبار" back testID="project">
      {message ? <Notice text={message.text} tone={message.tone} /> : null}
      <Card tone="soft" style={{ gap: 10 }} testID="features-summary">
        <Row>
          <ProgressRing value={fd ? fd.verified / fd.total : 0} size={104} label={fd ? `${fd.verified}` : "…"} sublabel={tr("من {n}", { n: fd?.total ?? 125 })} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt weight="extra" style={{ fontSize: 20 }}>{tr("{n} ميزة مخططة", { n: fd?.total ?? 125 })}</Txt>
            <Txt style={{ color: t.muted, fontSize: 12 }}>{fd?.testedAt ? tr("آخر تشغيل للاختبارات: {d}", { d: new Date(fd.testedAt).toLocaleString(lang === "ar" ? "ar-JO" : "en-GB") }) : tr("شغّل الاختبارات لتحديث الأدلة")}</Txt>
            {fd?.failing ? <Badge label={tr("{n} تحتاج إصلاحًا", { n: fd.failing })} tone="danger" /> : null}
          </View>
        </Row>
        {pending.length ? <View style={{ gap: 6 }}>
          <Txt weight="bold" style={{ fontSize: 13 }}>{tr("الميزات القادمة للتحقق")}</Txt>
          {pending.map((f) => <Row key={f.id}><Txt style={{ flex: 1, fontSize: 13 }}>{lang === "en" ? f.titleEn : f.title}</Txt><Badge label="مخطط" tone="muted" /><Pressable accessibilityRole="button" onPress={() => { setTab("features"); setOpen(f.id); }}><Txt style={{ color: t.primary, fontSize: 12 }}>{tr("التفاصيل")}</Txt></Pressable></Row>)}
        </View> : null}
      </Card>
      <Row style={{ marginVertical: 12 }}>
        <Button title={tr("إضافة بائع")} secondary icon={<UserPlus size={15} color={t.ink} />} onPress={() => setTab("vendors")} style={{ flex: 1, minHeight: 44, paddingVertical: 6 }} />
        <Button title={tr("إنشاء حملة")} secondary icon={<Megaphone size={15} color={t.ink} />} onPress={() => setTab("campaigns")} style={{ flex: 1, minHeight: 44, paddingVertical: 6 }} />
        <Button title={tr("سجل الاختبارات")} secondary icon={<ClipboardCheck size={15} color={t.ink} />} onPress={() => setTab("evidence")} style={{ flex: 1, minHeight: 44, paddingVertical: 6 }} />
      </Row>
      <Tabs testID="project-tabs" value={tab} onChange={setTab} tabs={[{ id: "vendors", label: "البائعون", count: vendors.data?.vendors.length }, { id: "campaigns", label: "الحملات", count: campaigns.data?.campaigns.length }, { id: "features", label: "الميزات" }, { id: "evidence", label: "الأدلة" }]} />
      {tab === "features" ? (
        <View style={{ gap: 8, marginTop: 12 }} testID="feature-list">
          <Row wrap><Chip label="الكل" active={!area} onPress={() => setArea("")} />{(fd?.areas || []).map((a) => <Chip key={a.id} label={lang === "en" ? a.titleEn : a.title} active={area === a.id} onPress={() => setArea(a.id)} />)}</Row>
          {shown.map((f) => (
            <Card key={f.id} onPress={() => setOpen(open === f.id ? null : f.id)} accessibilityLabel={f.title} testID={`feature-${f.id}`} style={{ gap: 6, padding: 12 }}>
              <Row><Txt weight="extra" style={{ color: t.primary, fontSize: 12 }}>{f.id}</Txt><Txt weight="bold" style={{ flex: 1, fontSize: 14 }}>{lang === "en" ? f.titleEn : f.title}</Txt><Badge label={STATUS[f.status][0]} tone={STATUS[f.status][1]} /></Row>
              {open === f.id ? <View style={{ gap: 3 }}>
                <Txt style={{ fontSize: 12, color: t.muted }} testID={`surfaces-${f.id}`}>{tr("الواجهات")}: {f.surfaces.map((s) => `${s} ${f.evidence?.[s]?.failed ? "✕" : f.evidence?.[s]?.passed ? "✓" : "…"}`).join(" · ")}</Txt>
                {f.app ? <Txt style={{ fontSize: 12 }}>📱 {f.app}</Txt> : null}
                {f.api ? <Txt style={{ fontSize: 12 }}>🔌 {f.api}</Txt> : null}
                {f.dashboard ? <Txt style={{ fontSize: 12 }}>🖥️ {f.dashboard}</Txt> : null}
                {f.tests.map((name) => <Txt key={name} style={{ fontSize: 11, color: t.success }}>✓ {name}</Txt>)}
              </View> : null}
            </Card>
          ))}
        </View>
      ) : null}
      {tab === "vendors" ? (
        <View style={{ gap: 8, marginTop: 12 }} testID="vendors">
          <Card style={{ gap: 8 }}>
            <Row><Store size={18} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("بائع جديد")}</Txt></Row>
            <Field label="اسم البائع" testID="vendor-name" value={vendor.name} onChangeText={(name) => setVendor((v) => ({ ...v, name }))} />
            <Field label="العمولة %" value={vendor.commission} onChangeText={(commission) => setVendor((v) => ({ ...v, commission }))} keyboardType="decimal-pad" />
            <Field label="بريد صاحب المتجر (حساب موجود)" testID="vendor-email" value={vendor.email} onChangeText={(email) => setVendor((v) => ({ ...v, email }))} autoCapitalize="none" keyboardType="email-address" />
            <Button title={tr("إضافة البائع")} testID="create-vendor" disabled={vendor.name.trim().length < 2} onPress={() => void run(async () => {
              const created = await api.post<{ vendor: Vendor }>("/admin/vendors", { name: vendor.name.trim(), commission: Number(vendor.commission) || 0 });
              if (vendor.email.trim()) await api.post(`/admin/vendors/${created.vendor.id}/members`, { email: vendor.email.trim(), role: "owner" });
              setVendor({ name: "", commission: "10", email: "" }); vendors.reload(); return tr("أُضيف {n}", { n: created.vendor.name });
            })} />
          </Card>
          {(vendors.data?.vendors || []).map((v) => (
            <Card key={v.id} style={{ gap: 4 }}>
              <Row><Txt weight="bold" style={{ flex: 1 }}>{v.name}</Txt><Badge label={v.status === "active" ? "نشط" : "موقوف"} tone={v.status === "active" ? "success" : "danger"} /></Row>
              <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("{p} منتج · عمولة {c}% · {m}", { p: v.products, c: v.commission, m: v.members.map((m) => m.name).join("، ") || tr("بلا أعضاء") })}</Txt>
              <Button title={tr(v.status === "active" ? "إيقاف" : "تفعيل")} secondary onPress={() => void run(async () => { await api.patch(`/admin/vendors/${v.id}`, { status: v.status === "active" ? "suspended" : "active" }); vendors.reload(); return "حُدّث البائع"; })} style={{ minHeight: 38, paddingVertical: 4 }} />
            </Card>
          ))}
        </View>
      ) : null}
      {tab === "campaigns" ? (
        <View style={{ gap: 8, marginTop: 12 }} testID="campaigns-admin">
          <Card style={{ gap: 8 }}>
            <Field label="عنوان الحملة" testID="campaign-title" value={campaign.title} onChangeText={(title) => setCampaign((c) => ({ ...c, title }))} />
            <Field label="وصف قصير" value={campaign.subtitle} onChangeText={(subtitle) => setCampaign((c) => ({ ...c, subtitle }))} />
            <Field label="الرابط داخل التطبيق" value={campaign.link} onChangeText={(link) => setCampaign((c) => ({ ...c, link }))} />
            <Field label="المدة بالأيام" value={campaign.days} onChangeText={(days) => setCampaign((c) => ({ ...c, days }))} keyboardType="number-pad" />
            <Button title={tr("إنشاء الحملة")} testID="create-campaign" disabled={campaign.title.trim().length < 2} onPress={() => void run(async () => {
              await api.post("/admin/campaigns", { title: campaign.title.trim(), subtitle: campaign.subtitle.trim(), link: campaign.link.trim() || "/offers", endsAt: new Date(Date.now() + (Number(campaign.days) || 7) * 86400_000).toISOString(), color: "#FF6B4A" });
              setCampaign({ title: "", subtitle: "", link: "/offers", days: "7" }); campaigns.reload(); return "أُنشئت الحملة وتظهر في الرئيسية";
            })} />
          </Card>
          {(campaigns.data?.campaigns || []).map((c) => <Card key={c.id}><Row><View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.color }} /><Txt weight="bold" style={{ flex: 1 }}>{c.title}</Txt><Txt style={{ color: t.muted, fontSize: 11 }}>{tr("حتى {d}", { d: c.endsAt.slice(0, 10) })}</Txt></Row></Card>)}
        </View>
      ) : null}
      {tab === "evidence" ? (
        <View style={{ gap: 8, marginTop: 12 }} testID="evidence">
          <Card style={{ gap: 6 }} testID="test-log">
            <Row><ClipboardCheck size={18} color={t.success} /><Txt weight="bold" style={{ flex: 1 }}>{tr("سجل الاختبارات")}</Txt>{testLog.data?.summary ? <Badge label={`${testLog.data.summary.passed}/${testLog.data.summary.total}`} tone={testLog.data.summary.failed ? "danger" : "success"} /> : null}</Row>
            {(testLog.data?.tests || []).slice(0, 40).map((x) => <Txt key={`${x.file}-${x.name}`} style={{ fontSize: 11, color: x.passed ? t.ink : t.danger }}>{x.passed ? "✓" : "✕"} {x.name}</Txt>)}
            {!testLog.data?.tests.length ? <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("لا توجد نتائج بعد — شغّل npm test على الخادم.")}</Txt> : null}
          </Card>
          <Card style={{ gap: 8 }} testID="devlog">
            <Row><ScrollText size={18} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("سجل التطوير")}</Txt></Row>
            <Field label="عنوان" testID="devlog-title" value={entry.title} onChangeText={(title) => setEntry((e) => ({ ...e, title }))} />
            <Field label="تفاصيل" value={entry.body} onChangeText={(body) => setEntry((e) => ({ ...e, body }))} multiline />
            <Button title={tr("أضف للسجل")} testID="devlog-add" disabled={entry.title.trim().length < 3} onPress={() => void run(async () => { await api.post("/admin/devlog", { kind: "feature", title: entry.title.trim(), body: entry.body.trim() || undefined }); setEntry({ title: "", body: "" }); devlog.reload(); return "أُضيف إلى سجل التطوير"; })} />
            {(devlog.data?.entries || []).map((e) => <View key={e.id} style={{ borderRightWidth: 3, borderColor: t.primarySoft, paddingRight: 10, gap: 2 }}><Txt weight="bold" style={{ fontSize: 13 }}>{e.title} {e.version ? `· ${e.version}` : ""}</Txt>{e.body ? <Txt style={{ color: t.muted, fontSize: 12 }}>{e.body}</Txt> : null}<Txt style={{ color: t.muted, fontSize: 10 }}>{e.author} · {e.createdAt.slice(0, 10)}</Txt></View>)}
          </Card>
        </View>
      ) : null}
    </Shell>
  );
}
