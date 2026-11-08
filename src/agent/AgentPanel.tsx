import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { currentRoute, useApp } from "../store/appStore";
import { peso } from "../lib/format";
import { tableDisplayName } from "../lib/bill";
import { haptic } from "../platform/haptics";
import { speak, speechInputSupported, startListening, stopSpeaking, type ListenSession, type VoiceError } from "../platform/voice";
import { IconCheck, IconMic, IconSend, IconSparkle, IconTrash, IconUndo, IconX } from "../ui/Icons";
import { useAgent, type ChatMessage } from "./agentStore";
import type { AgentReply, Card } from "./types";

const STARTERS = ["2 pares with egg for table 1", "Which tables are open?", "How much did we sell today?", "What can you do?"];

const VOICE_ERRORS: Record<VoiceError, string> = {
  "not-allowed": "Microphone permission was denied. Allow it in your browser or app settings to use voice.",
  "no-speech": "I didn’t hear anything. Tap the mic and try again.",
  network: "Voice recognition needs an internet connection on this device. You can still type.",
  unsupported: "Voice input isn’t supported here. You can still type your order.",
  other: "Voice input stopped unexpectedly. Try again or type instead.",
};

function CardView({ card }: { card: Card }) {
  if (card.kind === "bill") {
    const hl = new Set(card.highlight ?? []);
    return (
      <div className="acard">
        <div className="acard-title">{card.title}</div>
        {card.lines.map((l) => (
          <div key={l.name} className={`acard-row${hl.has(l.name) ? " hl" : ""}`}>
            <span className="lbl">
              {l.qty}× {l.name}
            </span>
            <span>{peso(l.price * l.qty)}</span>
          </div>
        ))}
        <div className="acard-total">
          <span>Total</span>
          <span>{peso(card.total)}</span>
        </div>
        {card.note && <div className="acard-note">{card.note}</div>}
      </div>
    );
  }
  if (card.kind === "stats") {
    return (
      <div className="acard">
        <div className="acard-title">{card.title}</div>
        <div className="acard-stats">
          {card.stats.map((s) => (
            <div key={s.label}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        {card.rows?.map((r) => (
          <div key={r.label} className="acard-row">
            <span className="lbl">{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="acard">
      <div className="acard-title">{card.title}</div>
      {card.rows.map((r, i) => (
        <div key={i} className="acard-row">
          <span className="lbl">
            {r.label}
            {r.sub && <small>{r.sub}</small>}
          </span>
          {r.value && <span>{r.value}</span>}
        </div>
      ))}
    </div>
  );
}

function Message({ m, onReply }: { m: ChatMessage; onReply: (r: AgentReply | null) => void }) {
  const agent = useAgent.getState();
  if (m.role === "user") {
    return (
      <motion.div className="msg user" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.18 }}>
        {m.via === "voice" && (
          <div className="via">
            <IconMic /> Voice
          </div>
        )}
        {m.text}
      </motion.div>
    );
  }
  return (
    <motion.div className={`msg agent ${m.tone ?? ""}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.04 }}>
      <div className="bubble">
        {m.text}
        {m.card && <CardView card={m.card} />}
      </div>
      {m.confirm?.state === "pending" && (
        <div className="msg-actions">
          <button className="btn btn-primary" onClick={() => onReply(agent.confirm(m.id))}>
            <IconCheck /> {m.confirm.yes}
          </button>
          <button className="btn btn-shell" onClick={() => onReply(agent.cancel(m.id))}>
            Cancel
          </button>
        </div>
      )}
      {m.confirm && m.confirm.state !== "pending" && (
        <div className="msg-state">{m.confirm.state === "done" ? <><IconCheck /> Confirmed</> : m.confirm.state === "cancelled" ? "Cancelled" : "Expired"}</div>
      )}
      {m.undo === "available" && (
        <div className="msg-actions">
          <button className="btn btn-shell" onClick={() => agent.undo(m.id)}>
            <IconUndo /> Undo
          </button>
        </div>
      )}
    </motion.div>
  );
}

export function AgentPanel() {
  const open = useApp((s) => s.agentOpen);
  const setOpen = useApp((s) => s.setAgentOpen);
  const messages = useAgent((s) => s.messages);
  const routeTable = useApp((s) => {
    const r = currentRoute(s);
    return r.name === "order" ? tableDisplayName(s.data.tableList, r.tableId) : null;
  });
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const session = useRef<ListenSession | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canVoice = speechInputSupported();

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, open]);

  // Stop the mic and any speech when the panel closes.
  useEffect(() => {
    if (open) return;
    session.current?.abort();
    session.current = null;
    setListening(false);
    stopSpeaking();
  }, [open]);

  const last = [...messages].reverse().find((m) => m.role === "agent");
  const suggestions = messages.length === 0 ? STARTERS : last?.suggestions ?? [];

  const afterReply = (reply: AgentReply | null, via: "voice" | "text") => {
    if (!reply) return;
    if (reply.tone === "error" || reply.tone === "warn") haptic.warning();
    const settings = useApp.getState().data.settings.agent;
    if (via !== "voice" || !settings.voiceReplies) return;
    speak(reply.speak ?? reply.text, () => {
      // Hands-free: keep the conversation going while the panel is open.
      if (settings.handsFree && useApp.getState().agentOpen) listen();
    });
  };

  const submit = (value: string, via: "voice" | "text" = "text") => {
    const v = value.trim();
    if (!v) return;
    setText("");
    setVoiceError(null);
    afterReply(useAgent.getState().send(v, via), via);
  };

  const listen = () => {
    if (session.current) {
      session.current.stop();
      return;
    }
    stopSpeaking();
    setVoiceError(null);
    haptic.tap();
    const s = startListening({
      onPartial: (t) => setText(t),
      onFinal: (t) => submit(t, "voice"),
      onError: (e) => setVoiceError(VOICE_ERRORS[e]),
      onEnd: () => {
        session.current = null;
        setListening(false);
      },
    });
    session.current = s;
    setListening(!!s);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(text);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="agent-bg" className="agent-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.section
            key="agent"
            className="agent"
            role="dialog"
            aria-modal="true"
            aria-label="Ask Agent"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            onAnimationComplete={() => !canVoice && inputRef.current?.focus()}
          >
            <header className="agent-head">
              <div className="title">
                <b>Ask Agent</b>
                <span>{routeTable ? `On ${routeTable} · works offline` : "Orders, bills and sales · works offline"}</span>
              </div>
              {messages.length > 0 && (
                <button className="icon-btn" aria-label="Clear conversation" onClick={() => useAgent.getState().reset()}>
                  <IconTrash />
                </button>
              )}
              <button className="icon-btn" aria-label="Close Ask Agent" onClick={() => setOpen(false)}>
                <IconX />
              </button>
            </header>

            <div className="agent-log" ref={logRef} aria-live="polite">
              {messages.length === 0 ? (
                <div className="agent-empty">
                  <div className="glyph">
                    <IconSparkle />
                  </div>
                  <b>Type or say an order</b>
                  <p>“Pares with egg and rice, table 3” — I’ll add it to the bill. Ask about sales, open tables or prices too.</p>
                </div>
              ) : (
                messages.map((m) => <Message key={m.id} m={m} onReply={(r) => afterReply(r, "text")} />)
              )}
            </div>

            {voiceError && <div className="listening-line">{voiceError}</div>}
            {listening && (
              <div className="listening-line">
                <motion.span className="dot" animate={{ opacity: [1, 0.25, 1] }} transition={{ repeat: Infinity, duration: 1 }} /> Listening… tap the mic to stop
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="suggestions">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => submit(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="agent-input">
              <textarea
                ref={inputRef}
                rows={1}
                value={text}
                placeholder={listening ? "Listening…" : "Type an order or question"}
                aria-label="Message Ask Agent"
                enterKeyHint="send"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
              />
              {canVoice && (
                <button className={`round-btn mic${listening ? " live" : ""}`} aria-label={listening ? "Stop listening" : "Speak"} aria-pressed={listening} onClick={listen}>
                  {listening && <motion.span className="mic-ring" initial={{ scale: 1, opacity: 0.5 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ repeat: Infinity, duration: 1.2 }} />}
                  <IconMic />
                </button>
              )}
              <button className="round-btn send" aria-label="Send" disabled={!text.trim()} onClick={() => submit(text)}>
                <IconSend />
              </button>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}

export function AgentFab() {
  const route = useApp((s) => currentRoute(s).name);
  const hidden = useApp((s) => s.agentOpen || s.sheetOpen || !!s.dialog);
  const setOpen = useApp((s) => s.setAgentOpen);
  if (route !== "tables" && route !== "summary" && route !== "order") return null;
  return (
    <AnimatePresence>
      {!hidden && (
        <motion.button
          key="fab"
          className={`fab${route === "order" ? " on-order" : ""}`}
          aria-label="Ask Agent"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          onClick={() => {
            haptic.tap();
            setOpen(true);
          }}
        >
          <IconSparkle /> Ask
        </motion.button>
      )}
    </AnimatePresence>
  );
}
