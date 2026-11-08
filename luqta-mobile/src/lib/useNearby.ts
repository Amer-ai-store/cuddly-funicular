// "Near me": the store's branches with distance and delivery time from the shopper's location, and the products in
// stock at the chosen (or nearest) branch. Location permission is asked only when the shopper taps "locate me"; if
// it was granted before, the position is read straight away. The position stays in memory and is never uploaded.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import { useApi } from "./useApi";
import { useStore } from "./store";
import { placeBranches, type Branch, type GeoPoint } from "./rafiq";
import type { Product } from "../data/products";

export type LocateStatus = "idle" | "asking" | "located" | "denied" | "unavailable";

async function readPosition(): Promise<GeoPoint | null> {
  const last = Platform.OS === "web" ? null : await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
  const point = last || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = point.coords;
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

export function useNearby() {
  const store = useStore();
  const remote = useApi<{ branches: Branch[] }>("/branches");
  const branches = useMemo<Branch[]>(() => (remote.data?.branches?.length ? remote.data.branches : store.settings.branches || []), [remote.data, store.settings.branches]);
  const [home, setHome] = useState<GeoPoint | null>(null);
  const [status, setStatus] = useState<LocateStatus>("idle");

  const locate = useCallback(async () => {
    setStatus("asking");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") { setStatus("denied"); return; }
      const point = await readPosition();
      if (!point) { setStatus("unavailable"); return; }
      setHome(point); setStatus("located");
    } catch { setStatus("unavailable"); }
  }, []);

  // Permission granted earlier: no prompt, just read the position.
  useEffect(() => {
    let active = true;
    Location.getForegroundPermissionsAsync()
      .then(async (permission) => {
        if (!active || permission.status !== "granted") return;
        const point = await readPosition();
        if (active && point) { setHome(point); setStatus("located"); }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const placed = useMemo(() => placeBranches(branches, home), [branches, home]);
  const selectedId = store.branchId && placed.some((b) => b.id === store.branchId) ? store.branchId : null;
  const focus = placed.find((b) => b.id === selectedId) || (home ? placed[0] : null) || null;
  const stock = useApi<{ stock: { productId: string; quantity: number }[] }>(focus ? `/branches/${encodeURIComponent(focus.id)}/stock` : null);
  const products = useMemo<Product[]>(() => {
    if (!stock.data) return [];
    const quantities = new Map(stock.data.stock.map((s) => [s.productId, s.quantity]));
    return store.products
      .filter((p) => p.active !== false && (quantities.get(p.id) ?? 0) > 0)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 8);
  }, [stock.data, store.products]);

  return { branches: placed, home, status, locate, selectedId, select: store.setBranch, focus, products, loading: remote.loading };
}
