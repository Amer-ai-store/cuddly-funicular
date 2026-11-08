import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHARACTER_SNAPSHOTS_KEY } from "./characterCache";
import * as Speech from "expo-speech";
import { api } from "./api";
import { useSession } from "./session";

// The shopping companion is the human character from the لُقطة mockups (a rigged 3D model, with the mockups' poses as
// still images). The module keeps its historical "robot" names so screens and saved preferences stay compatible.
export type RobotMotion = "idle" | "wave" | "walk" | "jump" | "come" | "stop" | "dance" | "sleep" | "sad" | "talk"
  | "cart" | "thumbs" | "think" | "point" | "run" | "sit" | "listen" | "crossed";
export type RobotOutfit = "none" | "scarf" | "cape" | "bowtie" | "hoodie";
export type RobotAccessory = "none" | "cap" | "crown" | "glasses" | "headphones" | "flower";
// Accessories the character can wear; older saved values (crown, flower) simply show none.
export const CHARACTER_ACCESSORIES = ["none", "glasses", "cap", "headphones"] as const;
export type RobotPrefs = {
  name: string; color: string; outfit: RobotOutfit; accessory: RobotAccessory; size: number;
  skin: string; hair: string; pants: string; boots: string; beard: boolean; use3d: boolean;
  reduceMotion: boolean; voice: boolean; motion: Exclude<RobotMotion, "idle" | "sleep" | "sad" | "talk">; faceConsent: boolean;
};
export type RobotEvent = "cart" | "favorite" | "order" | "error" | "checkin" | "hello" | "search" | "reward";
// Defaults are the mockups' character: black leather vest (color), red trousers, black boots, a beard.
export const ROBOT_DEFAULTS: RobotPrefs = { name: "لُقطي", color: "#141414", outfit: "none", accessory: "none", size: 1, reduceMotion: false, voice: true, motion: "wave", faceConsent: false,
  skin: "#E0A27C", hair: "#3F281B", pants: "#C4161B", boots: "#101010", beard: true, use3d: true };
export const ROBOT_COLORS = ["#141414", "#5B3FD6", "#FF6B4A", "#22B07D", "#2F80ED", "#F2A900", "#E0559B"];
export const SKIN_TONES = ["#F2C9A6", "#E0A27C", "#C68B5E", "#A8704A", "#8D5524", "#5C3A21"];
export const HAIR_COLORS = ["#3F281B", "#111111", "#6B4423", "#B5651D", "#D9B26F", "#9E9E9E"];
export const PANTS_COLORS = ["#C4161B", "#1F2A44", "#3B3F45", "#6B4F3A", "#2E5E4E", "#E8E2D6"];
export const BOOTS_COLORS = ["#101010", "#5A3A22", "#E9E9E9", "#7A1F1F"];
const REACTIONS: Record<RobotEvent, { motion: RobotMotion; message: string }> = {
  cart: { motion: "cart", message: "أضفتها للسلة! 🎉" },
  favorite: { motion: "thumbs", message: "حفظتها في مفضلتك 💜" },
  order: { motion: "dance", message: "طلبك في الطريق! 🛵" },
  error: { motion: "sad", message: "أوه! حاول مرة ثانية" },
  checkin: { motion: "jump", message: "حضورك اليوم سجلناه ⭐" },
  hello: { motion: "wave", message: "أهلًا! شو بدك اليوم؟" },
  search: { motion: "think", message: "خليني أدور معك 🔎" },
  reward: { motion: "dance", message: "نقاطك زادت! 🏆" },
};
const PREFS_KEY = "luqta-robot-v1";
const FACE_KEY = "luqta-robot-face-v1";

type RobotState = {
  prefs: RobotPrefs; face: string | null; hydrated: boolean; reaction: { motion: RobotMotion; message: string; at: number } | null;
  systemReduceMotion: boolean; reduceMotion: boolean;
  update: (changes: Partial<RobotPrefs>) => Promise<void>;
  setFace: (dataUri: string | null) => Promise<void>;
  react: (event: RobotEvent, message?: string) => void;
  play: (motion: RobotMotion, message?: string) => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  speaking: boolean;
};
const Context = createContext<RobotState | null>(null);
const valid = (p: Partial<RobotPrefs>): RobotPrefs => ({ ...ROBOT_DEFAULTS, ...Object.fromEntries(Object.entries(p).filter(([k]) => k in ROBOT_DEFAULTS)) } as RobotPrefs);

export function RobotProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const [prefs, setPrefs] = useState<RobotPrefs>(ROBOT_DEFAULTS);
  const [face, setFaceState] = useState<string | null>(null);
  // True once the look and face saved on the device have been read.
  const [hydrated, setHydrated] = useState(false);
  const [reaction, setReaction] = useState<RobotState["reaction"]>(null);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    AsyncStorage.multiGet([PREFS_KEY, FACE_KEY]).then(([[, saved], [, savedFace]]) => {
      if (saved) { try { setPrefs(valid(JSON.parse(saved))); } catch { /* ignore a corrupted cache */ } }
      if (savedFace && savedFace.startsWith("data:image/")) setFaceState(savedFace);
    }).catch(() => {}).finally(() => setHydrated(true));
    AccessibilityInfo.isReduceMotionEnabled().then(setSystemReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setSystemReduceMotion);
    return () => subscription.remove();
  }, []);
  // Signed-in shoppers keep their character on every device.
  useEffect(() => {
    if (!user) return;
    let active = true;
    api.get<{ preferences: { robot: RobotPrefs } }>("/me/preferences").then((r) => { if (active && r.preferences?.robot) { const next = valid(r.preferences.robot); setPrefs(next); AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {}); } }).catch(() => {});
    return () => { active = false; };
  }, [user]);
  const update = useCallback(async (changes: Partial<RobotPrefs>) => {
    const next = valid({ ...prefs, ...changes });
    setPrefs(next);
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
    if (user) await api.patch("/me/preferences", { robot: next });
  }, [prefs, user]);
  const setFace = useCallback(async (dataUri: string | null) => {
    setFaceState(dataUri);
    // Deleting the photo also deletes the still pictures of the character, which may show the face.
    if (dataUri) await AsyncStorage.setItem(FACE_KEY, dataUri); else await AsyncStorage.multiRemove([FACE_KEY, CHARACTER_SNAPSHOTS_KEY]);
  }, []);
  const play = useCallback((motion: RobotMotion, message = "") => {
    if (timer.current) clearTimeout(timer.current);
    setReaction({ motion, message, at: Date.now() });
    timer.current = setTimeout(() => setReaction(null), motion === "stop" ? 6000 : 3200);
  }, []);
  const speak = useCallback((text: string) => {
    if (!prefs.voice || !text) return;
    try {
      Speech.stop();
      setSpeaking(true);
      Speech.speak(text.replace(/[\p{Extended_Pictographic}]/gu, ""), { language: /[؀-ۿ]/.test(text) ? "ar" : "en-US", pitch: 1.35, rate: Platform.OS === "web" ? 1 : 0.95, onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
    } catch { setSpeaking(false); }
  }, [prefs.voice]);
  const stopSpeaking = useCallback(() => { try { Speech.stop(); } catch { /* nothing is playing */ } setSpeaking(false); }, []);
  const react = useCallback((event: RobotEvent, message?: string) => { const r = REACTIONS[event]; play(r.motion, message ?? r.message); }, [play]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const value = useMemo<RobotState>(() => ({ prefs, face, hydrated, reaction, systemReduceMotion, reduceMotion: prefs.reduceMotion || systemReduceMotion, update, setFace, react, play, speak, stopSpeaking, speaking }), [prefs, face, hydrated, reaction, systemReduceMotion, update, setFace, react, play, speak, stopSpeaking, speaking]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRobot() {
  const value = useContext(Context);
  if (!value) throw new Error("RobotProvider is required");
  return value;
}
