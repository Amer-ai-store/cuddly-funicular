// "المتاجر القريبة": the store's branches around the shopper on a full map, nearest first, with directions, the
// products in stock at the chosen branch and the store's social pages.
import React from "react";
import { View } from "react-native";
import { Clock, MapPin, Store } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Row, SectionTitle, Skeleton, StatTile, Txt } from "../components/ui";
import { NearbyStores } from "../components/rafiq/NearbyStores";
import { SocialLinks } from "../components/rafiq/SocialLinks";
import { useNearby } from "../lib/useNearby";
import { formatDistance } from "../lib/rafiq";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";

export default function NearbyScreen() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const nearby = useNearby();
  const nearest = nearby.branches[0];
  return (
    <Shell title="المتاجر القريبة" subtitle="فروعنا من حولك على الخريطة، وما يتوفر فيها الآن" testID="nearby-screen" back>
      <Row gap={8} style={{ marginBottom: 14 }}>
        <StatTile testID="stat-branches" label="فروع على الخريطة" value={String(nearby.branches.length)} icon={<Store size={16} color={t.primary} />} />
        <StatTile testID="stat-distance" tone="accent" label="أقرب فرع" value={nearest && nearest.km !== null ? formatDistance(nearest.km, lang) : "—"} icon={<MapPin size={16} color={t.orange} />} />
        <StatTile testID="stat-eta" tone="success" label="توصيل تقريبي" value={nearest && nearest.eta !== null ? tr("{n} د", { n: nearest.eta }) : "—"} icon={<Clock size={16} color={t.success} />} />
      </Row>
      {nearby.loading && !nearby.branches.length ? (
        <View style={{ gap: 10 }}><Skeleton height={320} radius={16} /><Skeleton height={64} radius={14} /><Skeleton height={64} radius={14} /></View>
      ) : (
        <NearbyStores nearby={nearby} map="inline" mapHeight={340} />
      )}
      <SectionTitle title="تابع متجرنا" subtitle="العروض والوصول الجديد أولًا بأول" />
      <SocialLinks />
      <Txt style={{ marginTop: 16, fontSize: 11, color: t.muted, lineHeight: 18 }}>{tr("الخريطة من OpenStreetMap. وقت التوصيل تقدير يعتمد على المسافة، ويؤكَّد عند الطلب.")}</Txt>
    </Shell>
  );
}
