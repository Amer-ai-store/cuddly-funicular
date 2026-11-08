import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform, useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Design tokens from the لُقطة × Amer AI Store mockups: lavender surfaces, deep-purple ink, coral calls to action.
// `orange` keeps its historical name across screens and holds the coral accent.
export const theme = {
  background: "#F5F2FF",
  paper: "#FFFFFF",
  ink: "#241B4B",
  muted: "#6E6890",
  orange: "#FF6B4A",
  orangeSoft: "#FFEDE8",
  line: "#E6E0F7",
  green: "#1F9D6B",
  secondary: "#EEE9FF",
  success: "#1F9D6B",
  danger: "#D93B54",
  onAccent: "#FFFFFF",
  imageBackground: "#F1ECFF",
  toast: "#241B4B",
  onToast: "#FFFFFF",
  primary: "#5B3FD6",
  primarySoft: "#E9E3FF",
  onPrimary: "#FFFFFF",
  warning: "#E69A17",
  warningSoft: "#FFF4DD",
  successSoft: "#E3F6EE",
  shadow: "#3B2A8A",
  // Extra tokens from main's palette (assets and 3D engines work); not used by the screens yet.
  backgroundDeep: "#EDE7FB",
  card: "#FCFBFE",
  title: "#130050",
  mutedSoft: "#9891B0",
  chip: "#FADDE5",
  purple: "#6E4AA6",
  purpleSoft: "#ECE5FC",
  field: "#F5F1FE",
  info: "#146CF8",
  infoSoft: "#E0EBFD",
  warn: "#BC7B2A",
  warnSoft: "#FEF4D5",
  discount: "#0AA470",
};

export type Palette = typeof theme;
export type ThemeMode = "light" | "dark" | "system";
export const darkTheme: Palette = {
  background: "#100C22",
  paper: "#1C1636",
  ink: "#F4F1FF",
  muted: "#B4ADD6",
  orange: "#FF8A6E",
  orangeSoft: "#3B2128",
  line: "#342B5E",
  green: "#5FD3A1",
  secondary: "#272051",
  success: "#5FD3A1",
  danger: "#FF8597",
  onAccent: "#2A0F08",
  imageBackground: "#251E47",
  toast: "#ECE8FF",
  onToast: "#1A1433",
  primary: "#A893FF",
  primarySoft: "#2B2257",
  onPrimary: "#160F33",
  warning: "#FFC35C",
  warningSoft: "#3A2E14",
  successSoft: "#143528",
  // Extra tokens from main's palette.
  backgroundDeep: "#0F0A1E",
  card: "#221A3D",
  title: "#FFFFFF",
  mutedSoft: "#9C90BB",
  chip: "#4A2236",
  purple: "#A68BE0",
  purpleSoft: "#2E2450",
  field: "#2A2147",
  info: "#7FB0FF",
  infoSoft: "#1B2A4A",
  warn: "#F0C27A",
  warnSoft: "#3D3018",
  discount: "#6FD3A6",
  shadow: "#000000",
};
// The "رفيق" design, a second look the shopper can choose in Language & appearance (the classic design above stays the
// default). Night is its intended look: a deep void, leaf green for the AI and the shopper's own place, gold for the
// brand. Day keeps the same roles on pearl surfaces, with a darker leaf that reads on white.
export const rafiqDark: Palette = {
  background: "#070A12",
  paper: "#0D1220",
  ink: "#E8ECF5",
  muted: "#9BA4BA",
  orange: "#B4F28A",
  orangeSoft: "#1A2616",
  line: "#222838",
  green: "#9BE27A",
  secondary: "#131A2B",
  success: "#9BE27A",
  danger: "#FF8A9A",
  onAccent: "#0F1F08",
  imageBackground: "#131A2B",
  toast: "#E8ECF5",
  onToast: "#070A12",
  primary: "#D8B878",
  primarySoft: "#2A2416",
  onPrimary: "#1A1405",
  warning: "#E8C36A",
  warningSoft: "#2B2414",
  successSoft: "#15241A",
  shadow: "#000000",
  backgroundDeep: "#05070D",
  card: "#131A2B",
  title: "#FFFFFF",
  mutedSoft: "#7A839A",
  chip: "#2A2416",
  purple: "#A99BF0",
  purpleSoft: "#1E1B36",
  field: "#131A2B",
  info: "#8FC9E8",
  infoSoft: "#14243A",
  warn: "#E8B86B",
  warnSoft: "#2B2414",
  discount: "#B4F28A",
};
export const rafiqLight: Palette = {
  background: "#F3F5F9",
  paper: "#FFFFFF",
  ink: "#0D1220",
  muted: "#5A6378",
  orange: "#2F7A17",
  orangeSoft: "#E6F4DC",
  line: "#E1E5EE",
  green: "#2F7A17",
  secondary: "#EBEEF5",
  success: "#2F7A17",
  danger: "#C8364F",
  onAccent: "#FFFFFF",
  imageBackground: "#EEF1F7",
  toast: "#0D1220",
  onToast: "#FFFFFF",
  primary: "#1F2A44",
  primarySoft: "#E5E9F2",
  onPrimary: "#FFFFFF",
  warning: "#B7791F",
  warningSoft: "#FBF1DC",
  successSoft: "#E6F4DC",
  shadow: "#0D1220",
  backgroundDeep: "#E9EDF4",
  card: "#FFFFFF",
  title: "#070A12",
  mutedSoft: "#8A93A8",
  chip: "#F1E9D6",
  purple: "#6B5BD6",
  purpleSoft: "#ECE9FC",
  field: "#F1F3F8",
  info: "#2563EB",
  infoSoft: "#E3ECFD",
  warn: "#A86B1F",
  warnSoft: "#FBF1DC",
  discount: "#2F7A17",
};

export type Design = "classic" | "rafiq";
export type Fonts = { regular: string; medium: string; bold: string; extra: string };
export const DESIGN_FONTS: Record<Design, Fonts> = {
  classic: { regular: "Tajawal_400Regular", medium: "Tajawal_500Medium", bold: "Tajawal_700Bold", extra: "Tajawal_800ExtraBold" },
  rafiq: { regular: "IBMPlexSansArabic_400Regular", medium: "IBMPlexSansArabic_500Medium", bold: "IBMPlexSansArabic_600SemiBold", extra: "ReadexPro_600SemiBold" },
};
export const paletteFor = (design: Design, dark: boolean): Palette => (design === "rafiq" ? (dark ? rafiqDark : rafiqLight) : (dark ? darkTheme : theme));
// Stores created before the redesign saved this rust colour as their accent; it now means "use the design accent".
const LEGACY_ACCENT = "#B94721";

type ThemeValue = {
  colors: Palette;
  fonts: Fonts;
  design: Design;
  setDesign: (design: Design) => void;
  /** The Rafiq design did not finish starting last time (the app closed), so this launch fell back to classic. */
  designRecovered: boolean;
  mode: ThemeMode;
  isDark: boolean;
  hydrated: boolean;
  storageError: boolean;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: string | null) => void;
};
const Context = createContext<ThemeValue>({
  colors: theme,
  fonts: DESIGN_FONTS.classic,
  design: "classic",
  setDesign: () => {},
  designRecovered: false,
  mode: "system",
  isDark: false,
  hydrated: false,
  storageError: false,
  setMode: () => {},
  setAccentColor: () => {},
});
const STORAGE_KEY = "luqta-appearance-v1";
const DESIGN_KEY = "luqta-design-v1";
// Set while the Rafiq design is starting on a phone and cleared once it has run for a few seconds. Still set at the
// next launch means the app closed while showing it, so that launch falls back to the classic design.
const DESIGN_BOOT_KEY = "luqta-design-boot-v1";
const DESIGN_BOOT_OK_MS = 8000;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemMode = useColorScheme();
  const [mode, setPreference] = useState<ThemeMode>("system");
  const [design, setDesignState] = useState<Design>("classic");
  const [designRecovered, setDesignRecovered] = useState(false);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(DESIGN_KEY), AsyncStorage.getItem(DESIGN_BOOT_KEY)])
      .then(([saved, savedDesign, boot]) => {
        if (active && (saved === "light" || saved === "dark" || saved === "system"))
          setPreference(saved);
        if (active && savedDesign === "rafiq" && boot === "starting" && Platform.OS !== "web") {
          setDesignState("classic");
          setDesignRecovered(true);
          void AsyncStorage.removeItem(DESIGN_BOOT_KEY).catch(() => {});
        } else if (active && (savedDesign === "classic" || savedDesign === "rafiq"))
          setDesignState(savedDesign);
      })
      .catch(() => {
        if (active) setStorageError(true);
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    Promise.all([AsyncStorage.setItem(STORAGE_KEY, mode), AsyncStorage.setItem(DESIGN_KEY, design)])
      .then(() => setStorageError(false))
      .catch(() => setStorageError(true));
  }, [mode, design, hydrated]);
  // Crash-loop guard for the Rafiq design on phones (see DESIGN_BOOT_KEY).
  useEffect(() => {
    if (!hydrated || Platform.OS === "web" || design !== "rafiq") return;
    let done = false;
    AsyncStorage.setItem(DESIGN_BOOT_KEY, "starting").catch(() => {});
    const timer = setTimeout(() => { done = true; AsyncStorage.removeItem(DESIGN_BOOT_KEY).catch(() => {}); }, DESIGN_BOOT_OK_MS);
    return () => { clearTimeout(timer); if (!done) AsyncStorage.removeItem(DESIGN_BOOT_KEY).catch(() => {}); };
  }, [design, hydrated]);
  const isDark = mode === "dark" || (mode === "system" && systemMode === "dark");
  // The store's own accent colour (set by the admin) applies to the classic design; Rafiq keeps its leaf green.
  const colors = useMemo<Palette>(() => ({ ...paletteFor(design, isDark), ...(design === "classic" && accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor) && accentColor.toUpperCase() !== LEGACY_ACCENT ? { orange: accentColor } : {}) }), [design, isDark, accentColor]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    document.documentElement.style.backgroundColor = colors.background;
    document.body.style.backgroundColor = colors.background;
  }, [isDark, colors]);
  const value = useMemo<ThemeValue>(
    () => ({
      colors,
      fonts: DESIGN_FONTS[design],
      design,
      setDesign: (next) => {
        if (next === "classic" || next === "rafiq") { setDesignState(next); setDesignRecovered(false); }
      },
      designRecovered,
      mode,
      isDark,
      hydrated,
      storageError,
      setAccentColor,
      setMode: (next) => {
        if (next === "light" || next === "dark" || next === "system")
          setPreference(next);
      },
    }),
    [colors, design, designRecovered, mode, isDark, hydrated, storageError],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTheme() {
  return useContext(Context);
}

export function useThemedStyles<T>(factory: (colors: Palette) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [colors, factory]);
}
