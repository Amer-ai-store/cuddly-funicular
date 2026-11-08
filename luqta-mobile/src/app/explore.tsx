import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Camera, Mic, MicOff, ScanBarcode, Search, SlidersHorizontal, MapPin, Clock, X } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Button, Card, Chip, Notice, Row, Txt } from "../components/ui";
import { ProductGrid } from "../components/ProductGrid";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { CategoryIcon } from "../components/CategoryIcon";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { useVoiceInput } from "../lib/voice";
import { pickPhoto } from "../lib/photos";
import { categoryName, useCategories } from "../lib/catalog";
import { searchCatalog } from "../lib/catalog-search";
import { useRobot } from "../lib/robot";
import type { Product } from "../data/products";

const SORTS = [["relevance", "الأنسب"], ["price-asc", "الأقل سعرًا"], ["price-desc", "الأعلى سعرًا"], ["rating", "الأعلى تقييمًا"], ["newest", "الأحدث"], ["popular", "الأكثر طلبًا"]] as const;
const PRICES = [["", "أي سعر"], ["0-1", "أقل من 1"], ["1-5", "1 – 5"], ["5-20", "5 – 20"], ["20-", "أكثر من 20"]] as const;
type Suggestion = { type: "product" | "category" | "query"; id?: string; label: string };
type Branch = { id: string; name: string; city: string };

export default function Explore() {
  const { colors: t } = useTheme();
  const { t: tr, lang, isRTL } = useI18n();
  const store = useStore();
  const { configured } = useSession();
  const robot = useRobot();
  const params = useLocalSearchParams<{ q?: string; category?: string; mode?: string }>();
  const categories = useCategories();
  const [query, setQuery] = useState(params.q || "");
  const [submitted, setSubmitted] = useState(params.q || "");
  const [category, setCategory] = useState(params.category || "all");
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("relevance");
  const [price, setPrice] = useState("");
  const [minRating, setMinRating] = useState(false);
  const [inStock, setInStock] = useState(false);
  const [onSale, setOnSale] = useState(false);
  const [filters, setFilters] = useState(false);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [results, setResults] = useState<Product[] | null>(null);
  const [didYouMean, setDidYouMean] = useState<string | null>(null);
  const [imageHit, setImageHit] = useState<{ color: string; colorName: string; results: Product[] } | null>(null);
  const [scanner, setScanner] = useState(false);
  const [notice, setNotice] = useState("");
  const voice = useVoiceInput(lang);
  const branches = useApi<{ branches: Branch[] }>("/branches");
  const hints = useApi<{ trending: string[]; recent: string[] }>(focused && !query ? "/search/suggest?q=" : null);

  // Follow new links into this screen (category tiles, search from home) without an effect.
  const [seenParams, setSeenParams] = useState({ category: params.category, q: params.q });
  if (seenParams.category !== params.category || seenParams.q !== params.q) {
    setSeenParams({ category: params.category, q: params.q });
    if (params.category) setCategory(params.category);
    if (params.q !== undefined) { setQuery(params.q); setSubmitted(params.q); }
  }
  useEffect(() => {
    if (params.mode === "voice") listen();
    if (params.mode === "image") void searchByImage();
  // only when the screen is opened from the home shortcuts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.mode]);
  // Suggestions as the shopper types (debounced).
  useEffect(() => {
    if (!configured || !query.trim()) return;
    const timer = setTimeout(() => { api.get<{ suggestions: Suggestion[] }>(`/search/suggest?q=${encodeURIComponent(query.trim())}`).then((r) => setSuggestions(r.suggestions)).catch(() => setSuggestions([])); }, 220);
    return () => clearTimeout(timer);
  }, [query, configured]);
  const [min, max] = price ? price.split("-").map((v) => (v === "" ? undefined : Number(v))) : [undefined, undefined];
  // Server search when connected (Arabic normalisation, typos, branch stock), local search in sample mode.
  useEffect(() => {
    let active = true;
    if (!configured) return;
    const q = new URLSearchParams();
    if (submitted) q.set("q", submitted);
    if (category !== "all") q.set("category", category);
    q.set("sort", sort === "relevance" && !submitted ? "featured" : sort);
    if (min !== undefined) q.set("minPrice", String(min));
    if (max !== undefined) q.set("maxPrice", String(max));
    if (minRating) q.set("minRating", "4");
    if (inStock) q.set("inStock", "1");
    if (onSale) q.set("onSale", "1");
    if (store.branchId) q.set("branch", store.branchId);
    api.get<{ results: Product[]; didYouMean: string | null }>(`/search?${q}`).then((r) => { if (active) { setResults(r.results); setDidYouMean(r.didYouMean); } }).catch(() => { if (active) setResults(null); });
    return () => { active = false; };
  }, [configured, submitted, category, sort, min, max, minRating, inStock, onSale, store.branchId]);
  const local = useMemo(() => {
    let list = searchCatalog(store.products, { query: submitted, category, maxPrice: max, inStockOnly: inStock, sort: sort === "price-asc" ? "low" : sort === "price-desc" ? "high" : sort === "rating" ? "rating" : "featured" });
    if (min !== undefined) list = list.filter((p) => p.price >= min);
    if (minRating) list = list.filter((p) => p.rating >= 4);
    if (onSale) list = list.filter((p) => p.oldPrice && p.oldPrice > p.price);
    return list;
  }, [store.products, submitted, category, sort, min, max, minRating, inStock, onSale]);
  const shown = imageHit ? imageHit.results : (configured ? results : null) ?? local;
  const visibleSuggestions = configured && query.trim() ? suggestions : [];
  const run = (text: string) => { setQuery(text); setSubmitted(text); setFocused(false); setImageHit(null); };
  function listen() {
    if (!voice.supported) { setNotice("البحث الصوتي غير مدعوم هنا؛ استخدم ميكروفون لوحة المفاتيح."); return; }
    robot.react("search", tr("أسمعك… قل اسم المنتج 🎙️"));
    voice.start((text) => run(text));
  }
  async function searchByImage() {
    if (!configured) { setNotice("البحث بالصورة يحتاج الاتصال بخادم المتجر."); return; }
    try {
      const image = await pickPhoto({ width: 96, format: "png" });
      if (!image) return;
      const hit = await api.post<{ color: string; colorName: string; results: Product[] }>("/search/image", { image });
      setImageHit(hit); setSubmitted(""); setQuery("");
      robot.react("search", tr("لقيت منتجات بلون {c}", { c: hit.colorName }));
    } catch (error) { setNotice(error instanceof Error && error.message === "permission" ? "اسمح بالوصول إلى الصور للبحث بالصورة." : error instanceof Error ? error.message : "تعذر البحث بالصورة."); }
  }
  async function byBarcode(code: string) {
    try {
      const { product } = await api.get<{ product: Product }>(`/products/barcode/${encodeURIComponent(code)}`);
      setScanner(false); router.push(`/product/${product.id}`);
    } catch (error) {
      const local = store.products.find((p) => p.barcode === code || p.sku === code || p.id === code);
      if (local) { setScanner(false); router.push(`/product/${local.id}`); return; }
      store.notify(error instanceof Error ? error.message : "لم نجد منتجًا بهذا الباركود");
    }
  }
  const branchList = branches.data?.branches || [];
  const currentBranch = branchList.find((b) => b.id === store.branchId);
  return (
    <Shell title="اكتشف عالمك" subtitle="كل اللي تحتاجه، من فرعك القريب" testID="explore">
      {branchList.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }} testID="branch-picker">
          <Chip label="كل الفروع" icon={<MapPin size={14} color={!store.branchId ? t.onPrimary : t.primary} />} active={!store.branchId} onPress={() => store.setBranch(null)} />
          {branchList.map((b) => <Chip key={b.id} testID={`branch-${b.id}`} label={`${b.name} · ${b.city}`} active={store.branchId === b.id} onPress={() => store.setBranch(b.id)} />)}
        </ScrollView>
      ) : null}
      {currentBranch ? <Txt style={{ color: t.muted, fontSize: 12, marginBottom: 8 }}>{tr("تعرض الكميات المتوفرة في {b}", { b: currentBranch.name })}</Txt> : null}
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6, backgroundColor: t.paper, borderRadius: 20, borderWidth: 1, borderColor: focused ? t.primary : t.line, paddingHorizontal: 8, minHeight: 56 }}>
        <Search size={19} color={t.muted} />
        <TextInput testID="search-input" accessibilityLabel={tr("ابحث عن منتج")} value={query} onChangeText={(v) => { setQuery(v); setImageHit(null); }} onFocus={() => setFocused(true)} onSubmitEditing={() => run(query.trim())} returnKeyType="search" placeholder={tr("حليب، أرز، سماعات…")} placeholderTextColor={t.muted} style={{ flex: 1, minHeight: 50, color: t.ink, fontFamily: "Tajawal_500Medium", fontSize: 15, textAlign: isRTL ? "right" : "left" }} />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel={tr("مسح البحث")} onPress={() => run("")} style={{ padding: 6 }}><X size={16} color={t.muted} /></Pressable> : null}
        <Pressable testID="voice-search" accessibilityRole="button" accessibilityLabel={tr(voice.listening ? "إيقاف الاستماع" : "بحث صوتي")} onPress={() => (voice.listening ? voice.stop() : listen())} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: voice.listening ? t.orange : t.primarySoft, alignItems: "center", justifyContent: "center" }}>{voice.listening ? <MicOff size={17} color={t.onAccent} /> : <Mic size={17} color={t.primary} />}</Pressable>
        <Pressable testID="barcode-search" accessibilityRole="button" accessibilityLabel={tr("بحث بالباركود")} onPress={() => setScanner(true)} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.primarySoft, alignItems: "center", justifyContent: "center" }}><ScanBarcode size={17} color={t.primary} /></Pressable>
        <Pressable testID="image-search" accessibilityRole="button" accessibilityLabel={tr("بحث بالصورة")} onPress={() => void searchByImage()} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.orangeSoft, alignItems: "center", justifyContent: "center" }}><Camera size={17} color={t.orange} /></Pressable>
      </View>
      {voice.listening ? <Notice text="أستمع إليك… تكلّم الآن" tone="accent" /> : null}
      {notice ? <View style={{ marginTop: 8 }}><Notice text={notice} tone="warning" /></View> : null}
      {focused && (visibleSuggestions.length || (!query && (hints.data?.recent?.length || hints.data?.trending?.length))) ? (
        <Card style={{ marginTop: 8, gap: 2, paddingVertical: 8 }} testID="suggestions">
          {query ? visibleSuggestions.map((s, i) => (
            <Pressable key={`${s.type}-${s.id || s.label}-${i}`} testID={`suggestion-${s.id || i}`} accessibilityRole="button" onPress={() => (s.type === "product" && s.id ? router.push(`/product/${s.id}`) : s.type === "category" && s.id ? (setCategory(s.id), run("")) : run(s.label))} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, minHeight: 44 }}>
              <Search size={15} color={t.muted} /><Txt style={{ flex: 1 }}>{s.label}</Txt><Txt style={{ fontSize: 11, color: t.muted }}>{tr(s.type === "product" ? "منتج" : s.type === "category" ? "قسم" : "بحث شائع")}</Txt>
            </Pressable>
          )) : (
            <>
              {hints.data?.recent?.length ? <Txt weight="bold" style={{ fontSize: 12, color: t.muted }}>{tr("عمليات بحثك الأخيرة")}</Txt> : null}
              <Row wrap>{hints.data?.recent?.map((r) => <Chip key={`r-${r}`} label={r} icon={<Clock size={13} color={t.muted} />} onPress={() => run(r)} />)}</Row>
              {hints.data?.trending?.length ? <Txt weight="bold" style={{ fontSize: 12, color: t.muted, marginTop: 6 }}>{tr("الأكثر بحثًا")}</Txt> : null}
              <Row wrap>{hints.data?.trending?.map((r) => <Chip key={`t-${r}`} label={r} tone="accent" onPress={() => run(r)} />)}</Row>
            </>
          )}
        </Card>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 14 }} testID="category-chips">
        <Chip label="الكل" active={category === "all"} onPress={() => setCategory("all")} />
        {categories.map((c) => <Chip key={c.id} testID={`chip-${c.id}`} label={categoryName(c, lang)} active={category === c.id} icon={<CategoryIcon name={c.icon} size={14} color={category === c.id ? t.onPrimary : c.color} />} onPress={() => setCategory(c.id)} />)}
      </ScrollView>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt weight="bold" testID="result-count">{imageHit ? tr("منتجات بلون {c}", { c: imageHit.colorName }) : tr("{n} منتج", { n: shown.length })}</Txt>
        <Pressable testID="filters-toggle" accessibilityRole="button" accessibilityLabel={tr("التصفية والترتيب")} onPress={() => setFilters((v) => !v)} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: filters ? t.primary : t.paper, borderWidth: 1, borderColor: t.line }}>
          <SlidersHorizontal size={16} color={filters ? t.onPrimary : t.ink} /><Txt weight="bold" style={{ fontSize: 13, color: filters ? t.onPrimary : t.ink }}>{tr("التصفية والترتيب")}</Txt>
        </Pressable>
      </Row>
      {imageHit ? <Row style={{ marginTop: 8 }}><View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: imageHit.color }} /><Txt style={{ color: t.muted, fontSize: 12, flex: 1 }}>{tr("اللون الغالب في صورتك: {c}", { c: imageHit.colorName })}</Txt><Chip label="إلغاء" onPress={() => setImageHit(null)} /></Row> : null}
      {filters ? (
        <Card style={{ marginTop: 12, gap: 10 }} testID="filters">
          <Txt weight="bold">{tr("الترتيب")}</Txt>
          <Row wrap>{SORTS.map(([id, label]) => <Chip key={id} testID={`sort-${id}`} label={label} active={sort === id} onPress={() => setSort(id)} />)}</Row>
          <Txt weight="bold">{tr("السعر")}</Txt>
          <Row wrap>{PRICES.map(([id, label]) => <Chip key={id || "any"} testID={`price-${id || "any"}`} label={label} active={price === id} onPress={() => setPrice(id)} />)}</Row>
          <Row wrap>
            <Chip testID="filter-rating" label="تقييم 4+ ⭐" active={minRating} onPress={() => setMinRating((v) => !v)} />
            <Chip testID="filter-stock" label="المتوفر فقط" active={inStock} onPress={() => setInStock((v) => !v)} />
            <Chip testID="filter-sale" label="عليه خصم" active={onSale} onPress={() => setOnSale((v) => !v)} tone="accent" />
          </Row>
        </Card>
      ) : null}
      {didYouMean && !shown.length ? <Pressable accessibilityRole="button" onPress={() => run(didYouMean)} style={{ marginTop: 10 }}><Txt style={{ color: t.primary }}>{tr("هل تقصد «{q}»؟", { q: didYouMean })}</Txt></Pressable> : null}
      <View style={{ marginTop: 14 }}>
        {shown.length ? <ProductGrid items={shown} /> : <Card style={{ alignItems: "center", gap: 10 }}><Txt weight="bold">{tr("لا توجد نتائج مطابقة")}</Txt><Button title={tr("اسأل لُقطي")} onPress={() => router.navigate({ pathname: "/assistant", params: { q: submitted } })} secondary /></Card>}
      </View>
      <BarcodeScanner visible={scanner} onClose={() => setScanner(false)} onCode={(code) => void byBarcode(code)} />
    </Shell>
  );
}
