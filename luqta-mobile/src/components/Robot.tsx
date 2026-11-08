import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { useIsFocused } from "expo-router";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { CHARACTER_ACCESSORIES, ROBOT_DEFAULTS, RobotMotion, RobotPrefs, useRobot } from "../lib/robot";
import { posePosters } from "../lib/designAssets";
import { avatarHtml, type AvatarAccessory, type AvatarAction, type AvatarProfile } from "./character/characterHtml";
import { CharacterFrame } from "./character/CharacterFrame";
import type { EngineMessage, FrameHandle } from "./character/CharacterFrame.types";
import { markWebglMissing, useCharacterSnapshots, webglMissing } from "./character/snapshots";
import { Txt } from "./ui";

// The shopping companion is the human character from the لُقطة mockups. Large spots run the rigged 3D model
// (web-engines/avatar.js, in a WebView/iframe). Small spots and the moment before 3D is ready show a still picture
// of the shopper's own look, drawn once by the same engine (character/snapshots.tsx); until it exists, and on
// devices without WebGL, they show the mockups' pose for the motion. Components keep their historical names.
const MOTION_LABEL: Record<RobotMotion, string> = {
  idle: "يقف مبتسمًا", wave: "يلوّح لك", walk: "يمشي", jump: "يقفز", come: "يقترب منك", stop: "متوقف", dance: "يرقص", sleep: "نائم", sad: "حزين", talk: "يتحدث",
  cart: "يدفع عربة التسوق", thumbs: "يرفع إبهامه", think: "يفكّر", point: "يشير", run: "يركض", sit: "يجلس", listen: "يستمع", crossed: "يكتّف ذراعيه",
};
const POSTER: Record<RobotMotion, keyof typeof posePosters> = {
  idle: "idle", wave: "thumbs", walk: "walk", jump: "jump", come: "point", stop: "crossed", dance: "jump", sleep: "sleep", sad: "think", talk: "listen",
  cart: "cart", thumbs: "thumbs", think: "think", point: "point", run: "run", sit: "sit", listen: "listen", crossed: "crossed",
};
// Below this size the still pose reads better than a tiny 3D canvas, and it saves a WebGL context. On a phone each
// live character is a WebView running the whole 3D engine, so only the character's own screens (170 px and up) run
// it; the home, profile and chat mascots show the shopper's character as a still picture of the same look.
const MIN_3D = Platform.OS === "web" ? 88 : 150;

type Look = Pick<RobotPrefs, "color" | "skin" | "hair" | "pants" | "boots" | "beard" | "accessory" | "use3d" | "name">;
type Props = {
  size?: number; motion?: RobotMotion; message?: string; look?: Partial<Look>; face?: string | null; reduceMotion?: boolean;
  bubble?: "top" | "side" | "none"; onPress?: () => void; style?: ViewStyle; testID?: string; mode?: "auto" | "3d" | "still";
};

export function Robot({ size = 120, motion = "idle", message, look, face, reduceMotion, bubble = "side", onPress, style, testID, mode = "auto" }: Props) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const robot = useRobot();
  const focused = useIsFocused();
  const prefs = { ...robot.prefs, ...look };
  const photo = face === undefined ? robot.face : face;
  const still = reduceMotion ?? robot.reduceMotion;
  const accessory: AvatarAccessory = (CHARACTER_ACCESSORIES as readonly string[]).includes(prefs.accessory) ? (prefs.accessory as AvatarAccessory) : "none";
  const profile: AvatarProfile = { skin: prefs.skin, hair: prefs.hair, outfit: prefs.color, pants: prefs.pants, boots: prefs.boots, beard: prefs.beard, accessory, ...(photo ? { faceDataUrl: photo } : {}) };
  const profileKey = JSON.stringify(profile);
  // Hidden screens stay mounted in the navigation stack, so only the focused one keeps its 3D view (and WebGL context).
  const want3d = mode !== "still" && (mode === "3d" || size >= MIN_3D) && prefs.use3d !== false && !webglMissing() && focused;
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);
  // The page is built once; later changes reach the engine as commands, so the 3D view never reloads.
  const [html] = useState(() => avatarHtml({ action: motion, profile, reduceMotion: still }));
  const onFail = useCallback(() => { markWebglMissing(); setFailed(true); }, []);

  // The still pose breathes gently (and hops for jumps and dances) unless motion is reduced.
  const showPoster = !(want3d && live && !failed);
  // The still picture of this look and pose, drawn on demand where the picture is what stays on screen.
  const snapshots = useCharacterSnapshots();
  const picture = snapshots.picture(profileKey, motion as AvatarAction);
  const { request } = snapshots;
  // Only the focused screen asks, once the saved look is read: a preview left on a hidden screen with an unsaved look
  // would otherwise replace the saved look's pictures.
  const lookReady = robot.hydrated;
  useEffect(() => {
    if (focused && lookReady && showPoster && !want3d && !picture && prefs.use3d !== false && !webglMissing()) request(profileKey, motion as AvatarAction);
  }, [focused, lookReady, showPoster, want3d, picture, prefs.use3d, profileKey, motion, request]);
  const [bob] = useState(() => new Animated.Value(0));
  useEffect(() => {
    bob.stopAnimation();
    bob.setValue(0);
    if (!showPoster || still) return;
    const native = Platform.OS !== "web";
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: motion === "jump" || motion === "dance" ? 420 : 900, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      Animated.timing(bob, { toValue: 0, duration: motion === "jump" || motion === "dance" ? 420 : 900, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [showPoster, still, bob, motion]);
  const lift = motion === "jump" || motion === "dance" ? -size * 0.08 : -size * 0.025;
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, lift] });

  const label = `${prefs.name || ROBOT_DEFAULTS.name} ${tr(MOTION_LABEL[motion])}`;
  const lookData = { motion, mode: showPoster ? "still" : "3d", poster: picture ? "snapshot" : "design", look: [prefs.color, prefs.skin, prefs.hair, prefs.pants, prefs.boots, accessory, prefs.beard ? "beard" : "shaved", photo ? "photo" : "drawn"].join(" ").toLowerCase() };
  const bubbleView = message && bubble !== "none" ? (
    <View style={[styles.bubble, { backgroundColor: t.paper, borderColor: t.line, maxWidth: Math.max(140, size * 1.5) }]} accessibilityLiveRegion="polite">
      <Txt weight="bold" style={{ fontSize: 13, textAlign: "center" }}>{message}</Txt>
    </View>
  ) : null;
  return (
    <View style={[{ flexDirection: bubble === "top" ? "column" : "row-reverse", alignItems: "center", gap: 8 }, style]} testID={testID}>
      {bubble === "top" ? bubbleView : null}
      <Pressable accessibilityRole={onPress ? "button" : "image"} accessibilityLabel={label} onPress={onPress} disabled={!onPress} hitSlop={8}
        testID={`${testID || "robot"}-character`} {...({ dataSet: lookData } as object)} style={{ width: Math.round(size * 0.8), height: size }}>
        {want3d && !failed ? <Live3D html={html} title={label} motion={motion} profileKey={profileKey} still={still} onReady={setLive} onFail={onFail} /> : null}
        {showPoster ? <Animated.Image source={picture ? { uri: picture } : posePosters[POSTER[motion]]} resizeMode="contain" accessible={false} style={{ width: "100%", height: "100%", transform: [{ translateY }] }} /> : null}
      </Pressable>
      {bubble === "side" ? bubbleView : null}
    </View>
  );
}

// The live 3D view. It reports ready once the engine has drawn, and not-ready again when it unmounts (a hidden screen).
function Live3D({ html, title, motion, profileKey, still, onReady, onFail }: { html: string; title: string; motion: RobotMotion; profileKey: string; still: boolean; onReady: (ready: boolean) => void; onFail: () => void }) {
  const frame = useRef<FrameHandle>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ motion, profileKey, still });
  useEffect(() => { latest.current = { motion, profileKey, still }; });
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reduced motion: let the pose settle, then hold it still.
  const settle = useCallback(() => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    frame.current?.send({ type: "pause", value: false });
    if (latest.current.still) pauseTimer.current = setTimeout(() => frame.current?.send({ type: "pause", value: true }), 700);
  }, []);
  const onMessage = useCallback((message: EngineMessage) => {
    if (message.type === "ready") {
      const now = latest.current;
      frame.current?.send({ type: "profile", profile: JSON.parse(now.profileKey) });
      frame.current?.send({ type: "reduceMotion", value: now.still });
      frame.current?.send({ type: "action", action: now.motion });
      setReady(true);
      onReady(true);
      settle();
    } else if (message.type === "error" && (message.code === "NO_WEBGL" || message.code === "NO_THREE")) onFail();
  }, [onFail, onReady, settle]);
  useEffect(() => { if (ready) { frame.current?.send({ type: "action", action: motion }); settle(); } }, [motion, ready, settle]);
  // settle() also redraws a new look while reduced motion holds the pose still.
  useEffect(() => { if (ready) { frame.current?.send({ type: "profile", profile: JSON.parse(profileKey) }); settle(); } }, [profileKey, ready, settle]);
  useEffect(() => { if (ready) { frame.current?.send({ type: "reduceMotion", value: still }); settle(); } }, [still, ready, settle]);
  useEffect(() => () => { if (pauseTimer.current) clearTimeout(pauseTimer.current); onReady(false); }, [onReady]);
  return <CharacterFrame ref={frame} html={html} title={title} onMessage={onMessage} style={StyleSheet.absoluteFill} />;
}

// The companion used across the app: follows the shopper's saved motion, reacts to events and speaks when tapped.
export function Mascot({ size = 84, message, motion, bubble = "side", style, interactive = true, mode = "auto" }: { size?: number; message?: string; motion?: RobotMotion; bubble?: "top" | "side" | "none"; style?: ViewStyle; interactive?: boolean; mode?: "auto" | "3d" | "still" }) {
  const robot = useRobot();
  const { t } = useI18n();
  const reaction = robot.reaction;
  const current: RobotMotion = reaction?.motion ?? (robot.speaking ? "talk" : motion ?? (robot.prefs.motion === "walk" || robot.prefs.motion === "dance" ? "idle" : robot.prefs.motion));
  const text = reaction?.message || message;
  const greet = () => {
    const lines = ["أهلًا! أنا لُقطي 👋", "اضغط الميكروفون وقل لي شو بدك", "عندي عروض حلوة اليوم!", "جرّب «جهز لي سلة بـ ٢٠ دينار»"];
    const line = t(lines[Math.floor(Math.random() * lines.length)]);
    robot.play(["jump", "dance", "wave", "come"][Math.floor(Math.random() * 4)] as RobotMotion, line);
    robot.speak(line);
  };
  return <Robot size={size * robot.prefs.size} motion={current} message={text ? t(text) : undefined} bubble={bubble} onPress={interactive ? greet : undefined} style={style} testID="mascot" mode={mode} />;
}

const styles = StyleSheet.create({
  bubble: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, shadowColor: "#3B2A8A", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
});
