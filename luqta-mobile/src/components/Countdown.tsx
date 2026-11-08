import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Timer } from "lucide-react-native";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { Txt } from "./ui";

// Counts down to a server timestamp, correcting for the device clock with the server time from the same response.
export function Countdown({ endsAt, serverTime, onEnd }: { endsAt: string; serverTime?: string; onEnd?: () => void }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const [skew] = useState(() => (serverTime ? Date.parse(serverTime) - Date.now() : 0));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const left = Math.max(0, Date.parse(endsAt) - (now + skew));
  useEffect(() => { if (left === 0) onEnd?.(); }, [left, onEnd]);
  const h = Math.floor(left / 3600_000), m = Math.floor(left / 60_000) % 60, s = Math.floor(left / 1000) % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <View accessibilityLabel={`${tr("ينتهي خلال")} ${h}:${pad(m)}:${pad(s)}`} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 4, backgroundColor: t.orangeSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Timer size={13} color={t.orange} />
      <Txt weight="extra" style={{ color: t.orange, fontSize: 12, fontVariant: ["tabular-nums"] }} testID="countdown">{left ? `${pad(h)}:${pad(m)}:${pad(s)}` : tr("انتهى العرض")}</Txt>
    </View>
  );
}
