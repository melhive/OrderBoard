// Talk mode — a hands-free voice conversation with Ask Agent.
//
// Loop: (greet) → listen → understand → speak the answer → listen again.
// Tap the orb to interrupt or to start listening; say "yes"/"oo" to confirm.
// Everything said here is also kept in the chat history.

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
  const [answer, setAnswer] = useState("");
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
      const next = () => {
        if (!alive.current) return;
        if (then === "listen" && canListen) listen();
        else setPhase("paused");
      };
      if (canSpeak) speak(text, next, { tagalog: tagalog.current });
      else setTimeout(next, 900);
    },
    [canListen, canSpeak, listen],
  );

  const show = (r: AgentReply) => {
    setAnswer(r.text);
    setCard(r.card);
    const last = [...useAgent.getState().messages].reverse().find((m) => m.role === "agent");
    setPendingId(last?.confirm?.state === "pending" ? last.id : null);
    if (r.tone === "warn" || r.tone === "error") haptic.warning();
  };

  const handle = (text: string) => {
    if (!alive.current) return;
    setHeard(text);
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
    setAnswer(greeting);
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
        <div className="talk-captions" aria-live="polite">
          <AnimatePresence mode="popLayout">
            {heard && (
              <motion.p key={`h-${heard.length > 0}`} className="talk-heard" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                “{heard}”
              </motion.p>
            )}
          </AnimatePresence>
          <motion.p key={answer} className="talk-answer" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            {answer}
          </motion.p>
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
          <button className="talk-orb" onClick={tapOrb} aria-label={label}>
            {(phase === "listening" || phase === "speaking") &&
              [0, 1, 2].map((i) => (
                <motion.span
                  key={`${phase}-${i}`}
                  className="talk-ring"
                  initial={{ scale: 1, opacity: 0.35 }}
                  animate={{ scale: phase === "listening" ? 1.45 : 1.3, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: phase === "listening" ? 1.8 : 1.2, delay: i * 0.5, ease: "easeOut" }}
                />
              ))}
            <motion.span
              className="talk-core"
              animate={
                phase === "speaking" ? { scale: [1, 1.08, 0.97, 1.05, 1] } :
                phase === "thinking" ? { rotate: 360 } :
                phase === "listening" ? { scale: [1, 1.04, 1] } :
                { scale: 1 }
              }
              transition={phase === "thinking" ? { repeat: Infinity, duration: 1.2, ease: "linear" } : { repeat: phase === "paused" || phase === "error" ? 0 : Infinity, duration: phase === "speaking" ? 0.9 : 1.6 }}
            >
              {phase === "thinking" ? <span className="talk-spinner" /> : <IconMic />}
            </motion.span>
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
