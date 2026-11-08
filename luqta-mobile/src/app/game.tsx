// "العب واربح" — memory matching game; the server awards 10 points once a day on a plausible win.
import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { RotateCcw } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { Card, CTA, InfoNote, SmallButton } from "../components/design/kit";
import { Mascot } from "../components/Robot";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { elapsedSeconds, flip, newGame, settle, type GameState } from "../lib/memoryGame";
import { useTheme } from "../lib/theme";

export default function GameScreen() {
  const { colors: t } = useTheme();
  const { user, configured } = useSession();
  const { notify } = useStore();
  const [game, setGame] = useState<GameState>(() => newGame());
  const [claim, setClaim] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [claimMsg, setClaimMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (game.locked) { timer.current = setTimeout(() => setGame((g) => settle(g)), 750); } return () => { if (timer.current) clearTimeout(timer.current); }; }, [game.locked]);
  const won = !!game.finishedAt;
  async function claimPoints() {
    if (!configured || !user) { router.push("/login"); return; }
    setClaim("busy");
    try { const r = await api.post<{ points: number }>("/rewards/game", { moves: game.moves, seconds: elapsedSeconds(game), pairs: 6 }); setClaim("done"); setClaimMsg(`+${r.points} نقطة أضيفت لرصيدك`); notify(`ربحت ${r.points} نقطة`); }
    catch (e) { setClaim("error"); setClaimMsg(e instanceof Error ? e.message : "تعذّر احتساب الجائزة"); }
  }
  return (
    <Shell title="العب واربح" subtitle="طابق الأزواج الستة بأقل عدد محاولات">
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Txt weight="bold" style={{ color: t.title }}>المحاولات: {game.moves} · الأزواج: {game.matches}/6</Txt>
        <SmallButton title="جديدة" icon={RotateCcw} tone="outline" onPress={() => { setGame(newGame()); setClaim("idle"); setClaimMsg(""); }} testID="game-reset" />
      </View>
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 8, justifyContent: "center" }} testID="game-board">
        {game.cards.map((c, i) => (
          <Pressable key={c.id} testID={`card-${i}`} accessibilityRole="button" accessibilityLabel={c.open || c.matched ? `بطاقة ${c.face}` : `بطاقة مغلقة ${i + 1}`} onPress={() => setGame((g) => flip(g, i))}
            style={{ width: "23%", aspectRatio: 0.8, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: c.matched ? t.successSoft : c.open ? t.card : t.orange, borderWidth: 1, borderColor: c.open || c.matched ? t.line : t.orange }}>
            <Txt style={{ fontSize: 32 }}>{c.open || c.matched ? c.face : "؟"}</Txt>
          </Pressable>
        ))}
      </View>
      {won ? (
        <Card style={{ marginTop: 16, alignItems: "center", gap: 8 }} testID="game-won">
          <Mascot size={96} motion="jump" bubble="none" mode="still" />
          <Txt weight="extra" style={{ fontSize: 22, color: t.title }}>فزت! 🎉</Txt>
          <Txt style={{ color: t.muted }}>{game.moves} محاولة في {elapsedSeconds(game)} ثانية</Txt>
          {claim === "done" || claim === "error" ? <Txt style={{ color: claim === "done" ? t.green : t.danger, textAlign: "center" }}>{claimMsg}</Txt> : <CTA title={user ? "احصل على 10 نقاط" : "سجّل الدخول لاستلام النقاط"} busy={claim === "busy"} onPress={() => void claimPoints()} style={{ alignSelf: "stretch" }} testID="game-claim" />}
        </Card>
      ) : <View style={{ marginTop: 14 }}><InfoNote text="الجائزة مرة واحدة يوميًا، ويمكنك اللعب للمتعة في أي وقت." /></View>}
    </Shell>
  );
}
