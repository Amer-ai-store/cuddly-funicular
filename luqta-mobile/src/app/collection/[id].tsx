// Curated collection page (G16).
import React from "react";
import { useLocalSearchParams } from "expo-router";
import { Shell } from "../../components/Shell";
import { ProductGrid } from "../../components/ProductGrid";
import { ErrorBlock, LoadingBlock } from "../../components/design/kit";
import { useStore } from "../../lib/store";
import { useRemote } from "../../lib/useRemote";
import type { Product } from "../../data/products";

export default function CollectionPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { products } = useStore();
  const { data, loading, error, reload } = useRemote<{ collection: { title: string; subtitle: string | null; products: Product[] } }>(id ? `/collections/${id}` : null);
  const items = (data?.collection.products || []).map((p) => products.find((x) => x.id === p.id) || p);
  return (
    <Shell title={data?.collection.title || "مجموعة"} subtitle={data?.collection.subtitle || undefined}>
      {loading && !data ? <LoadingBlock /> : !data ? <ErrorBlock message={error || "المجموعة غير متاحة"} onRetry={reload} /> : <ProductGrid items={items} />}
    </Shell>
  );
}
