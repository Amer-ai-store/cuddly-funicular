// Shared by the native and web branch maps (a separate file, so the web build does not import itself).
import { useMemo } from "react";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { storesMapHtml } from "../../lib/storesMap";
import type { GeoPoint, PlacedBranch } from "../../lib/rafiq";

export type StoresMapProps = { home: GeoPoint | null; branches: PlacedBranch[]; selectedId: string | null; onSelect: (id: string) => void; height?: number; dark?: boolean };

export function useStoresMapHtml({ home, branches, selectedId, dark }: StoresMapProps) {
  const { isDark } = useTheme();
  const { t, lang } = useI18n();
  const night = dark ?? isDark;
  return useMemo(() => storesMapHtml({ home, branches, selectedId, dark: night, lang, labels: { home: t("منزلك"), minutes: t("د"), error: t("تعذر تحميل الخريطة. تحقق من الإنترنت وأعد المحاولة."), aria: t("خريطة فروع المتجر القريبة من موقعك") } }), [home, branches, selectedId, night, lang, t]);
}
