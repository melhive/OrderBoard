// Conversation state for the Ask Agent panel.

import { create } from "zustand";
import { currentRoute, useApp } from "../store/appStore";
import { respond } from "./engine";
import { executePlan } from "./executor";
import { emptyContext, type AgentContext, type AgentInput, type AgentReply, type Card, type World } from "./types";

export interface ChatMessage {
  id: number;
  role: "user" | "agent";
  text: string;
  card?: Card;
  confirm?: { yes: string; state: "pending" | "done" | "cancelled" | "expired" };
  undo?: "available" | "used";
  suggestions?: string[];
  tone?: AgentReply["tone"];
  via?: "voice" | "text";
}

interface AgentState {
  messages: ChatMessage[];
  ctx: AgentContext;
  send(text: string, via?: "voice" | "text"): AgentReply;
  confirm(id: number): AgentReply | null;
  cancel(id: number): AgentReply | null;
  undo(id: number): void;
  reset(): void;
}

let seq = 1;

export function worldSnapshot(): World {
  const s = useApp.getState();
  const r = currentRoute(s);
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
    let undo: ChatMessage["undo"];
    if (reply.execute) {
      const r = executePlan(reply.execute);
      if (r.text) text = r.text;
      if (r.ok && reply.undoable) undo = "available";
    }
    // Only the newest confirmation stays actionable.
    const messages = get().messages.map((m) =>
      m.confirm?.state === "pending" ? { ...m, confirm: { ...m.confirm, state: "expired" as const } } : m,
    );
    const msg: ChatMessage = {
      id: seq++,
      role: "agent",
      text,
      card: reply.card,
      confirm: reply.confirm ? { yes: reply.confirm.yes, state: "pending" } : undefined,
      undo,
      suggestions: reply.suggestions,
      tone: reply.tone,
    };
    set({ ctx, messages: [...messages, msg].slice(-80) });
    return { ...reply, text };
  };

  return {
    messages: [],
    ctx: emptyContext(),
    send(text, via = "text") {
      set((s) => ({ messages: [...s.messages, { id: seq++, role: "user", text, via }] }));
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
          { id: seq++, role: "agent" as const, text: label ? "Undone. The bill is back to how it was." : "There’s nothing to undo." },
        ],
      }));
    },
    reset() {
      set({ messages: [], ctx: emptyContext() });
    },
  };
});
