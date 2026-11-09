// Ask Agent — full-screen chat.
//
// Layout: header / scrolling log / footer (suggestions + composer). The log
// is the only scrolling element (flex: 1; min-height: 0), so history scrolls
// while the header and composer stay put — including when the keyboard opens.

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useApp } from "../store/appStore";
import { tableDisplayName } from "../lib/bill";
import { fmtDayLabel, fmtTime, peso } from "../lib/format";
import { haptic } from "../platform/haptics";
import { speak, speechInputSupported, startListening, stopSpeaking, type ListenSession, type VoiceError } from "../platform/voice";
import { BackButton } from "../ui/components";
import { IconArrowDown, IconArrowUp, IconBulb, IconCash, IconChart, IconCheck, IconChevron, IconInfo, IconMic, IconReceipt, IconSparkle, IconStop, IconTrash, IconUndo, IconWave, IconX, LogoMark } from "../ui/Icons";
import { useAgent, worldSnapshot, type ChatMessage } from "./agentStore";
import { insights } from "./engine";
import { executePlan } from "./executor";
import { isTaglish } from "./knowledge";
import type { AgentReply, Card } from "./types";

const VOICE_ERRORS: Record<VoiceError, string> = {
  "not-allowed": "Microphone permission is off. Allow it in your browser or app settings to use voice.",
  "no-speech": "I didn’t hear anything. Tap the mic and try again.",
  network: "Voice needs an internet connection on this phone. Typing works offline.",
  unsupported: "Voice input isn’t supported here. You can still type.",
  other: "Voice input stopped unexpectedly. Try again or type instead.",
};

const GROUP_GAP_MS = 2 * 60 * 1000;
const SEPARATOR_GAP_MS = 15 * 60 * 1000;

function separatorLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = same(d, today) ? "Today" : same(d, yesterday) ? "Yesterday" : fmtDayLabel(d);
  return `${day} · ${fmtTime(d.toISOString())}`;
}

/** The order table the chat was opened from, if any. */
function useContextTable(): { id: number; name: string } | null {
  const id = useApp((s) => {
    const below = [...s.stack].reverse().find((r) => r.name !== "ask");
    return below?.name === "order" ? below.tableId : null;
  });
  const name = useApp((s) => (id === null ? "" : tableDisplayName(s.data.tableList, id)));
  return id === null ? null : { id, name };
}

// ---------- cards ----------

export function CardView({ card }: { card: Card }) {
  const openTable = useApp((s) => s.openTable);
  if (card.kind === "bill") {
    const hl = new Set(card.highlight ?? []);
    const tableExists = useApp.getState().data.tableList.some((t) => t.id === card.tableId);
    return (
      <div className="acard">
        <div className="acard-head">
          <span className="acard-title">{card.title}</span>
          {card.tableId !== undefined && tableExists && (
            <button className="btn btn-secondary btn-small" onClick={() => openTable(card.tableId!)}>
              Open
            </button>
          )}
        </div>
        <div className="acard-body">
          {card.lines.length === 0 && <div className="acard-row"><span className="lbl" style={{ color: "var(--text-3)" }}>No items</span></div>}
          {card.lines.map((l) => (
            <div key={`${l.name}|${l.price}`} className={`acard-row${hl.has(l.name) ? " hl" : ""}`}>
              <span className="lbl">
                {l.qty}× {l.name}
                {l.note && <small>{l.note}</small>}
              </span>
              <span className="val">{peso(l.price * l.qty)}</span>
            </div>
          ))}
        </div>
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
        <div className="acard-head">
          <span className="acard-title">{card.title}</span>
        </div>
        <div className="acard-stats">
          {card.stats.map((s) => (
            <div key={s.label}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        {card.rows && card.rows.length > 0 && (
          <div className="acard-body">
            {card.rows.map((r) => (
              <div key={r.label} className="acard-row">
                <span className="lbl">{r.label}</span>
                <span className="val">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="acard">
      <div className="acard-head">
        <span className="acard-title">{card.title}</span>
      </div>
      <div className="acard-body">
        {card.rows.map((r, i) => (
          <div key={i} className="acard-row">
            <span className="lbl">
              {r.label}
              {r.sub && <small>{r.sub}</small>}
            </span>
            {r.value && <span className="val">{r.value}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- messages ----------

interface MessageProps {
  m: ChatMessage;
  first: boolean;
  last: boolean;
  animate: boolean;
  onReply: (r: AgentReply | null) => void;
}

function Message({ m, first, last, animate: animateProp, onReply }: MessageProps) {
  const agent = useAgent.getState();
  // Decided once on mount: re-renders must not cancel a running entrance.
  const [animate] = useState(animateProp);
  const motionProps = animate ? { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.22, delay: m.role === "agent" ? 0.08 : 0 } } : {};
  const cls = `mrow ${m.role}${first ? " first" : " cont"}${m.tone && m.tone !== "normal" ? ` ${m.tone}` : ""}${m.card ? " has-card" : ""}`;
  if (m.role === "user") {
    return (
      <motion.div className={cls} {...motionProps}>
        <div className="mcol">
          <div className="bubble">
            {m.via === "voice" && (
              <span className="via">
                <IconMic /> Voice
              </span>
            )}
            {m.text}
          </div>
          {last && <div className="mtime">{fmtTime(new Date(m.ts).toISOString())}</div>}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div className={cls} {...motionProps}>
      <div className="av">{last && <LogoMark size={28} />}</div>
      <div className="mcol">
        <div className="bubble">{m.text}</div>
        {m.card && <CardView card={m.card} />}
        {m.confirm?.state === "pending" && (
          <div className="mactions">
            <button className="btn btn-primary btn-small" style={{ minHeight: 42, padding: "0 16px" }} onClick={() => onReply(agent.confirm(m.id))}>
              <IconCheck /> {m.confirm.yes}
            </button>
            <button className="btn btn-secondary btn-small" style={{ minHeight: 42, padding: "0 16px" }} onClick={() => onReply(agent.cancel(m.id))}>
              Cancel
            </button>
          </div>
        )}
        {m.confirm && m.confirm.state !== "pending" && (
          <div className={`mstate${m.confirm.state === "done" ? " done" : ""}`}>
            {m.confirm.state === "done" ? (
              <>
                <IconCheck /> Confirmed
              </>
            ) : m.confirm.state === "cancelled" ? (
              "Cancelled"
            ) : (
              "No longer active"
            )}
          </div>
        )}
        {m.undo === "available" && (
          <div className="mactions">
            <button className="btn btn-secondary btn-small" onClick={() => agent.undo(m.id)}>
              <IconUndo /> Undo
            </button>
          </div>
        )}
        {m.undo === "used" && <div className="mstate">Undone</div>}
        {m.link && (
          <div className="mactions">
            <button className="btn btn-secondary btn-small" onClick={() => executePlan({ kind: "navigate", route: m.link!.route })}>
              {m.link.label} <IconChevron />
            </button>
          </div>
        )}
        {last && <div className="mtime">{fmtTime(new Date(m.ts).toISOString())}</div>}
      </div>
    </motion.div>
  );
}

// ---------- screen ----------

export function AskScreen() {
  const messages = useAgent((s) => s.messages);
  const ctxTable = useContextTable();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const session = useRef<ListenSession | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seenIds = useRef<Set<number>>(new Set(messages.map((m) => m.id)));
  const canVoice = speechInputSupported();

  // Start at the newest message.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Follow new messages when the user is at the bottom or just sent one.
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = logRef.current;
    if (!el || lastId === undefined) return;
    const lastMsg = messages[messages.length - 1]!;
    const prevMsg = messages[messages.length - 2];
    if (atBottom || lastMsg.role === "user" || prevMsg?.role === "user") {
      requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  useEffect(() => {
    for (const m of messages) seenIds.current.add(m.id);
  });

  // Stop the mic and any speech when leaving the chat.
  useEffect(
    () => () => {
      session.current?.abort();
      stopSpeaking();
    },
    [],
  );

  const autoSize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };
  useEffect(autoSize, [text]);

  const lastUserText = useRef("");
  const afterReply = (reply: AgentReply | null, via: "voice" | "text") => {
    if (!reply) return;
    if (reply.tone === "error" || reply.tone === "warn") haptic.warning();
    const settings = useApp.getState().data.settings.agent;
    if (via !== "voice" || !settings.voiceReplies) return;
    speak(reply.speak ?? reply.text, () => {
      // Hands-free: keep the conversation going while the chat is open.
      if (settings.handsFree && document.querySelector(".chat")) listen();
    }, { tagalog: isTaglish(lastUserText.current) });
  };

  const submit = (value: string, via: "voice" | "text" = "text") => {
    const v = value.trim();
    if (!v) return;
    setText("");
    setPartial("");
    setVoiceError(null);
    haptic.tap();
    lastUserText.current = v;
    afterReply(useAgent.getState().send(v, via), via);
  };

  const listen = () => {
    if (session.current) {
      session.current.stop();
      return;
    }
    stopSpeaking();
    setVoiceError(null);
    setPartial("");
    haptic.tap();
    const s = startListening({
      onPartial: (t) => setPartial(t),
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
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(text);
    }
  };

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const t = ctxTable?.name;
  // A tip worth surfacing right now (long waits, sold out, old utang…), dismissible.
  const [hiddenTip, setHiddenTip] = useState<string | null>(null);
  const dataVersion = useApp((s) => s.data);
  const tip = useMemo(() => insights(worldSnapshot()).find((x) => x.text !== hiddenTip) ?? null, [dataVersion, hiddenTip, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = [...messages].reverse().find((m) => m.role === "agent");
  const suggestions =
    messages.length === 0
      ? []
      : last?.suggestions?.length
        ? last.suggestions
        : t
          ? [`What’s on ${t}?`, `${t} paid`, "Change for 500", "Which tables are open?"]
          : ["Which tables are open?", "Sales today", "Compare today and yesterday", "Busiest hour"];

  const capabilities = [
    { Icon: IconReceipt, tone: "red", title: "Take an order", sub: t ? `“2 pares with egg”` : "“2 pares with egg for table 1”", say: t ? "2 pares with egg" : "2 pares with egg for table 1" },
    { Icon: IconCash, tone: "gold", title: t ? `Bill for ${t}` : "Check a bill", sub: t ? "“What’s on this table?”" : "“Magkano table 1?”", say: t ? `What’s on ${t}?` : "What’s on table 1?" },
    { Icon: IconChart, tone: "green", title: "Today’s sales", sub: "“How much did we sell today?”", say: "How much did we sell today?" },
    { Icon: IconSparkle, tone: "purple", title: "Insights", sub: "“Compare today and yesterday”", say: "Compare today and yesterday" },
  ] as const;

  return (
    <div className="chat">
      <header className="topbar">
        <div className="topbar-inner">
          <BackButton label={t ?? "previous screen"} />
          <div className="chat-head-title">
            <span className="chat-avatar">
              <LogoMark size={36} />
            </span>
            <div style={{ minWidth: 0 }}>
              <b>Ask Agent</b>
              <span>
                <i /> {t ? `Helping with ${t}` : "On-device · works offline"}
              </span>
            </div>
          </div>
          <div className="topbar-actions">
            {messages.length > 0 && (
              <button className="icon-btn" aria-label="Clear chat" onClick={() => useApp.getState().openDialog({ type: "confirm-clear-chat" })}>
                <IconTrash />
              </button>
            )}
            {canVoice && (
              <button className="icon-btn accent" aria-label="Start Talk mode" onClick={() => useApp.getState().openTalk()}>
                <IconWave />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="chat-log" ref={logRef} onScroll={onScroll} aria-live="polite">
        <div className="chat-log-inner">
          {messages.length === 0 ? (
            <motion.div className="welcome" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <LogoMark size={64} />
              <h2>How can I help?</h2>
              <p>Type or say an order, or ask about bills and sales. I work offline and understand English and Taglish.</p>
              <div className="capabilities">
                {capabilities.map(({ Icon, tone, title, sub, say }) => (
                  <button key={title} className="cap" onClick={() => submit(say)}>
                    <span className={`sico ${tone}`}>
                      <Icon />
                    </span>
                    <b>{title}</b>
                    <span>{sub}</span>
                  </button>
                ))}
              </div>
              {canVoice && (
                <button className="talk-cta" onClick={() => useApp.getState().openTalk()}>
                  <span className="sico red">
                    <IconWave />
                  </span>
                  <span>
                    <b>Talk mode</b>
                    <span>Hands-free conversation — I listen, answer and listen again</span>
                  </span>
                  <IconChevron />
                </button>
              )}
              <button className="btn btn-ghost btn-small" style={{ marginTop: 14 }} onClick={() => submit("What can you do?")}>
                <IconInfo /> See everything I can do
              </button>
            </motion.div>
          ) : (
            messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const sep = !prev || m.ts - prev.ts > SEPARATOR_GAP_MS;
              const first = sep || prev!.role !== m.role || m.ts - prev!.ts > GROUP_GAP_MS;
              const lastOfGroup = !next || next.role !== m.role || next.ts - m.ts > GROUP_GAP_MS || next.ts - m.ts > SEPARATOR_GAP_MS;
              return (
                <div key={m.id} style={{ display: "contents" }}>
                  {sep && <div className="sep">{separatorLabel(m.ts)}</div>}
                  <Message m={m} first={first} last={lastOfGroup} animate={!seenIds.current.has(m.id)} onReply={(r) => afterReply(r, "text")} />
                </div>
              );
            })
          )}
        </div>
      </div>

      <footer className="chat-foot">
        <AnimatePresence>
          {!atBottom && messages.length > 0 && (
            <motion.button
              key="jump"
              className="jump"
              style={{ top: -54 }}
              aria-label="Jump to latest message"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" })}
            >
              <IconArrowDown />
            </motion.button>
          )}
        </AnimatePresence>
        <div className="chat-foot-inner">
          {tip && !listening && (
            <div className="nudge" role="status">
              <IconBulb />
              <button
                className="nudge-text"
                onClick={() => (tip.tableId !== undefined ? useApp.getState().openTable(tip.tableId) : submit("Any tips?"))}
              >
                {tip.text}
              </button>
              <button className="nudge-x" aria-label="Dismiss tip" onClick={() => setHiddenTip(tip.text)}>
                <IconX />
              </button>
            </div>
          )}
          {voiceError && (
            <div className="voice-note">
              <IconInfo /> {voiceError}
            </div>
          )}
          {suggestions.length > 0 && !listening && (
            <div className="chips" aria-label="Suggestions">
              {suggestions.map((s) => (
                <button key={s} className="chip" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {listening ? (
            <div className="listening" role="status">
              <span className="wave" aria-hidden>
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className={`ltext${partial ? "" : " placeholder"}`}>{partial || "Listening… say an order"}</span>
              <button className="cbtn live" aria-label="Stop listening" onClick={listen}>
                <span className="ring" aria-hidden />
                <IconStop />
              </button>
            </div>
          ) : (
            <div className="composer">
              <textarea
                ref={inputRef}
                rows={1}
                value={text}
                placeholder={t ? `Message about ${t}…` : "Type an order or question…"}
                aria-label="Message Ask Agent"
                enterKeyHint="send"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
              />
              {canVoice && !text.trim() && (
                <button className="cbtn" aria-label="Speak" onClick={listen}>
                  <IconMic />
                </button>
              )}
              {(text.trim() || !canVoice) && (
                <button className="cbtn send" aria-label="Send" disabled={!text.trim()} onClick={() => submit(text)}>
                  <IconArrowUp />
                </button>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
