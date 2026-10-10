import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asr, mt, openRelay, SPEEDS, tts, TABLE } from "./api";
import type { ApiError, Lang, RelayMsg, RelayType } from "./api";

/* ───────────── Microphone ───────────── */
export function useRecorder() {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | undefined>(undefined);

  const start = useCallback(async (onLimit: () => void, maxMs = 10000) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    r.start();
    recRef.current = r;
    timer.current = window.setTimeout(onLimit, maxMs);
  }, []);

  const stop = useCallback(() => new Promise<Blob>(resolve => {
    const r = recRef.current;
    clearTimeout(timer.current);
    if (!r || r.state === "inactive") return resolve(new Blob(chunks.current));
    r.onstop = () => { r.stream.getTracks().forEach(t => t.stop()); resolve(new Blob(chunks.current, { type: r.mimeType })); };
    r.stop();
  }), []);

  useEffect(() => () => { clearTimeout(timer.current); recRef.current?.stream.getTracks().forEach(t => t.stop()); }, []);
  return useMemo(() => ({ start, stop }), [start, stop]);
}

/** Tap to start, tap again (or 10 s) to send to /api/asr. onText gets (transcript, lowConfidence). */
export function useListen(lang: Lang, onText: (text: string, low: boolean) => void, notify: (m: string) => void) {
  const rec = useRecorder();
  const [mic, setMic] = useState<"idle" | "listening" | "processing">("idle");
  const latest = useRef({ lang, onText, notify });
  latest.current = { lang, onText, notify };
  const busy = useRef(false);

  const finish = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setMic("processing");
    const { lang, onText, notify } = latest.current;
    try {
      const r = await asr(await rec.stop(), lang);
      onText(r.text, r.lowConfidence);
    } catch (e) {
      notify((e as ApiError).userMessage ?? "I couldn’t hear that. Try Phrases instead.");
      onText("", true);
    } finally { busy.current = false; setMic("idle"); }
  }, [rec]);

  const toggle = useCallback(async () => {
    if (mic === "listening") return finish();
    if (mic !== "idle") return;
    try { await rec.start(finish); setMic("listening"); }
    catch {
      latest.current.notify("Microphone is blocked. Use Phrases instead.");
      latest.current.onText("", true);
    }
  }, [mic, finish, rec]);

  return { mic, toggle };
}

/* ───────────── Speech output: MT → TTS, device voice as labelled fallback ───────────── */
const BCP47: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", te: "te-IN" };

export function useSpeech(lang: Lang, speedIdx: number, notify: (m: string) => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const last = useRef<{ text: string; lang: Lang } | null>(null);

  const play = useCallback(async (text: string, l: Lang = lang) => {
    last.current = { text, lang: l };
    audio.current?.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    try {
      const a = new Audio(await tts(text, l, SPEEDS[speedIdx]));
      audio.current = a;
      await a.play();
    } catch {
      if ("speechSynthesis" in window) {
        notify("Using your device’s voice (backup)");
        const u = new SpeechSynthesisUtterance(text);
        u.lang = BCP47[l]; u.rate = SPEEDS[speedIdx];
        speechSynthesis.speak(u);
      } else notify(text);
    }
  }, [lang, speedIdx, notify]);

  /** Translate an English UI string into the guest's output language, then speak it. Returns what was spoken. */
  const say = useCallback(async (english: string) => {
    let t = english;
    if (lang !== "en") { try { [t] = await mt([english], "en", lang); } catch { /* MT down: speak English */ } }
    await play(t, lang);
    return t;
  }, [lang, play]);

  const replay = useCallback(() => {
    if (last.current) return play(last.current.text, last.current.lang);
    notify("Nothing to repeat yet");
  }, [play, notify]);

  return { play, say, replay, last };
}

/* ───────────── Relay ───────────── */
export function useRelay(table: number, role: "guest" | "staff", lang: Lang, enabled = true) {
  const [msgs, setMsgs] = useState<RelayMsg[]>([]);
  const [online, setOnline] = useState(false);
  const handle = useRef<ReturnType<typeof openRelay> | null>(null);
  const add = useCallback((m: RelayMsg) => setMsgs(p => (p.some(x => x.id === m.id) ? p : [...p, m])), []);

  useEffect(() => setMsgs([]), [table]);
  useEffect(() => {
    if (!enabled) { setOnline(false); return; }
    const r = openRelay({ table, role, lang, onMessage: add, onStatus: setOnline });
    handle.current = r;
    return () => { r.close(); handle.current = null; };
  }, [table, role, lang, enabled, add]);

  const send = useCallback((type: RelayType, extra: Partial<RelayMsg> = {}) => {
    const m: RelayMsg = { id: crypto.randomUUID(), type, table, from: role, ts: Date.now(), ...extra };
    add(m);                       // optimistic; the server echo is de-duplicated by id
    handle.current?.send(m);
  }, [table, role, add]);

  return { msgs, online, send };
}

export { TABLE };
