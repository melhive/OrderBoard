// Conversation state for the Ask Agent panel.

import { create } from "zustand";
import { currentRoute, useApp } from "../store/appStore";
import { respond } from "./engine";
import { executePlan } from "./executor";
import { freshPersonaMemory, humanize, personaFacts, type PersonaMemory, type Rng } from "./persona";
import type { ReplyMeta } from "./types";

// The persona layer (natural, varied wording). On in the app; tests that
// check the engine's exact wording turn it off.
let personaOn = true;
let personaRng: Rng = Math.random;
let personaMemory: PersonaMemory = freshPersonaMemory();
/** A persona line outside a chat turn (e.g. Talk mode's greeting); falls back when the persona is off. */
export function personaLine(meta: ReplyMeta, fallback: string): string {
  if (!personaOn) return fallback;
  try {
    const h = humanize(meta, personaFacts(useApp.getState().data), personaMemory, personaRng);
    personaMemory = h.memory;
    return h.text;
  } catch {
    return fallback;
  }
}

export function setPersona(on: boolean, rng?: Rng) {
  personaOn = on;
  if (rng) personaRng = rng;
  personaMemory = freshPersonaMemory();
}
import { emptyContext, type AgentContext, type AgentInput, type AgentReply, type Card, type World } from "./types";

export interface ChatMessage {
  id: number;
  /** Epoch ms when the message was created. */
  ts: number;
  role: "user" | "agent";
  text: string;
  card?: Card;
  confirm?: { yes: string; state: "pending" | "done" | "cancelled" | "expired" };
  undo?: "available" | "used";
  suggestions?: string[];
  tone?: AgentReply["tone"];
  via?: "voice" | "text";
  link?: AgentReply["link"];
}

interface AgentState {
  messages: ChatMessage[];
  ctx: AgentContext;
  send(text: string, via?: "voice" | "text"): AgentReply;
  confirm(id: number): AgentReply | null;
  cancel(id: number): AgentReply | null;
  undo(id: number): void;
  reset(): void;
  /** Restores saved history (pending buttons from a previous session are retired). */
  hydrate(messages: ChatMessage[]): void;
}

let seq = 1;
const MAX_MESSAGES = 200;

export function worldSnapshot(): World {
  const s = useApp.getState();
  // The chat opens on top of an order screen: that table is still "current".
  const r = [...s.stack].reverse().find((x) => x.name !== "ask" && x.name !== "talk") ?? currentRoute(s);
  return {
    data: s.data,
    currentTableId: r.name === "order" ? r.tableId : null,
    activeSplit: s.activeSplit,
    now: new Date(),
  };
}

export const useAgent = create<AgentState>()((set, get) => {
  /** Runs the engine, executes any immediate plan, and appends the reply. */
  const run = (input: AgentInput): AgentReply => {
    const { reply, ctx } = respond(input, worldSnapshot(), get().ctx);
    let text = reply.text;
    let card = reply.card;
    let undo: ChatMessage["undo"];
    let overridden = false;
    if (reply.execute) {
      const r = executePlan(reply.execute);
      if (r.text) {
        text = r.text;
        overridden = true;
      }
      if (r.card) card = r.card;
      if (r.ok && reply.undoable) undo = "available";
    }
    // Say it like a person: same facts, varied wording.
    let humanized = false;
    if (personaOn && reply.meta && !overridden) {
      try {
        const h = humanize(reply.meta, personaFacts(useApp.getState().data), personaMemory, personaRng);
        personaMemory = h.memory;
        text = h.text;
        humanized = true;
      } catch {
        /* keep the engine's wording */
      }
    }
    // Only the newest confirmation stays actionable.
    const messages = get().messages.map((m) =>
      m.confirm?.state === "pending" ? { ...m, confirm: { ...m.confirm, state: "expired" as const } } : m,
    );
    const msg: ChatMessage = {
      id: seq++,
      ts: Date.now(),
      role: "agent",
      text,
      card,
      confirm: reply.confirm ? { yes: reply.confirm.yes, state: "pending" } : undefined,
      undo,
      suggestions: reply.suggestions,
      tone: reply.tone,
      link: reply.link,
    };
    set({ ctx, messages: [...messages, msg].slice(-MAX_MESSAGES) });
    // A text override (e.g. undo) is also what gets spoken.
    return { ...reply, text, card, speak: humanized || text !== reply.text ? undefined : reply.speak };
  };

  return {
    messages: [],
    ctx: emptyContext(),
    send(text, via = "text") {
      set((s) => ({ messages: [...s.messages, { id: seq++, ts: Date.now(), role: "user", text, via }] }));
      return run(text);
    },
    confirm(id) {
      const m = get().messages.find((x) => x.id === id);
      if (m?.confirm?.state !== "pending") return null;
      set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, confirm: { ...x.confirm!, state: "done" } } : x)) }));
      return run({ type: "confirm" });
    },
    cancel(id) {
      const m = get().messages.find((x) => x.id === id);
      if (m?.confirm?.state !== "pending") return null;
      set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, confirm: { ...x.confirm!, state: "cancelled" } } : x)) }));
      return run({ type: "cancel" });
    },
    undo(id) {
      const label = useApp.getState().undo();
      set((s) => ({
        messages: [
          ...s.messages.map((x) => (x.id === id ? { ...x, undo: "used" as const } : x)),
          { id: seq++, ts: Date.now(), role: "agent" as const, text: label ? "Undone. The bill is back to how it was." : "There’s nothing to undo." },
        ],
      }));
    },
    reset() {
      set({ messages: [], ctx: emptyContext() });
    },
    hydrate(saved) {
      const messages = saved.slice(-MAX_MESSAGES).map((m) => ({
        ...m,
        ts: typeof m.ts === "number" ? m.ts : Date.now(),
        confirm: m.confirm?.state === "pending" ? { ...m.confirm, state: "expired" as const } : m.confirm,
        undo: undefined,
        suggestions: undefined,
      }));
      seq = Math.max(seq, ...messages.map((m) => m.id + 1));
      set({ messages, ctx: emptyContext() });
    },
  };
});
