// Talk mode — a hands-free voice conversation with Ask Agent.
//
// Loop: (greet) → listen → understand → speak the answer → listen again, for
// as long as the screen is open: silence just means it keeps listening (it
// only pauses after a few quiet minutes, to save battery). A pause in speech
// sends the sentence by itself. Tap the orb to pause, to resume, or to
// interrupt the answer. Say "yes"/"oo" to confirm.
// Everything said here is also kept in the chat history.
// Captions: what you say appears live as you talk, and the assistant's reply
// lights up word by word as it's read aloud.

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../store/appStore";
import { haptic } from "../platform/haptics";
import { keepScreenOn, speak, speechInputSupported, speechOutputSupported, startListening, stopSpeaking, type ListenSession, type VoiceError } from "../platform/voice";
import { IconCheck, IconKeyboard, IconX, LogoMark } from "../ui/Icons";
import { AiOrb } from "./AiOrb";
import { personaLine, useAgent, worldSnapshot } from "./agentStore";
import { CardView } from "./AskScreen";
import { insights, statusLine } from "./engine";
import { isTaglish } from "./knowledge";
import type { AgentReply, Card } from "./types";

type Phase = "starting" | "listening" | "thinking" | "speaking" | "paused" | "error";
type Line = { id: number; who: "you" | "agent"; text: string };
const MAX_LINES = 8;
/** Stop listening after this long with nobody talking (saves battery). */
const IDLE_LIMIT_MS = 3 * 60_000;

/** The reply with the words already spoken lit up, the rest dimmed (no layout shift). */
function SpokenText({ text, fraction }: { text: string; fraction: number }) {
  const parts = text.split(/(\s+)/);
  const words = parts.filter((p) => p.trim()).length;
  const lit = fraction >= 1 ? words : Math.round(fraction * words);
  let n = 0;
  return (
    <>
      {parts.map((p, i) => {
        if (!p.trim()) return p;
        n++;
        return (
          <span key={i} className={n <= lit ? "tw said" : "tw"}>
            {p}
          </span>
        );
      })}
    </>
  );
}

const ERRORS: Record<VoiceError, string> = {
  "not-allowed": "Microphone permission is off. Allow it in your browser or app settings.",
  "no-speech": "I didn’t hear anything.",
  network: "Voice needs an internet connection on this phone. You can still type in the chat.",
  unsupported: "Voice isn’t supported in this browser. You can still type in the chat.",
  other: "Voice stopped unexpectedly.",
};

const HINTS = ["“4 pares table 4”", "“Table 4 paid gcash”", "“Cancel pares”", "“Undo table 4”", "“Isa ka pastil og softdrinks”", "“Sino may utang?”", "“Kumusta benta?”", "“Served na table 2”"];

/** What to say out loud for a reply. */
function spoken(r: AgentReply): string {
  const base = r.speak ?? r.text;
  return r.confirm ? `${base} Say yes or no.` : base;
}

export function TalkScreen() {
  const [phase, setPhaseState] = useState<Phase>("starting");
  const phaseRef = useRef<Phase>("starting");
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const [heard, setHeard] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [spokenFraction, setSpokenFraction] = useState(1);
  const nextLine = useRef(1);
  const captionsRef = useRef<HTMLDivElement>(null);
  const addLine = (who: Line["who"], text: string) => {
    const id = nextLine.current++;
    setLines((ls) => [...ls, { id, who, text }].slice(-MAX_LINES));
  };
  const [card, setCard] = useState<Card | undefined>();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(0);
  const session = useRef<ListenSession | null>(null);
  const alive = useRef(true);
  const failures = useRef(0);
  const lastHeardAt = useRef(Date.now());
  const tagalog = useRef(false);
  // Live values for the orb (read every animation frame, no re-render).
  const level = useRef(0);
  const pulse = useRef(0);
  const canListen = speechInputSupported();
  const canSpeak = speechOutputSupported();

  const listen = useCallback(() => {
    if (!alive.current) return;
    stopSpeaking();
    session.current?.abort();
    setError(null);
    setHeard("");
    setPhase("listening");
    let gotFinal = false;
    let lastError: VoiceError | null = null;
    const again = (ms: number) => setTimeout(() => alive.current && phaseRef.current === "listening" && listen(), ms);
    const s = startListening({
      onLevel: (v) => (level.current = v),
      onPartial: (t) => {
        setHeard(t);
        lastHeardAt.current = Date.now();
      },
      onFinal: (t) => {
        gotFinal = true;
        failures.current = 0;
        lastHeardAt.current = Date.now();
        handle(t);
      },
      onError: (e) => {
        lastError = e;
      },
      onEnd: () => {
        session.current = null;
        level.current = 0;
        if (!alive.current || gotFinal || phaseRef.current !== "listening") return;
        if (lastError === "not-allowed" || lastError === "unsupported") {
          setError(ERRORS[lastError]);
          setPhase("error");
          return;
        }
        if (lastError === "network" || lastError === "other") {
          // The recognizer can be briefly busy (e.g. right after speaking): retry, then give up politely.
          failures.current++;
          if (failures.current >= (lastError === "network" ? 3 : 6)) {
            setError(ERRORS[lastError]);
            setPhase("paused");
            return;
          }
          again(lastError === "network" ? 1500 : 300 * failures.current);
          return;
        }
        // Silence: keep listening — it's a conversation — but rest after a few quiet minutes.
        if (Date.now() - lastHeardAt.current > IDLE_LIMIT_MS) {
          setPhase("paused");
          return;
        }
        again(120);
      },
    });
    session.current = s;
    if (!s) setPhase("error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = useCallback(
    (text: string, then: "listen" | "pause" = "listen") => {
      if (!alive.current) return;
      setPhase("speaking");
      setSpokenFraction(0);
      let lastF = 0;
      const next = () => {
        if (!alive.current || phaseRef.current !== "speaking") return;
        setSpokenFraction(1);
        lastHeardAt.current = Date.now();
        // A short gap so the microphone doesn't catch the end of the voice.
        if (then === "listen" && canListen) setTimeout(() => alive.current && phaseRef.current === "speaking" && listen(), 250);
        else setPhase("paused");
      };
      const onProgress = (f: number) => {
        if (!alive.current) return;
        if (f > lastF + 0.001) pulse.current = 1; // each new word: a pulse on the orb
        lastF = f;
        setSpokenFraction(f);
      };
      if (canSpeak) speak(text, next, { tagalog: tagalog.current, onProgress });
      else setTimeout(next, 900);
    },
    [canListen, canSpeak, listen],
  );

  const show = (r: AgentReply) => {
    addLine("agent", r.text);
    setCard(r.card);
    const last = [...useAgent.getState().messages].reverse().find((m) => m.role === "agent");
    setPendingId(last?.confirm?.state === "pending" ? last.id : null);
    if (r.tone === "warn" || r.tone === "error") haptic.warning();
    else if (r.execute) haptic.success();
  };

  const handle = (text: string) => {
    if (!alive.current) return;
    addLine("you", text);
    setHeard("");
    setPhase("thinking");
    tagalog.current = isTaglish(text);
    const before = useApp.getState().stack.length;
    const r = useAgent.getState().send(text, "voice");
    show(r);
    // The reply opened another screen (e.g. "open table 3"): Talk mode ends there.
    if (useApp.getState().stack.length !== before && !useApp.getState().stack.some((x) => x.name === "talk")) return;
    say(spoken(r));
  };

  const answerConfirm = (yes: boolean) => {
    if (pendingId === null) return;
    haptic.tap();
    const agent = useAgent.getState();
    const r = yes ? agent.confirm(pendingId) : agent.cancel(pendingId);
    if (!r) return;
    show(r);
    say(spoken(r));
  };

  // Greet with a short status, then start listening.
  useEffect(() => {
    alive.current = true;
    let release: (() => void) | null = null;
    void keepScreenOn().then((r) => {
      if (alive.current) release = r;
      else r();
    });
    const world = worldSnapshot();
    tagalog.current = isTaglish(useAgent.getState().messages.filter((m) => m.role === "user").slice(-1)[0]?.text ?? "");
    const tip = insights(world)[0];
    const hello = tagalog.current ? "Nakikinig ako." : "I’m listening.";
    const plain = `${statusLine(world, tagalog.current)}${tip ? ` ${tip.text}` : ""} ${hello}`;
    // A natural, varied hello (same facts as the plain status line).
    const greeting = personaLine({ kind: "chat", topic: "greet", tl: tagalog.current, bisaya: false }, plain).replace(/\s*(Ready for orders\.|What’s first\?|Let’s get some orders in!|Handa na ako\.|Ano’ng una\?|Tara, kuha na tayo ng order!)$/, "") + `${tip ? ` ${tip.text}` : ""} ${hello}`;
    setLines([{ id: nextLine.current++, who: "agent", text: greeting }]);
    if (!canListen) {
      setError(ERRORS.unsupported);
      setPhase("error");
    } else say(greeting);
    const hints = setInterval(() => setHint((h) => (h + 1) % HINTS.length), 4000);
    return () => {
      alive.current = false;
      clearInterval(hints);
      session.current?.abort();
      stopSpeaking();
      release?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the newest caption in view.
  useEffect(() => {
    const el = captionsRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lines, heard, card, pendingId, error]);

  const tapOrb = () => {
    haptic.tap();
    if (phase === "speaking") {
      // Interrupt the answer and listen.
      stopSpeaking();
      setSpokenFraction(1);
      listen();
    } else if (phase === "listening") {
      // Pause the conversation.
      session.current?.abort();
      session.current = null;
      level.current = 0;
      setHeard("");
      setPhase("paused");
    } else if (phase !== "thinking" && canListen) {
      failures.current = 0;
      lastHeardAt.current = Date.now();
      listen();
    }
  };

  const label =
    phase === "listening" ? (heard ? (tagalog.current ? "Naririnig kita…" : "Hearing you…") : tagalog.current ? "Nakikinig…" : "Listening…") :
    phase === "thinking" ? "Thinking…" :
    phase === "speaking" ? "Speaking · tap to interrupt" :
    phase === "starting" ? "Starting…" :
    phase === "error" ? "Voice unavailable" :
    "Paused · tap the orb to talk";

  const { back, openAsk } = useApp.getState();
  return (
    <div className={`talk phase-${phase}`}>
      <header className="talk-top">
        <button className="icon-btn" aria-label="End Talk mode" onClick={() => back()}>
          <IconX />
        </button>
        <span className="talk-title">
          <LogoMark size={22} /> Talk mode
        </span>
        <button
          className="icon-btn"
          aria-label="Type instead"
          onClick={() => {
            back();
            openAsk();
          }}
        >
          <IconKeyboard />
        </button>
      </header>

      <main className="talk-body">
        <div className="talk-stage">
          <button className="talk-orb" onClick={tapOrb} aria-label={label}>
            <AiOrb state={phase} level={level} pulse={pulse} size={orbSize()} />
          </button>
          <div className="talk-label" aria-live="polite">
            {label}
          </div>
        </div>

        <div className="talk-captions" ref={captionsRef} aria-live="polite">
          {lines.map((l, i) => {
            const latest = i === lines.length - 1;
            return (
              <p key={l.id} className={`tcap tcap-${l.who}${latest ? " latest" : ""}`}>
                {l.who === "agent" && latest && phase === "speaking" ? <SpokenText text={l.text} fraction={spokenFraction} /> : l.text}
              </p>
            );
          })}
          {phase === "listening" && heard && (
            <p className="tcap tcap-you live">
              {heard}
              <span className="caret" aria-hidden />
            </p>
          )}
          {card && (
            <div className="talk-card">
              <CardView card={card} />
            </div>
          )}
          {pendingId !== null && (
            <div className="talk-confirm">
              <button className="btn btn-primary" onClick={() => answerConfirm(true)}>
                <IconCheck /> Yes
              </button>
              <button className="btn btn-secondary" onClick={() => answerConfirm(false)}>
                No
              </button>
            </div>
          )}
          {error && <p className="talk-error">{error}</p>}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={hint} className="talk-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Try {HINTS[hint]}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

/** Orb size for this screen: big, but leaves room for the captions. */
function orbSize(): number {
  if (typeof window === "undefined") return 240;
  return Math.round(Math.max(170, Math.min(280, window.innerWidth * 0.66, window.innerHeight * 0.32)));
}
