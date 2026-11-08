// Checks once per launch on Android (at most every six hours) whether a newer APK was published.
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RELEASES_API, isNewer, releaseFrom, type ReleaseInfo } from "./appUpdate";

const CHECK_KEY = "luqta-update-check-v1";
const DISMISS_KEY = "luqta-update-dismissed-v1";
const EVERY_MS = 6 * 60 * 60 * 1000;

export function useAppUpdate() {
  const [update, setUpdate] = useState<ReleaseInfo | null>(null);
  const current = Constants.expoConfig?.version || null;
  useEffect(() => {
    if (Platform.OS !== "android" || !current) return;
    let active = true;
    (async () => {
      try {
        const [cached, dismissed] = await Promise.all([AsyncStorage.getItem(CHECK_KEY), AsyncStorage.getItem(DISMISS_KEY)]);
        let release: ReleaseInfo | null = null;
        const saved = cached ? JSON.parse(cached) as { at: number; release: ReleaseInfo | null } : null;
        if (saved && Date.now() - saved.at < EVERY_MS) release = saved.release;
        else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const response = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal }).finally(() => clearTimeout(timer));
          release = response.ok ? releaseFrom(await response.json()) : null;
          await AsyncStorage.setItem(CHECK_KEY, JSON.stringify({ at: Date.now(), release }));
        }
        if (active && release && isNewer(current, release.version) && dismissed !== release.version) setUpdate(release);
      } catch { /* offline or rate-limited: try again next launch */ }
    })();
    return () => { active = false; };
  }, [current]);
  const dismiss = useCallback(() => {
    if (update) void AsyncStorage.setItem(DISMISS_KEY, update.version).catch(() => {});
    setUpdate(null);
  }, [update]);
  return { update, current, dismiss };
}
