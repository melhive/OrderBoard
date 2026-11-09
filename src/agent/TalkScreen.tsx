// Talk mode — a hands-free voice conversation with Ask Agent.
//
// Loop: (greet) → listen → understand → speak the answer → listen again.
// Tap the orb to interrupt or to start listening; say "yes"/"oo" to confirm.
// Everything said here is also kept in the chat history.
// Captions: what you say appears live as you talk, and the assistant's reply
// lights up word by word as it's read aloud.

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../store/appStore";
import { haptic } from "../platform/haptics";
import { keepScreenOn, speak, speechInputSupported, speechOutputSupported, startListening, stopSpeaking, type ListenSession, type VoiceError } from "../platform/voice";
import { IconCheck, IconKeyboard, IconMic, IconX, LogoMark } from "../ui/Icons";
import { useAgent, worldSnapshot } from "./agentStore";
import { CardView } from "./AskScreen";
import { insights, statusLine } from "./engine";
import { isTaglish } from "./knowledge";
import type { AgentReply, Card } from "./types";

type Phase = "starting" | "listening" | "thinking" | "speaking" | "paused" | "error";
type Line = { id: number; who: "you" | "agent"; text: string };
const MAX_LINES = 8;

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

const HINTS = ["“2 pares with egg for table 3”", "“Table 1 paid 500”", "“Sino may utang?”", "“Kumusta benta?”", "“Any tips?”", "“Served na table 2”"];

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
  const quietTries = useRef(0);
  const tagalog = useRef(false);
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
    const s = startListening({
      onPartial: (t) => setHeard(t),
      onFinal: (t) => {
        gotFinal = true;
        quietTries.current = 0;
        handle(t);
      },
      onError: (e) => {
        if (!alive.current) return;
        if (e === "no-speech") return; // handled in onEnd
        setError(ERRORS[e]);
        setPhase("error");
      },
      onEnd: () => {
        session.current = null;
        if (!alive.current || gotFinal) return;
        if (phaseRef.current !== "listening") return;
        // Nothing heard: try again quietly a couple of times, then wait for a tap.
        if (quietTries.current < 2) {
          quietTries.current++;
          setTimeout(() => alive.current && phaseRef.current === "listening" && listen(), 250);
          return;
        }
        quietTries.current = 0;
        setPhase("paused");
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
      const next = () => {
        if (!alive.current) return;
        setSpokenFraction(1);
        if (then === "listen" && canListen) listen();
        else setPhase("paused");
      };
      if (canSpeak) speak(text, next, { tagalog: tagalog.current, onProgress: (f) => alive.current && setSpokenFraction(f) });
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
    const greeting = `${statusLine(world, tagalog.current)}${tip ? ` ${tip.text}` : ""} ${hello}`;
    setLines([{ id: nextLine.current++, who: "agent", text: greeting }]);
    if (!canListen) {
      setError(ERRORS.unsupported);
      setPhase("error");
    } else say(greeting);
    const hints = setInterval(() => setHint((h) => (h + 1) % HINTS.length), 3500);
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
      stopSpeaking();
      listen();
    } else if (phase === "listening") {
      session.current?.stop();
    } else if (phase !== "thinking") {
      quietTries.current = 0;
      listen();
    }
  };

  const label =
    phase === "listening" ? (tagalog.current ? "Nakikinig…" : "Listening…") :
    phase === "thinking" ? "Thinking…" :
    phase === "speaking" ? "Speaking — tap to interrupt" :
    phase === "starting" ? "Starting…" :
    phase === "error" ? "Voice unavailable" :
    "Tap to talk";

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
        <div className="talk-captions" ref={captionsRef} aria-live="polite">
          {lines.map((l, i) => {
            const latest = i === lines.length - 1;
            return (
              <p key={l.id} className={`tcap tcap-${l.who}${latest ? " latest" : ""}`}>
                {l.who === "agent" && latest && phase === "speaking" ? <SpokenText text={l.text} fraction={spokenFraction} /> : l.text}
              </p>
            );
          })}
          {phase === "listening" && (
            <p className={`tcap tcap-you live${heard ? "" : " waiting"}`}>
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

        <div className="talk-orb-wrap">
          {/* Pure CSS animations (transform/opacity only): they run on the
              phone's compositor, so they stay smooth while speech is busy,
              and nothing is re-created when the phase changes — layers just
              fade in and out. */}
          <button className="talk-orb" onClick={tapOrb} aria-label={label}>
            <span className="talk-rings" aria-hidden>
              <span className="talk-ring" />
              <span className="talk-ring" />
              <span className="talk-ring" />
            </span>
            <span className="talk-glow" aria-hidden />
            <span className="talk-core">
              <span className="talk-icon talk-icon-mic">
                <IconMic />
              </span>
              <span className="talk-icon talk-icon-wait">
                <span className="talk-spinner" />
              </span>
            </span>
          </button>
          <div className="talk-label">{label}</div>
          <AnimatePresence mode="wait">
            <motion.div key={hint} className="talk-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Try {HINTS[hint]}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
