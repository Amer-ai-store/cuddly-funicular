import React, { useRef, useState } from "react";
import { Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Award, CalendarCheck, Copy, Crown, Gift, Share2 } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Badge, Button, Card, EmptyState, Field, Notice, ProgressRing, Row, SectionTitle, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { useRobot } from "../lib/robot";

type Rewards = { points: number; redeemablePoints: number; transactions: { id: string; points: number; note: string; date: string }[] };
type Tier = { tier: { id: string; name: string; benefits: string[] }; lifetimePoints: number; next: { name: string; pointsNeeded: number } | null; progress: number; tiers: { id: string; name: string; minPoints: number }[] };
type Checkin = { checkedInToday: boolean; streak: number; nextReward: number; days: string[] };
type BadgeItem = { id: string; title: string; detail: string; earned: boolean; progress: number; goal: number };
type Referral = { code: string; invited: number; rewarded: number; referrerReward: number; friendReward: number; appliedCode: boolean };

export default function RewardsScreen() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const robot = useRobot();
  const rewards = useApi<Rewards>("/rewards", { needsUser: true });
  const tier = useApi<Tier>("/rewards/tier", { needsUser: true });
  const checkin = useApi<Checkin>("/rewards/check-in", { needsUser: true });
  const badges = useApi<{ badges: BadgeItem[] }>("/me/badges", { needsUser: true });
  const referral = useApi<Referral>("/referrals", { needsUser: true });
  const [friendCode, setFriendCode] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const [busy, setBusy] = useState("");
  const redeemKey = useRef("");
  const [last7] = useState(() => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + 180 * 60_000 - (6 - i) * 86400_000).toISOString().slice(0, 10)));
  if (!user) return <Shell title="مكافآتي"><EmptyState title="سجّل الدخول لجمع النقاط" detail="نقطة لكل دينار، وحضور يومي، ودعوات الأصدقاء." action="تسجيل الدخول" href="/login" /></Shell>;
  const run = async (key: string, fn: () => Promise<string>) => { setBusy(key); setMessage(null); try { setMessage({ text: await fn(), tone: "success" }); } catch (e) { setMessage({ text: e instanceof Error ? e.message : "تعذر تنفيذ العملية", tone: "danger" }); } finally { setBusy(""); } };
  const redeem = () => run("redeem", async () => {
    const points = rewards.data?.redeemablePoints || 0;
    if (!redeemKey.current) redeemKey.current = `redeem-${Date.now().toString(36)}`;
    const r = await api.post<{ walletBalance: number }>("/rewards/redeem", { points, requestKey: redeemKey.current });
    redeemKey.current = ""; rewards.reload(); robot.react("reward");
    return tr("استبدلت {p} نقطة — رصيد محفظتك {m}", { p: points, m: money.format(r.walletBalance) });
  });
  const checkIn = () => run("checkin", async () => { const r = await api.post<{ awarded: number; streak: number; alreadyCheckedIn: boolean }>("/rewards/check-in", {}); checkin.reload(); rewards.reload(); tier.reload(); badges.reload(); robot.react("checkin"); return r.alreadyCheckedIn ? tr("سجلت حضورك اليوم مسبقًا") : tr("+{n} نقاط · سلسلة {d} أيام", { n: r.awarded, d: r.streak }); });
  const applyCode = () => run("apply", async () => { await api.post("/referrals/apply", { code: friendCode.trim() }); setFriendCode(""); referral.reload(); rewards.reload(); tier.reload(); return "أُضيفت 20 نقطة ترحيب 🎉"; });
  const shareCode = async () => { if (!referral.data) return; await Clipboard.setStringAsync(referral.data.code).catch(() => {}); await Share.share({ message: tr("جرّب لُقطة واستخدم رمز دعوتي {c} لتحصل على {n} نقطة ترحيب!", { c: referral.data.code, n: referral.data.friendReward }) }).catch(() => {}); };
  return (
    <Shell title="مكافآتي" subtitle="اجمع النقاط وارفع مستواك" robot="كل يوم نقاط جديدة!" testID="rewards">
      {message ? <Notice text={message.text} tone={message.tone} /> : null}
      <Card tone="primary" style={{ gap: 10, marginTop: 8 }} testID="points">
        <Row style={{ justifyContent: "space-between" }}>
          <View><Txt style={{ color: t.onPrimary, opacity: 0.85 }}>{tr("رصيد النقاط")}</Txt><Txt weight="extra" style={{ color: t.onPrimary, fontSize: 34 }} testID="points-balance">{rewards.data?.points ?? 0}</Txt></View>
          {tier.data ? <ProgressRing value={tier.data.progress / 100} size={86} label={tier.data.tier.name} sublabel={tier.data.next ? tr("إلى {t}", { t: tier.data.next.name }) : tr("أعلى مستوى")} /> : null}
        </Row>
        <Button title={tr("استبدل {p} نقطة بـ {m}", { p: rewards.data?.redeemablePoints ?? 0, m: money.format((rewards.data?.redeemablePoints ?? 0) / 100) })} testID="redeem" secondary busy={busy === "redeem"} disabled={!rewards.data?.redeemablePoints} onPress={() => void redeem()} />
      </Card>
      <Card style={{ marginTop: 12, gap: 10 }} testID="checkin">
        <Row><CalendarCheck size={20} color={t.warning} /><Txt weight="bold" style={{ flex: 1 }}>{tr("الحضور اليومي")}</Txt><Badge label={tr("{n} أيام متتالية", { n: checkin.data?.streak ?? 0 })} tone="warning" /></Row>
        <Row style={{ justifyContent: "space-between" }}>{last7.map((d) => { const on = checkin.data?.days.includes(d); return <View key={d} style={{ alignItems: "center", gap: 4 }}><View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: on ? t.warning : t.secondary, alignItems: "center", justifyContent: "center" }}><Txt style={{ fontSize: 12, color: on ? "#fff" : t.muted, textAlign: "center" }}>{on ? "✓" : ""}</Txt></View><Txt style={{ fontSize: 10, color: t.muted }}>{d.slice(8)}</Txt></View>; })}</Row>
        <Button title={checkin.data?.checkedInToday ? tr("سجّلت اليوم ✅") : tr("سجّل حضورك +{n}", { n: checkin.data?.nextReward ?? 5 })} testID="checkin-button" busy={busy === "checkin"} disabled={checkin.data?.checkedInToday} onPress={() => void checkIn()} />
      </Card>
      {tier.data ? (
        <Card style={{ marginTop: 12, gap: 8 }} testID="tier">
          <Row><Crown size={20} color={t.warning} /><Txt weight="bold" style={{ flex: 1 }}>{tr("مستوى {t}", { t: tier.data.tier.name })}</Txt><Txt style={{ color: t.muted, fontSize: 12 }}>{tr("{n} نقطة مكتسبة", { n: tier.data.lifetimePoints })}</Txt></Row>
          {tier.data.tier.benefits.map((b) => <Txt key={b} style={{ fontSize: 13 }}>✓ {b}</Txt>)}
          {tier.data.next ? <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("باقي {n} نقطة للمستوى {t}", { n: tier.data.next.pointsNeeded, t: tier.data.next.name })}</Txt> : null}
          <Row wrap>{tier.data.tiers.map((x) => <Badge key={x.id} label={`${x.name} ${x.minPoints}+`} tone={x.id === tier.data!.tier.id ? "warning" : "muted"} />)}</Row>
        </Card>
      ) : null}
      <SectionTitle title="شاراتي" />
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 }} testID="badges">
        {(badges.data?.badges || []).map((b) => (
          <Card key={b.id} style={{ width: "48%", gap: 4, opacity: b.earned ? 1 : 0.6 }} testID={`badge-${b.id}`}>
            <Award size={24} color={b.earned ? t.warning : t.muted} />
            <Txt weight="bold" style={{ fontSize: 14 }}>{b.title}</Txt>
            <Txt style={{ color: t.muted, fontSize: 11 }}>{b.detail}</Txt>
            <Txt style={{ fontSize: 11, color: b.earned ? t.success : t.muted }}>{b.earned ? tr("حصلت عليها 🎉") : `${b.progress}/${b.goal}`}</Txt>
          </Card>
        ))}
      </View>
      <SectionTitle title="ادعُ أصدقاءك" />
      <Card style={{ gap: 10 }} testID="referral">
        <Row><Gift size={20} color={t.orange} /><Txt style={{ flex: 1 }}>{tr("صديقك يحصل على {f} نقطة، وأنت {r} نقطة بعد استلام أول طلب له.", { f: referral.data?.friendReward ?? 20, r: referral.data?.referrerReward ?? 50 })}</Txt></Row>
        {referral.data ? <Row style={{ backgroundColor: t.secondary, borderRadius: 16, padding: 12 }}><Txt weight="extra" style={{ flex: 1, fontSize: 22, letterSpacing: 3 }} testID="referral-code">{referral.data.code}</Txt><Button title={tr("نسخ")} secondary icon={<Copy size={14} color={t.ink} />} onPress={() => void Clipboard.setStringAsync(referral.data!.code)} style={{ minHeight: 38, paddingVertical: 4 }} /></Row> : null}
        <Button title={tr("شارك رمزي")} icon={<Share2 size={16} color={t.onAccent} />} onPress={() => void shareCode()} />
        <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("دعوت {i} · استلموا {r}", { i: referral.data?.invited ?? 0, r: referral.data?.rewarded ?? 0 })}</Txt>
        {!referral.data?.appliedCode ? <>
          <Field label="عندك رمز دعوة من صديق؟" testID="friend-code" value={friendCode} onChangeText={setFriendCode} autoCapitalize="characters" placeholder="LQXXXXXX" />
          <Button title={tr("استخدم الرمز")} testID="apply-friend-code" secondary busy={busy === "apply"} disabled={friendCode.trim().length < 8} onPress={() => void applyCode()} />
        </> : null}
      </Card>
      <SectionTitle title="سجل النقاط" />
      <Card>{(rewards.data?.transactions || []).slice(0, 15).map((x) => <Row key={x.id} style={{ justifyContent: "space-between", paddingVertical: 6 }}><Txt style={{ flex: 1, fontSize: 13 }}>{x.note}</Txt><Txt weight="bold" style={{ color: x.points > 0 ? t.success : t.danger }}>{x.points > 0 ? `+${x.points}` : x.points}</Txt></Row>)}{!rewards.data?.transactions.length ? <Txt style={{ color: t.muted }}>{tr("لا توجد حركات بعد")}</Txt> : null}</Card>
    </Shell>
  );
}
