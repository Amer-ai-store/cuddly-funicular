import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Star } from "lucide-react-native";
import { router, useFocusEffect } from "expo-router";
import { Button, Txt } from "./ui";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Palette, useTheme, useThemedStyles } from "../lib/theme";

type Review = { id: string; userId: string; name: string; rating: number; title: string; body: string; createdAt: string };
type ReviewResponse = { reviews: Review[]; rating: number; count: number };

export function ProductReviews({ productId }: { productId: string }) {
  const { user, configured, baseUrl } = useSession();
  const { colors: t } = useTheme();
  const s = useThemedStyles(styles);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const version = useRef(0);
  const userId = user?.id;
  const identity = `${baseUrl}:${productId}:${userId || ""}`;
  const currentIdentity = useRef(identity);
  useEffect(() => { currentIdentity.current = identity; }, [identity]);
  const own = data?.reviews.find((review) => review.userId === user?.id);
  const load = useCallback(async () => {
    const current = ++version.current;
    if (!configured || !productId) { setData(null); setLoadedFor(""); setError(""); return; }
    setLoading(true); setError("");
    try {
      const result = await api.get<ReviewResponse>(`/products/${encodeURIComponent(productId)}/reviews`);
      if (current === version.current) {
        setData(result); setLoadedFor(`${baseUrl}:${productId}:${userId || ""}`);
        const mine = result.reviews.find((review) => review.userId === userId);
        setRating(mine?.rating || 0); setTitle(mine?.title || ""); setBody(mine?.body || "");
      }
    } catch (failure) {
      if (current === version.current) setError(failure instanceof Error ? failure.message : "تعذّر تحميل التقييمات");
    } finally { if (current === version.current) setLoading(false); }
  }, [configured, productId, baseUrl, userId]);
  useFocusEffect(useCallback(() => {
    setNotice(""); setBusy(false);
    void load();
    return () => { version.current++; };
  }, [load]));

  const submit = async () => {
    if (busy || !user || !configured || loadedFor !== identity) return;
    if (!rating) { setError("اختر تقييمًا من نجمة إلى خمس نجوم."); return; }
    if (body.trim().length < 5) { setError("اكتب تجربتك في خمس حروف على الأقل."); return; }
    const actionIdentity = identity;
    setBusy(true); setError(""); setNotice("");
    try {
      if (own) await api.patch(`/reviews/${encodeURIComponent(own.id)}`, { rating, title: title.trim(), body: body.trim() });
      else await api.post(`/products/${encodeURIComponent(productId)}/reviews`, { rating, title: title.trim(), body: body.trim() });
      if (currentIdentity.current !== actionIdentity) return;
      await load();
      setNotice(own ? "حُفظ تعديل تقييمك على الخادم." : "حُفظ تقييمك على الخادم. شكرًا لمشاركة تجربتك.");
    } catch (failure) {
      if (currentIdentity.current === actionIdentity) setError(failure instanceof Error ? failure.message : "تعذّر حفظ التقييم");
    } finally { if (currentIdentity.current === actionIdentity) setBusy(false); }
  };

  return (
    <View style={s.container}>
      <View style={s.heading}>
        <View style={{ flex: 1, gap: 7 }}><Txt weight="extra" style={{ fontSize: 24 }}>تقييمات المشترين</Txt><Txt style={s.muted}>تجارب محفوظة على الخادم من حسابات اشترت المنتج واستلمته.</Txt></View>
        {configured ? <Button title="تحديث التقييمات" secondary busy={loading} onPress={() => { void load(); }} /> : null}
      </View>
      {!configured ? <View style={s.card}><Txt style={s.muted}>اربط خادم المتجر لقراءة تقييمات حقيقية. لا نعرض تقييمات تجريبية هنا.</Txt><Button title="إعداد الاتصال" secondary onPress={() => router.push("/connection")} /></View> : <>
        {error ? <Txt accessibilityRole="alert" style={{ color: t.danger, lineHeight: 25 }}>{error}</Txt> : null}
        {notice ? <Txt accessibilityRole="alert" style={{ color: t.green, lineHeight: 25 }}>{notice}</Txt> : null}
        {loadedFor !== identity ? loading ? <ActivityIndicator color={t.orange} /> : null : <>
          <View style={s.summary}><Star color={t.orange} fill={data?.count ? t.orange : "transparent"} size={22} /><Txt weight="bold">{data?.count ? `${Number(data.rating).toFixed(1)} من 5 · ${data.count} تقييم` : "لا توجد تقييمات بعد"}</Txt></View>
          {data?.reviews.map((review) => <View key={review.id} style={s.card}>
            <View style={s.heading}><Txt weight="bold" style={{ flex: 1 }}>{review.name}</Txt><View style={s.stars}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={16} color={n <= review.rating ? t.orange : t.muted} fill={n <= review.rating ? t.orange : "transparent"} />)}</View></View>
            <Txt style={s.small}>شراء تم تسليمه · {new Date(review.createdAt).toLocaleDateString("ar")}{review.userId === user?.id ? " · تقييمك" : ""}</Txt>
            {review.title ? <Txt weight="bold">{review.title}</Txt> : null}
            <Txt style={{ lineHeight: 26 }}>{review.body}</Txt>
          </View>)}
          {!user ? <View style={s.card}><Txt style={s.muted}>سجّل الدخول لإضافة تقييم بعد استلام طلب يحتوي على هذا المنتج.</Txt><Button title="تسجيل الدخول للتقييم" secondary onPress={() => router.push("/login")} /></View> : <View style={s.card}>
            <Txt weight="bold" style={{ fontSize: 20 }}>{own ? "تعديل تقييمك" : "شارك تجربتك"}</Txt>
            <Txt style={s.muted}>يتحقق الخادم من وجود شراء تم تسليمه. يُسمح بتقييم واحد للمنتج لكل حساب، ويمكنك تعديله.</Txt>
            <View style={s.stars}>{[1, 2, 3, 4, 5].map((n) => <Pressable key={n} accessibilityRole="button" accessibilityLabel={`تقييم ${n} من 5`} aria-selected={rating === n} style={s.starButton} onPress={() => setRating(n)}><Star color={n <= rating ? t.orange : t.muted} fill={n <= rating ? t.orange : "transparent"} size={27} /></Pressable>)}</View>
            <Txt style={s.small}>{rating ? `اخترت ${rating} من 5` : "اختر عدد النجوم"}</Txt>
            <TextInput accessibilityLabel="عنوان التقييم" placeholder="عنوان التقييم (اختياري)" placeholderTextColor={t.muted} maxLength={120} value={title} onChangeText={setTitle} style={s.input} />
            <TextInput accessibilityLabel="نص التقييم" placeholder="كيف كانت تجربتك مع المنتج؟" placeholderTextColor={t.muted} maxLength={2000} value={body} onChangeText={setBody} multiline textAlignVertical="top" style={[s.input, { minHeight: 115 }]} />
            <Button title={own ? "حفظ تعديل التقييم" : "نشر التقييم"} busy={busy} disabled={loading} onPress={() => { void submit(); }} />
          </View>}
        </>}
      </>}
    </View>
  );
}

export default ProductReviews;

const styles = (t: Palette) => StyleSheet.create({
  container: { gap: 18, marginTop: 30 },
  heading: { flexDirection: "row-reverse", alignItems: "center", gap: 15, flexWrap: "wrap" },
  card: { backgroundColor: t.paper, borderRadius: 18, borderWidth: 1, borderColor: t.line, padding: 20, gap: 14 },
  muted: { color: t.muted, fontSize: 14, lineHeight: 25 },
  small: { color: t.muted, fontSize: 12, lineHeight: 21 },
  summary: { flexDirection: "row-reverse", alignItems: "center", gap: 10 },
  stars: { flexDirection: "row-reverse", alignItems: "center", gap: 3 },
  starButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 51, borderWidth: 1, borderColor: t.line, backgroundColor: t.background, color: t.ink, fontFamily: "Tajawal_400Regular", textAlign: "right", padding: 14, borderRadius: 12, fontSize: 15 },
});
