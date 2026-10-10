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
  const recognitionRef = useRef<any>(null);

  const finish = useCallback(async () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    if (busy.current) return;
    busy.current = true;
    setMic("processing");
    const { lang: curLang, onText: curOnText, notify: curNotify } = latest.current;
    try {
      const audioBlob = await rec.stop();
      if (audioBlob && audioBlob.size > 0) {
        const r = await asr(audioBlob, curLang);
        if (r.text) {
          curOnText(r.text, r.lowConfidence);
        }
      }
    } catch (e) {
      curNotify((e as ApiError).userMessage ?? "I couldn’t hear that. Try Phrases or type with Keypad.");
      curOnText("", true);
    } finally {
      busy.current = false;
      setMic("idle");
    }
  }, [rec]);

  const micRef = useRef(mic);
  micRef.current = mic;

  const startListening = useCallback(async () => {
    if (micRef.current === "listening" || busy.current) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const sr = new SpeechRecognition();
        sr.lang = BCP47[latest.current.lang] || "en-IN";
        sr.continuous = false;
        sr.interimResults = false;
        sr.maxAlternatives = 1;
        sr.onstart = () => setMic("listening");
        sr.onresult = (e: any) => {
          const text = e.results?.[0]?.[0]?.transcript || "";
          if (text) {
            latest.current.onText(text, false);
          }
        };
        sr.onerror = (e: any) => {
          console.warn("SpeechRecognition error:", e?.error);
          setMic("idle");
        };
        sr.onend = () => setMic("idle");
        recognitionRef.current = sr;
        sr.start();
        return;
      } catch (err) {
        console.warn("SpeechRecognition start failed, falling back to MediaRecorder:", err);
      }
    }

    try {
      await rec.start(finish, 8000);
      setMic("listening");
    } catch {
      latest.current.notify("Microphone blocked. Use Keypad to type instead.");
      latest.current.onText("", true);
    }
  }, [finish, rec]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    if (micRef.current === "listening") {
      finish();
    }
  }, [finish]);

  const toggle = useCallback(async () => {
    if (micRef.current === "listening") return stopListening();
    if (micRef.current !== "idle") return;
    startListening();
  }, [startListening, stopListening]);

  return useMemo(() => ({ mic, toggle, startListening, stopListening }), [mic, toggle, startListening, stopListening]);
}

/* ───────────── Speech output: MT → TTS, device voice as labelled fallback ───────────── */
const BCP47: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", te: "te-IN" };

export function useSpeech(lang: Lang, speedIdx: number, notify: (m: string) => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const last = useRef<{ text: string; lang: Lang } | null>(null);
  const playSeq = useRef(0);

  const stop = useCallback(() => {
    if (audio.current) {
      audio.current.pause();
      audio.current.currentTime = 0;
      audio.current = null;
    }
    if ("speechSynthesis" in window) {
      utteranceRef.current = null;
      speechSynthesis.cancel();
    }
  }, []);

  const play = useCallback(async (text: string, l: Lang = lang, onEnd?: () => void) => {
    last.current = { text, lang: l };
    const seq = ++playSeq.current;
    stop();
    try {
      const url = await tts(text, l, SPEEDS[speedIdx]);
      if (playSeq.current !== seq) return;
      const a = new Audio(url);
      audio.current = a;
      a.onended = () => { if (playSeq.current === seq) onEnd?.(); };
      a.onerror = () => { if (playSeq.current === seq) speakDevice(text, l, onEnd); };
      await a.play();
    } catch {
      if (playSeq.current !== seq) return;
      speakDevice(text, l, onEnd);
    }
  }, [lang, speedIdx, notify, stop]);

  const speakDevice = useCallback((text: string, l: Lang, onEnd?: () => void) => {
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = BCP47[l] || "en-IN";
      u.rate = SPEEDS[speedIdx];
      const voices = speechSynthesis.getVoices();
      const matched = voices.find(v => v.lang.toLowerCase().replace("_", "-").startsWith(l));
      if (matched) u.voice = matched;
      utteranceRef.current = u;
      u.onend = () => {
        if (utteranceRef.current === u) utteranceRef.current = null;
        onEnd?.();
      };
      u.onerror = (e: any) => {
        if (utteranceRef.current === u) {
          utteranceRef.current = null;
          if (e?.error !== "canceled" && e?.error !== "interrupted") {
            onEnd?.();
          }
        }
      };
      speechSynthesis.speak(u);
    } else {
      notify(text);
      onEnd?.();
    }
  }, [speedIdx, notify]);

  const playSequence = useCallback(async (items: { text: string; lang: Lang }[], onAllEnd?: () => void) => {
    const seq = ++playSeq.current;
    stop();
    let idx = 0;

    const playNext = async () => {
      if (playSeq.current !== seq || idx >= items.length) {
        if (playSeq.current === seq) onAllEnd?.();
        return;
      }
      const item = items[idx++];
      last.current = item;
      try {
        const url = await tts(item.text, item.lang, SPEEDS[speedIdx]);
        if (playSeq.current !== seq) return;
        const a = new Audio(url);
        audio.current = a;
        a.onended = playNext;
        a.onerror = () => speakDevice(item.text, item.lang, playNext);
        await a.play();
      } catch {
        if (playSeq.current !== seq) return;
        speakDevice(item.text, item.lang, playNext);
      }
    };

    playNext();
  }, [stop, speedIdx, speakDevice]);

  /** Translate an English UI string into the guest's output language, then speak it. Returns what was spoken. */
  const say = useCallback(async (english: string, onEnd?: () => void) => {
    let t = english;
    if (lang !== "en") { try { [t] = await mt([english], "en", lang); } catch { /* MT down: speak English */ } }
    await play(t, lang, onEnd);
    return t;
  }, [lang, play]);

  const replay = useCallback(() => {
    if (last.current) return play(last.current.text, last.current.lang);
    notify("Nothing to repeat yet");
  }, [play, notify]);

  return useMemo(() => ({ play, playSequence, say, replay, stop, last }), [play, playSequence, say, replay, stop]);
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
