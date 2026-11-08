import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { EN } from "./i18n-en";

// Screens are written Arabic-first: `row-reverse` rows and right-aligned text. English flips the root layout
// direction, which mirrors every row at once, and `Txt` switches text alignment, so one layout serves both languages.
export type Lang = "ar" | "en";
type I18n = {
  lang: Lang;
  isRTL: boolean;
  setLang: (lang: Lang) => void;
  t: (arabic: string, vars?: Record<string, string | number>) => string;
  align: "right" | "left";
  hydrated: boolean;
  displayCurrency: string | null;
  setDisplayCurrency: (code: string | null) => void;
};
const KEY = "luqta-language-v1";
const CURRENCY_KEY = "luqta-display-currency-v1";
const fill = (text: string, vars?: Record<string, string | number>) => vars ? text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) : text;
export function translate(lang: Lang, arabic: string, vars?: Record<string, string | number>) {
  return fill(lang === "en" ? EN[arabic] ?? arabic : arabic, vars);
}
const Context = createContext<I18n>({ lang: "ar", isRTL: true, setLang: () => {}, t: (s, v) => fill(s, v), align: "right", hydrated: false, displayCurrency: null, setDisplayCurrency: () => {} });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  const [hydrated, setHydrated] = useState(false);
  const [displayCurrency, setCurrencyState] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    AsyncStorage.multiGet([KEY, CURRENCY_KEY]).then(([[, saved], [, currency]]) => { if (!active) return; if (saved === "ar" || saved === "en") setLangState(saved); if (currency && /^[A-Z]{3}$/.test(currency)) setCurrencyState(currency); }).catch(() => {}).finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, []);
  const setLang = useCallback((next: Lang) => {
    if (next !== "ar" && next !== "en") return;
    setLangState(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);
  const setDisplayCurrency = useCallback((code: string | null) => {
    if (code !== null && !/^[A-Z]{3}$/.test(code)) return;
    setCurrencyState(code);
    (code ? AsyncStorage.setItem(CURRENCY_KEY, code) : AsyncStorage.removeItem(CURRENCY_KEY)).catch(() => {});
  }, []);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const value = useMemo<I18n>(() => ({ lang, isRTL: lang === "ar", setLang, t: (s, v) => translate(lang, s, v), align: lang === "ar" ? "right" : "left", hydrated, displayCurrency, setDisplayCurrency }), [lang, setLang, hydrated, displayCurrency, setDisplayCurrency]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n() {
  return useContext(Context);
}

// Root style: Arabic keeps the authored layout; English mirrors it.
export const rootDirection = (lang: Lang) => (lang === "ar" ? "ltr" : "rtl") as "ltr" | "rtl";
