import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// Speech-to-text through the Web Speech API (Chrome, Edge, Android WebView-based browsers). Native builds use the
// keyboard's microphone instead, so `supported` is false there and screens show that hint.
type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; start: () => void; stop: () => void; abort: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const factory = () => {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export function useVoiceInput(lang: "ar" | "en") {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const current = useRef<Recognition | null>(null);
  const supported = !!factory();
  useEffect(() => () => current.current?.abort(), []);
  const start = useCallback((onText: (text: string) => void) => {
    const Speech = factory();
    if (!Speech) { setError("unsupported"); return; }
    current.current?.abort();
    const recognition = new Speech();
    recognition.lang = lang === "ar" ? "ar-JO" : "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => { const text = event.results[0]?.[0]?.transcript?.trim(); if (text) onText(text); };
    recognition.onerror = (event) => { setError(event.error || "error"); setListening(false); };
    recognition.onend = () => setListening(false);
    current.current = recognition;
    setError("");
    setListening(true);
    try { recognition.start(); } catch { setListening(false); setError("error"); }
  }, [lang]);
  const stop = useCallback(() => { current.current?.stop(); setListening(false); }, []);
  return { supported, listening, error, start, stop };
}
