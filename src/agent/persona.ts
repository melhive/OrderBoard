// Persona: turns the engine's plain facts into natural, varied replies.
//
// The engine (engine.ts) decides WHAT happened and gives exact, canonical
// text. This layer decides HOW to say it — like a friendly helper at the
// stall: different wording every time (never the same line twice in a row),
// mirroring English or Taglish, using the owner's name now and then, and
// noticing the night (first sale, milestones, beating yesterday, a big order,
// a table clearing up, slow or busy nights, closing time).
//
// Pure: everything comes in as arguments (facts, memory, a random source), so
// it's fully testable. It never changes amounts, items or tables — it only
// rephrases them. Offline, instant, no AI model.

import { peso, plural } from "../lib/format";
import type { ChatTopic, ReplyMeta } from "./types";

export type Rng = () => number;

/** What the persona knows about tonight (computed by personaFacts in agentStore). */
export interface PersonaFacts {
  hour: number;
  ownerName?: string;
  todayTotal: number;
  todayOrders: number;
  yesterdayTotal: number;
  openTables: number;
  unpaid: number;
  /** Longest wait among open tables, in minutes. */
  longestWait: number;
  longestWaitTable?: string;
  backupDue: boolean;
}

/** Short-term memory so it doesn't repeat itself. */
export interface PersonaMemory {
  /** Last few lines used for each slot. */
  recent: Record<string, string[]>;
  /** Jokes already told this session. */
  jokes: number[];
  /** When the owner last talked to it (ms). */
  lastAt: number;
}

export const freshPersonaMemory = (): PersonaMemory => ({ recent: {}, jokes: [], lastAt: 0 });

export interface Humanized {
  text: string;
  memory: PersonaMemory;
}

// ---------------------------------------------------------------------------

class Voice {
  constructor(
    public mem: PersonaMemory,
    private rng: Rng,
  ) {}
  /** Picks a line, avoiding the last few used for the same slot. */
  pick(slot: string, options: string[]): string {
    const recent = this.mem.recent[slot] ?? [];
    const fresh = options.filter((o) => !recent.includes(o));
    const pool = fresh.length ? fresh : options;
    const choice = pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))]!;
    const keep = Math.max(0, Math.min(3, options.length - 1));
    this.mem = { ...this.mem, recent: { ...this.mem.recent, [slot]: keep ? [...recent, choice].slice(-keep) : [] } };
    return choice;
  }
  chance(p: number): boolean {
    return this.rng() < p;
  }
  index(n: number): number {
    return Math.min(n - 1, Math.floor(this.rng() * n));
  }
}

const MILESTONES = [500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000];

function join(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ").replace(/\s+([.,!?])/g, "$1").trim();
}

function greeting(hour: number, tl: boolean, bisaya: boolean): string {
  // Before 5 AM it's still "tonight" for a stall open past midnight.
  const part = hour < 5 || hour >= 18 ? 2 : hour < 12 ? 0 : 1;
  if (bisaya) return ["Maayong buntag", "Maayong hapon", "Maayong gabii"][part]!;
  if (tl) return ["Magandang umaga", "Magandang hapon", "Magandang gabi"][part]!;
  return ["Good morning", "Good afternoon", "Good evening"][part]!;
}

/** "So far tonight…" in a few different ways. */
function statusPhrase(v: Voice, f: PersonaFacts, tl: boolean): string {
  const night = f.hour >= 17 || f.hour < 5;
  let sales: string;
  if (!f.todayOrders) {
    sales = tl
      ? v.pick("st0tl", ["Wala pang benta — maaga pa naman.", "Wala pang benta, pero handa na tayo.", "Hinihintay pa natin ang unang customer."])
      : v.pick("st0", [`No sales yet — the ${night ? "night" : "day"} is young.`, "Nothing sold yet, but we’re ready.", "Still waiting on the first customer."]);
  } else {
    const ahead = f.yesterdayTotal > 0 && f.todayTotal > f.yesterdayTotal;
    sales = tl
      ? v.pick("st1tl", [`${peso(f.todayTotal)} na ang benta mula sa ${f.todayOrders} order.`, `Nasa ${peso(f.todayTotal)} na tayo (${f.todayOrders} order).`, `${f.todayOrders} order na, ${peso(f.todayTotal)} lahat.`])
      : v.pick("st1", [`${peso(f.todayTotal)} from ${plural(f.todayOrders, "order")} so far.`, `We’re at ${peso(f.todayTotal)} ${night ? "tonight" : "today"} (${plural(f.todayOrders, "order")}).`, `${plural(f.todayOrders, "order")} in, ${peso(f.todayTotal)} total.`]);
    if (ahead) sales += tl ? " Lagpas na sa kahapon! 🙌" : " Already ahead of yesterday! 🙌";
  }
  let open = "";
  if (f.openTables) {
    open = tl
      ? v.pick("stotl", [`${f.openTables} table ang bukas pa (${peso(f.unpaid)}).`, `May ${f.openTables} bukas na bill, ${peso(f.unpaid)} hindi pa bayad.`])
      : v.pick("sto", [`${plural(f.openTables, "table")} still open (${peso(f.unpaid)} unpaid).`, `${peso(f.unpaid)} waiting on ${plural(f.openTables, "open table")}.`]);
  }
  return join(sales, open);
}

// ---------------------------------------------------------------------------

export function humanize(meta: ReplyMeta, f: PersonaFacts, memory: PersonaMemory, rng: Rng, now: number = Date.now()): Humanized {
  const v = new Voice(memory, rng);
  const name = f.ownerName;
  const withName = (s: string, p: number) => (name && v.chance(p) ? s.replace(/([!.])$/, `, ${name}$1`) : s);
  let text: string;

  switch (meta.kind) {
    case "added": {
      const { table, items, total, units, tl } = meta;
      const P = peso(total);
      const ack = tl
        ? v.pick("ackTl", ["Sige!", "Okay po!", "Noted!", "Ayan!", "Copy!", "Sige, lista ko na!", "G!"])
        : v.pick("ack", ["Got it!", "Okay!", "Sure thing!", "Noted!", "Coming right up!", "On it!", "Copy that!", "Alright!"]);
      const core = tl
        ? v.pick("addTl", [`${items} para sa ${table}.`, `${items} sa ${table}.`, `Nailagay ko na ang ${items} sa ${table}.`, `${table}: ${items}.`])
        : v.pick("add", [`${items} for ${table}.`, `${items} on ${table}.`, `Added ${items} to ${table}.`, `${table} gets ${items}.`]);
      const tot = tl
        ? v.pick("totTl", [`${P} na ang bill.`, `Total: ${P}.`, `${P} na ang ${table}.`, `Bale ${P} na lahat.`])
        : v.pick("tot", [`Bill’s at ${P}.`, `That makes ${P}.`, `${table} is at ${P} now.`, `Total so far: ${P}.`]);
      const big = units >= 8 && v.chance(0.7) ? (tl ? v.pick("bigTl", ["Ang dami! 💪", `Gutom na gutom ang ${table}! 😄`]) : v.pick("big", ["Big order! 💪", "That’s a hungry table! 😄"])) : "";
      text = join(v.chance(0.75) ? withName(ack, 0.15) : "", core, tot, big);
      break;
    }
    case "removed": {
      const { table, items, total, tl } = meta;
      const core = tl
        ? v.pick("remTl", [`Sige, tinanggal ko ang ${items} sa ${table}.`, `Okay, wala na ang ${items} sa ${table}.`, `Done, bawas na ang ${items} sa ${table}.`])
        : v.pick("rem", [`Okay, took ${items} off ${table}.`, `Removed ${items} from ${table}.`, `Done — ${items} is off ${table}.`, `No problem, ${items} is off ${table}.`]);
      const tot = total > 0
        ? tl ? v.pick("remTotTl", [`${peso(total)} na lang ang bill.`, `Bale ${peso(total)} na lang.`]) : v.pick("remTot", [`${table} is now at ${peso(total)}.`, `New total: ${peso(total)}.`])
        : tl ? v.pick("remEmptyTl", [`Wala nang laman ang ${table}.`, `Bakante na ang ${table}.`]) : v.pick("remEmpty", [`${table} is empty now.`, `Nothing left on ${table}.`]);
      text = join(core, tot);
      break;
    }
    case "paid": {
      const { table, total, method, change, todayBefore, yesterday, ordersBefore, stillOpen, tl } = meta;
      const P = peso(total);
      const via = method === "gcash" ? " via GCash" : method === "maya" ? " via Maya" : "";
      const viaTl = method === "gcash" ? " sa GCash" : method === "maya" ? " sa Maya" : "";
      const core = tl
        ? v.pick("paidTl", [`Bayad na ang ${table}${viaTl} — ${P}.`, `Natanggap ang ${P}${viaTl} mula sa ${table}.`, `Okay, ${table} bayad na: ${P}${viaTl}.`])
        : v.pick("paid", [`${table} paid${via} — ${P}.`, `${P}${via} from ${table}, recorded.`, `Got ${table}’s ${P}${via}.`, `${table} is settled: ${P}${via}.`]);
      const chg = change !== undefined && change > 0
        ? tl ? v.pick("chgTl", [`Sukli: ${peso(change)}.`, `${peso(change)} ang sukli.`]) : v.pick("chg", [`Change is ${peso(change)}.`, `Give back ${peso(change)}.`, `${peso(change)} change.`])
        : change === 0 ? (tl ? "Sakto ang bayad." : "Exact amount.") : "";
      // One remark about the night, most notable first.
      const after = todayBefore + total;
      const crossed = MILESTONES.filter((m) => todayBefore < m && after >= m).pop();
      let remark = "";
      if (ordersBefore === 0) {
        remark = tl ? v.pick("firstTl", ["Buena mano! 🎉", "Unang benta ngayong araw! 🎉"]) : v.pick("first", ["First sale of the day! 🎉", "And we’re off — first sale! 🎉"]);
      } else if (yesterday > 0 && todayBefore < yesterday && after >= yesterday) {
        remark = tl ? `Nalagpasan na natin ang benta kahapon (${peso(yesterday)})! 🙌` : `You just passed yesterday’s total of ${peso(yesterday)}! 🙌`;
      } else if (crossed) {
        remark = tl ? v.pick("mileTl", [`${peso(after)} na ang benta — ayos!`, `Lagpas ${peso(crossed)} na tayo! 🔥`]) : v.pick("mile", [`That puts us at ${peso(after)} — nice!`, `Past ${peso(crossed)} now! 🔥`]);
      } else if (stillOpen === 0 && v.chance(0.6)) {
        remark = tl ? v.pick("clearTl", ["Wala nang bukas na bill.", "Lahat bayad na!"]) : v.pick("clear", ["All tables are clear now.", "No open bills left."]);
      } else if (v.chance(0.35)) {
        remark = tl ? v.pick("freeTl", [`Bakante na ang ${table}.`, "Salamat sa customer!"]) : v.pick("free", [`${table} is free now.`, "Another happy customer!"]);
      }
      const ack = v.chance(0.4) ? (tl ? v.pick("payAckTl", ["Salamat!", "Ayos!", "Sige!"]) : v.pick("payAck", ["Nice!", "Thank you!", "Great!", "Done!"])) : "";
      text = join(ack, core, chg, remark);
      break;
    }
    case "utang": {
      const { table, total, customer, tl } = meta;
      text = tl
        ? v.pick("utangTl", [`Sige, ${peso(total)} sa listahan ni ${customer}.`, `Nailista ko na kay ${customer}: ${peso(total)} (${table}).`, `Okay, utang ni ${customer} ang ${table} — ${peso(total)}.`])
        : v.pick("utang", [`Okay, ${peso(total)} goes on ${customer}’s tab.`, `Listed ${table}’s ${peso(total)} under ${customer}.`, `${table}’s ${peso(total)} is on ${customer}’s utang now.`]);
      break;
    }
    case "unknown": {
      const { tl, tableName } = meta;
      const open = tl
        ? v.pick("unkTl", ["Hmm, hindi ko masyadong nakuha.", "Pasensya, hindi ko gets.", "Medyo nalito ako doon.", "Ulitin mo nga, iba lang ang pagkakasabi?"])
        : v.pick("unk", ["Hmm, I didn’t quite catch that.", "Sorry, I’m not sure what you mean.", "I didn’t get that one.", "Could you say that another way?"]);
      let help: string;
      if (tableName) {
        help = tl ? `Ano ang gagawin ko sa ${tableName} — dagdag order, tingnan ang bill, o bayad na?` : `What should I do with ${tableName} — add an order, check the bill, or mark it paid?`;
      } else {
        help = tl
          ? v.pick("unkHelpTl", ["Subukan: “2 pares table 3” o “magkano benta ngayon?”.", "Puwede kang mag-order (“isang mami table 1”), magbayad (“table 2 bayad gcash”), o magtanong.", "Sabihin mo lang ang order at table, halimbawa “3 siomai table 2”."])
          : v.pick("unkHelp", ["Try “2 pares table 3” or “how much did we sell today?”.", "You can order (“mami table 1”), pay (“table 2 paid gcash”), or ask me anything about your sales.", "Just tell me the order and the table, like “3 siomai table 2”."]);
      }
      text = join(open, help);
      break;
    }
    case "chat":
      text = chat(v, meta.topic, meta.tl, meta.bisaya, f, now, meta.name ?? name);
      break;
  }
  return { text, memory: { ...v.mem, lastAt: now } };
}

// ---------------------------------------------------------------------------

const JOKES: [string, string][] = [
  ["Why did the pares go to school? To get a little more “sabaw-ified”.", "Bakit nag-aral ang pares? Para maging mas ‘sabaw-sticated’."],
  ["What do you call a sleepy mami? Mami-ga-gabi.", "Anong tawag sa mami na puyat? Mami-ga-gabi."],
  ["Why is the siomai always calm? It’s been through a lot of steam.", "Bakit laging kalmado ang siomai? Sanay na sa init ng steamer."],
  ["I tried to count the rice grains in a pares… I lost count at ₱75.", "Sinubukan kong bilangin ang kanin sa pares… naligaw ako sa ₱75."],
  ["The egg asked the pares: “Are we a combo?” Pares said: “Only for ₱15 more.”", "Sabi ng itlog sa pares: “Tayo na ba?” Sagot ng pares: “Oo, dagdag ₱15 lang.”"],
  ["Why don’t softdrinks ever argue? They don’t want things to go flat.", "Bakit hindi nag-aaway ang softdrinks? Ayaw nilang mag-flat ang usapan."],
];

function chat(v: Voice, topic: ChatTopic, tl: boolean, bisaya: boolean, f: PersonaFacts, now: number, name?: string): string {
  const nm = name ? ` ${name}` : "";
  const away = v.mem.lastAt > 0 && now - v.mem.lastAt > 2 * 3600_000;
  switch (topic) {
    case "greet": {
      const g = greeting(f.hour, tl, bisaya);
      const hello = bisaya
        ? v.pick("helloBis", [`${g} pud${nm}!`, `${g}${nm}! Kumusta?`])
        : tl
          ? v.pick("helloTl", [`${g}${nm}!`, `Uy${nm}! ${g}.`, `${g}${nm}! Kumusta?`])
          : v.pick("hello", [`${g}${nm}!`, `Hey${nm}! ${g}.`, `${g}${nm}! Good to see you.`]);
      const back = away ? (tl ? "Welcome back!" : "Welcome back!") : "";
      const end = tl ? v.pick("helloEndTl", ["Handa na ako.", "Ano’ng una?", "Tara, kuha na tayo ng order!"]) : v.pick("helloEnd", ["Ready for orders.", "What’s first?", "Let’s get some orders in!"]);
      return join(hello, back, statusPhrase(v, f, tl), end);
    }
    case "howareyou": {
      let mood: string;
      if (f.todayOrders && f.yesterdayTotal && f.todayTotal > f.yesterdayTotal) {
        mood = tl ? v.pick("moodGoodTl", ["Ang saya ko — maganda ang benta ngayon!", "Ayos na ayos! Malakas tayo ngayon."]) : v.pick("moodGood", ["Doing great — sales are looking good!", "Fantastic! It’s a good night so far."]);
      } else if (!f.todayOrders) {
        mood = tl ? v.pick("moodWaitTl", ["Ayos lang! Hinihintay ko lang ang unang customer.", "Okay naman, handa na sa dagsa!"]) : v.pick("moodWait", ["I’m good! Just waiting for the first customer.", "All good here — ready for the rush."]);
      } else {
        mood = tl ? v.pick("moodOkTl", ["Ayos lang ako, salamat sa pagtatanong!", "Okay naman! Busy sa pag-lista ng order mo."]) : v.pick("moodOk", ["I’m doing well, thanks for asking!", "Good! Busy keeping track of your orders."]);
      }
      const ask = v.chance(0.4) ? (tl ? "Ikaw, kumusta ka?" : "How about you?") : "";
      return join(mood, statusPhrase(v, f, tl), ask);
    }
    case "thanks": {
      const a = bisaya ? v.pick("tyBis", ["Walay sapayan!", "Walay problema!"]) : tl ? v.pick("tyTl", ["Walang anuman!", "Sige lang!", "Wala ’yon!", "Basta ikaw!"]) : v.pick("ty", ["You’re welcome!", "Anytime!", "No problem!", "Happy to help!", "Of course!"]);
      const b = v.chance(0.45) ? (tl ? v.pick("tyMoreTl", ["May iba pa?", "Ano pa?"]) : v.pick("tyMore", ["Anything else?", "What’s next?"])) : "";
      return join(a.replace(/!$/, name && v.chance(0.3) ? `, ${name}!` : "!"), b);
    }
    case "praise":
      return tl ? v.pick("praiseTl", ["Salamat! Ikaw ang magaling. 😊", "Uy, salamat! Team tayo dito.", "Salamat! Tuloy-tuloy lang!"]) : v.pick("praise", ["Thank you! You make it easy. 😊", "Aw, thanks! Teamwork!", "Thanks! Let’s keep the orders coming."]);
    case "tired": {
      const a = tl ? v.pick("tiredTl", ["Kaya mo ’yan! Konting tiis na lang.", "Pahinga ka saglit kung kaya — ako na bahala sa lista.", "Ang sipag mo! Malapit na."]) : v.pick("tired", ["You’re doing amazing — hang in there!", "Long night, huh? You’ve got this.", "Take a breather when you can — I’ll keep track of everything."]);
      return join(a.replace(/!$/, name ? `, ${name}!` : "!"), statusPhrase(v, f, tl));
    }
    case "hungry":
      return tl ? v.pick("hungryTl", ["Kain ka muna! Ako muna bahala dito.", "Kumain ka muna ng pares — deserve mo ’yan! 😄", "Gutom? Kain muna bago ang susunod na dagsa!"]) : v.pick("hungry", ["Eat something first — I’ll hold the fort!", "Grab a bowl of pares — you’ve earned it! 😄", "Hungry? Eat before the next rush!"]);
    case "busy": {
      const a = tl ? v.pick("busyTl", ["Dagsa ang tao — ayos! Sabihin mo lang ang order, ako na bahala.", "Rush hour! Isa-isa lang, kaya natin ’to."]) : v.pick("busy", ["Busy night — love it! Just call out the orders, I’ll keep up.", "Rush hour! One at a time — we’ve got this."]);
      const wait = f.longestWait >= 15 && f.longestWaitTable ? (tl ? `Paalala: ${f.longestWaitTable} ay ${f.longestWait} minuto nang naghihintay.` : `Heads up: ${f.longestWaitTable} has been waiting ${f.longestWait} minutes.`) : "";
      return join(a, wait);
    }
    case "slow": {
      const a = tl ? v.pick("slowTl", ["Matumal muna, pero darating din ang mga suki.", "Tahimik pa — magandang oras para mag-prepare at mag-restock."]) : v.pick("slow", ["Slow nights happen — the late crowd usually comes.", "Quiet for now. Good time to prep and restock!"]);
      return join(a, statusPhrase(v, f, tl));
    }
    case "insult":
      return tl ? v.pick("insultTl", ["Pasensya na — nag-aaral pa ako. Ulitin mo lang, aayusin ko.", "Sorry! Sabihin mo ulit, babawi ako.", "Ay, pasensya. Subukan natin ulit?"]) : v.pick("insult", ["Sorry about that — I’m still learning. Tell me again and I’ll do my best.", "My bad! Say it another way and I’ll fix it.", "Sorry! Let’s try that again."]);
    case "sorry":
      return tl ? v.pick("sorryTl", ["Okay lang ’yan!", "Walang problema!", "Wala ’yon!"]) : v.pick("sorry", ["No worries at all!", "All good!", "It’s okay!"]);
    case "ack":
      return tl ? v.pick("ackTlChat", ["Sige!", "👍", "Okay, nandito lang ako.", "Game!"]) : v.pick("ackChat", ["👍", "Okay! I’m here if you need me.", "Ready when you are.", "Sure!"]);
    case "laugh":
      return v.pick("laugh", ["😄", "Haha! 😄", "😂", "Hehe 😄"]);
    case "joke": {
      const unused = JOKES.map((_, i) => i).filter((i) => !v.mem.jokes.includes(i));
      const pool = unused.length ? unused : JOKES.map((_, i) => i);
      const i = pool[v.index(pool.length)]!;
      v.mem = { ...v.mem, jokes: unused.length ? [...v.mem.jokes, i] : [i] };
      const j = JOKES[i]!;
      return join(tl ? j[1] : j[0], v.pick(tl ? "jokeEndTl" : "jokeEnd", tl ? ["😄", "…Orders na lang ako. 😅", "Hehe."] : ["😄", "…I’ll stick to taking orders. 😅", "Ba-dum-tss."]));
    }
    case "bye": {
      const a = tl ? v.pick("byeTl", ["Salamat sa sipag ngayong araw!", "Pahinga ka na — deserve mo!", "Ingat sa pag-uwi!"]) : v.pick("bye", ["Good work today!", "Great job — rest well!", "Get home safe!"]);
      const backup = f.backupDue ? (tl ? "Huwag kalimutang mag-backup ng benta." : "Don’t forget to back up your sales.") : "";
      return join(a.replace(/!$/, name ? `, ${name}!` : "!"), statusPhrase(v, f, tl), backup);
    }
    case "love":
      return tl ? v.pick("loveTl", ["Ay, kinikilig ako! Pero mas mahal ko ang maraming order. 💛", "Aww! Mahal din kita — lalo na pag maraming benta. 💛"]) : v.pick("love", ["Aww! I love a busy night of orders. 💛", "Love you too — especially on good sales nights! 💛"]);
    case "bored":
      return tl ? v.pick("boredTl", ["Gusto mo ng biro habang naghihintay? O sasabihin ko ang benta?", "Inip? Sabihin mo “joke” — may baon ako!"]) : v.pick("bored", ["Want a joke while we wait? Or I can tell you tonight’s numbers.", "Bored? Say “joke” — I’ve got a few!"]);
    case "whoareyou":
      return tl
        ? v.pick("whoTl", ["Ako ang katulong mo sa Order Board — kumukuha ng order, nag-aasikaso ng bayad, utang at gastos, at sumasagot tungkol sa benta. Dito lang ako sa phone mo.", "Ako ang assistant ng tindahan mo: order, bayad, utang, benta — ako na bahala. Walang internet na kailangan."])
        : v.pick("who", ["I’m your Order Board assistant — I take orders, handle payments, utang and expenses, and answer anything about your sales. I live right here on your phone.", "Think of me as your stall helper: orders, payments, utang, sales — I keep track of it all, no internet needed."]);
    case "creator":
      return tl ? "Ginawa ako para sa stall mo, bilang bahagi ng Order Board. Tumatakbo ako sa phone mismo — walang internet, walang account." : "I was built into Order Board for your stall. I run entirely on this phone — no internet, no account.";
    case "myname":
      return name
        ? tl ? v.pick("nameTl", [`Ikinagagalak kitang makilala, ${name}!`, `Sige, ${name} na ang tawag ko sa’yo.`, `Hello ${name}! Tatandaan ko ’yan.`]) : v.pick("name", [`Nice to meet you, ${name}!`, `Got it — I’ll call you ${name}.`, `Hi ${name}! I’ll remember that.`])
        : tl ? "Ikinagagalak kitang makilala!" : "Nice to meet you!";
    case "whatsmyname":
      return name ? (tl ? v.pick("wmnTl", [`Ikaw si ${name}!`, `${name}, siyempre!`]) : v.pick("wmn", [`You’re ${name}!`, `${name}, of course!`])) : tl ? "Hindi mo pa sinasabi — sabihin mo lang “ako si …”." : "You haven’t told me yet — just say “my name is …”.";
    default:
      return tl ? "👍" : "👍";
  }
}

/** Builds PersonaFacts from the app data (kept here so agentStore stays thin). */
export { personaFacts } from "./personaFacts";
