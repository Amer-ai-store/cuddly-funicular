import React, { useState } from "react";
import { View } from "react-native";
import { PiggyBank } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Button, Card, EmptyState, Field, KeyValue, Notice, ProgressRing, Row, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { categoryName, useCategories } from "../lib/catalog";

type Budget = { weeklyBudget: number | null; spent: number; remaining: number | null; percent: number | null; orders: number; byCategory: Record<string, number>; warning: string | null };

export default function BudgetScreen() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const categories = useCategories();
  const budget = useApi<{ budget: Budget }>("/me/budget", { needsUser: true });
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  if (!user) return <Shell title="ميزانيتي الأسبوعية"><EmptyState title="سجّل الدخول" detail="نتابع مصاريفك من طلباتك على الخادم." action="تسجيل الدخول" href="/login" /></Shell>;
  const b = budget.data?.budget;
  async function save(value: number | null) {
    setError("");
    try { await api.patch("/me/preferences", { weeklyBudget: value }); setAmount(""); budget.reload(); } catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ الميزانية"); }
  }
  return (
    <Shell title="ميزانيتي الأسبوعية" subtitle="تبدأ الأسبوع يوم السبت" robot={b?.warning || "خلّينا نوفّر سوا 💜"} testID="budget">
      {error ? <Notice text={error} tone="danger" /> : null}
      <Card style={{ alignItems: "center", gap: 10 }} testID="budget-card">
        <ProgressRing value={(b?.percent ?? 0) / 100} size={150} stroke={14} label={b?.weeklyBudget ? `${b.percent}%` : "—"} sublabel={tr("من الميزانية")} />
        <KeyValue label="المصروف هذا الأسبوع" value={money.format(b?.spent ?? 0)} />
        {b?.weeklyBudget ? <KeyValue label="المتبقي" value={money.format(b.remaining ?? 0)} strong testID="budget-remaining" /> : null}
        {b?.warning ? <Notice text={b.warning} tone="warning" /> : null}
      </Card>
      <Card style={{ marginTop: 12, gap: 8 }}>
        <Row><PiggyBank size={20} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{b?.weeklyBudget ? tr("ميزانيتك {m}", { m: money.format(b.weeklyBudget) }) : tr("حدّد ميزانيتك")}</Txt></Row>
        <Field label="الميزانية الأسبوعية" testID="budget-input" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="50" />
        <Row><Button title={tr("حفظ")} testID="save-budget" disabled={!(Number(amount) > 0)} onPress={() => void save(Number(amount))} style={{ flex: 1 }} />{b?.weeklyBudget ? <Button title={tr("إلغاء الميزانية")} secondary onPress={() => void save(null)} style={{ flex: 1 }} /> : null}</Row>
      </Card>
      {b && Object.keys(b.byCategory).length ? (
        <Card style={{ marginTop: 12, gap: 6 }} testID="budget-categories">
          <Txt weight="bold">{tr("حسب القسم")}</Txt>
          {Object.entries(b.byCategory).sort((x, y) => y[1] - x[1]).map(([id, value]) => {
            const c = categories.find((x) => x.id === id);
            return (
              <View key={id} style={{ gap: 4 }}>
                <Row style={{ justifyContent: "space-between" }}><Txt style={{ fontSize: 13 }}>{c ? categoryName(c, lang) : id}</Txt><Txt weight="bold" style={{ fontSize: 13 }}>{money.format(value)}</Txt></Row>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: t.line }}><View style={{ width: `${Math.min(100, (value / Math.max(b.spent, 1)) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: c?.color || t.primary, alignSelf: "flex-end" }} /></View>
              </View>
            );
          })}
        </Card>
      ) : null}
    </Shell>
  );
}
