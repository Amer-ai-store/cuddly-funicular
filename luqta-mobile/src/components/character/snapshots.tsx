import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager, Platform, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHARACTER_SNAPSHOTS_KEY } from "../../lib/characterCache";
import { useRobot } from "../../lib/robot";
import { avatarHtml, type AvatarAction, type AvatarProfile } from "./characterHtml";
import { CharacterFrame } from "./CharacterFrame";
import type { EngineMessage, FrameHandle } from "./CharacterFrame.types";

// Still pictures of the shopper's own character. Small spots (headers, chat avatars, the moment before the live 3D
// view is ready) show a picture instead of the 3D view. These pictures are drawn by the same 3D engine with the
// saved look, once per look and pose, in a hidden view that closes when it is done. They stay on this device only,
// and deleting the face photo deletes the pictures drawn with it (lib/robot.tsx removes the cache with the photo).
const CACHE_KEY = CHARACTER_SNAPSHOTS_KEY;
// Each picture is a PNG of about 30–60 KB; a look rarely needs more than a handful of poses.
const MAX_POSES = 12;
const TIMEOUT_MS = 12_000;

// Remembered for the session once the engine reports it cannot draw on this device.
let webglUnavailable = false;
export const webglMissing = () => webglUnavailable;
export const markWebglMissing = () => { webglUnavailable = true; };

// Short, stable id for a look (the profile JSON can hold a face photo of ~100 KB).
export function lookId(profileKey: string) {
  let hash = 2166136261;
  for (let i = 0; i < profileKey.length; i++) hash = Math.imul(hash ^ profileKey.charCodeAt(i), 16777619);
  return `${profileKey.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

type Shots = { look: string; withFace?: boolean; images: Partial<Record<AvatarAction, string>> };
const hasFace = (profileKey: string) => profileKey.includes('"faceDataUrl"');
type Api = { picture: (profileKey: string, action: AvatarAction) => string | undefined; request: (profileKey: string, action: AvatarAction) => void };
const NO_SHOTS: Shots = { look: "", images: {} };
const Context = createContext<Api>({ picture: () => undefined, request: () => {} });

export function useCharacterSnapshots() {
  return useContext(Context);
}

export function CharacterSnapshotProvider({ children }: { children: React.ReactNode }) {
  const robot = useRobot();
  // Once the photo is deleted, pictures and drawings that include the face are no longer used.
  const faceGone = robot.hydrated && !robot.face;
  const [stored, setShots] = useState<Shots>({ look: "", images: {} });
  const shots = faceGone && stored.withFace ? NO_SHOTS : stored;
  const [job, setJob] = useState<{ look: string; profileKey: string; actions: AvatarAction[] } | null>(null);
  const failed = useRef(new Set<string>());
  // Nothing is drawn before the saved pictures are read, so a picture kept on the device is never drawn twice.
  const [loaded, setLoaded] = useState(false);
  // On a phone the hidden 3D view starts only once the app has settled after launch: booting a WebView with the
  // 3D engine competes with the first screens for the CPU and made start-up stutter.
  const [settled, setSettled] = useState(Platform.OS === "web");
  useEffect(() => {
    if (settled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = InteractionManager.runAfterInteractions(() => { timer = setTimeout(() => setSettled(true), 3000); });
    return () => { task.cancel(); if (timer) clearTimeout(timer); };
  }, [settled]);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(CACHE_KEY).then((raw) => {
      if (!active || !raw) return;
      try {
        const saved = JSON.parse(raw) as Shots;
        if (saved && typeof saved.look === "string" && saved.images && typeof saved.images === "object") setShots((now) => (now.look ? now : saved));
      } catch { /* a damaged cache is redrawn */ }
    }).catch(() => {}).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const picture = useCallback((profileKey: string, action: AvatarAction) => {
    const image = shots.look === lookId(profileKey) ? shots.images[action] : undefined;
    return typeof image === "string" && image.startsWith("data:image/png;base64,") ? image : undefined;
  }, [shots]);

  const request = useCallback((profileKey: string, action: AvatarAction) => {
    if (!loaded || webglUnavailable) return;
    const look = lookId(profileKey);
    if (failed.current.has(`${look}:${action}`)) return;
    setJob((current) => {
      if (current && current.look === look) return current.actions.includes(action) ? current : { ...current, actions: [...current.actions, action] };
      return { look, profileKey, actions: [action] };
    });
  }, [loaded]);

  const store = useCallback((look: string, withFace: boolean, action: AvatarAction, image: string) => {
    setShots((now) => {
      const images = now.look === look ? { ...now.images } : {};
      images[action] = image;
      const kept = Object.fromEntries(Object.entries(images).slice(-MAX_POSES)) as Shots["images"];
      const next = { look, withFace, images: kept };
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const finish = useCallback((look: string, done: AvatarAction[], gaveUp: AvatarAction[]) => {
    for (const action of gaveUp) failed.current.add(`${look}:${action}`);
    setJob((current) => {
      if (!current || current.look !== look) return current;
      const left = current.actions.filter((action) => !done.includes(action) && !gaveUp.includes(action));
      return left.length ? { ...current, actions: left } : null;
    });
  }, []);

  // Poses already drawn for this look are not drawn again; with nothing left, the hidden view closes. A drawing of a
  // look with the face is dropped once the photo is deleted.
  const active = job && !(faceGone && hasFace(job.profileKey)) ? job : null;
  const pending = active ? active.actions.filter((action) => !(shots.look === active.look && shots.images[action])) : [];

  const value = useMemo(() => ({ picture, request }), [picture, request]);
  return (
    <Context.Provider value={value}>
      {children}
      {settled && active && pending.length && !webglUnavailable ? <Snapshotter key={active.look} look={active.look} profileKey={active.profileKey} actions={pending} onPicture={store} onFinish={finish} /> : null}
    </Context.Provider>
  );
}

// The hidden view: loads the engine with the look, holds it still, and asks for one picture per pose in turn.
function Snapshotter({ look, profileKey, actions, onPicture, onFinish }: {
  look: string; profileKey: string; actions: AvatarAction[];
  onPicture: (look: string, withFace: boolean, action: AvatarAction, image: string) => void;
  onFinish: (look: string, done: AvatarAction[], gaveUp: AvatarAction[]) => void;
}) {
  const frame = useRef<FrameHandle>(null);
  const [html] = useState(() => avatarHtml({ action: "idle", profile: JSON.parse(profileKey) as AvatarProfile, reduceMotion: true }));
  const ready = useRef(false);
  const asked = useRef<AvatarAction | null>(null);
  const latest = useRef(actions);
  useEffect(() => { latest.current = actions; });
  const next = useCallback(() => {
    const action = latest.current.find((a) => a !== asked.current) ?? null;
    if (!ready.current || !action) return;
    asked.current = action;
    frame.current?.send({ type: "snapshot", action, id: `${look}:${action}` });
  }, [look]);
  useEffect(() => { if (ready.current && !asked.current) next(); }, [actions, next]);
  useEffect(() => {
    // A device that never answers (a stalled WebView) is not asked again for this look in this session.
    const timer = setTimeout(() => onFinish(look, [], latest.current), TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [look, onFinish]);
  const onMessage = useCallback((message: EngineMessage) => {
    if (message.type === "ready") {
      ready.current = true;
      frame.current?.send({ type: "pause", value: true });
      next();
    } else if (message.type === "snapshot" && typeof message.dataUrl === "string" && typeof message.action === "string") {
      const action = message.action as AvatarAction;
      asked.current = null;
      onPicture(look, hasFace(profileKey), action, message.dataUrl);
      onFinish(look, [action], []);
    } else if (message.type === "error") {
      if (message.code === "NO_WEBGL" || message.code === "NO_THREE") { markWebglMissing(); onFinish(look, [], latest.current); }
      else if (message.code === "SNAPSHOT" || (message.code === "UNKNOWN_ACTION" && asked.current)) { const action = asked.current; asked.current = null; if (action) onFinish(look, [], [action]); }
    }
  }, [look, next, onFinish, onPicture, profileKey]);
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden
      style={{ position: "absolute", left: 0, bottom: 0, width: 160, height: 200, opacity: 0 }} testID="character-snapshotter">
      <CharacterFrame ref={frame} html={html} title="character-snapshot" onMessage={onMessage} style={{ width: 160, height: 200 }} />
    </View>
  );
}
