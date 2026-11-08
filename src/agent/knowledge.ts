// What Ask Agent knows about the app itself ("how do I…", "paano…", "where is…")
// and its casual conversation. Pure data + matching; no store access.

import type { Route } from "../store/appStore";

// ---------- language ----------

/** Words that only appear in Filipino/Taglish speech. */
const FIL_STRONG = new Set([
  "kumusta", "kamusta", "musta", "salamat", "paano", "pano", "magkano", "ilan", "ano", "anong", "sino", "saan", "nasaan", "bakit",
  "po", "opo", "ba", "naman", "pala", "lang", "yung", "ng", "mga", "talaga", "sige", "pwede", "puwede", "gusto", "wala", "walang",
  "meron", "mayroon", "hindi", "oo", "ako", "ikaw", "kayo", "natin", "namin", "mo", "ko", "ka", "nga", "kasi", "tapos", "ngayon",
  "kahapon", "benta", "utang", "bayad", "sukli", "ubos", "naubos", "gastos", "tubo", "pagod", "inaantok", "galing", "grabe", "ingat",
  "paalam", "magandang", "umaga", "hapon", "gabi", "pasensya", "ulit", "dito", "diyan", "nandyan", "nandito", "tulong", "tulungan",
]);

/** True when the user is speaking Filipino/Taglish, so replies can match. */
export function isTaglish(raw: string): boolean {
  const words = raw.toLowerCase().replace(/[^a-zñ\s]/g, " ").split(/\s+/).filter(Boolean);
  let n = 0;
  for (const w of words) if (FIL_STRONG.has(w)) n++;
  return n >= 1;
}

// ---------- how-to knowledge ----------

export interface Topic {
  id: string;
  /** Keywords/phrases (normalized, lowercase). Longer phrases weigh more. */
  keys: string[];
  en: string;
  tl?: string;
  link?: { label: string; route: Route };
  /** Follow-up chips. */
  try?: string[];
}

export const TOPICS: Topic[] = [
  {
    id: "order",
    keys: ["take order", "take an order", "add order", "add items", "add item", "order", "mag order", "ilagay", "add food"],
    en: "Tap a table on the Tables screen, then tap menu items — each tap adds one. Tap “View bill” at the bottom to see or change the bill. Or just tell me: “2 pares with egg for table 3”.",
    tl: "Pindutin ang table sa Tables, tapos pindutin ang mga item sa menu — isang pindot, isang order. Pindutin ang “View bill” sa baba para makita ang bill. O sabihin mo lang sa akin: “2 pares with egg sa table 3”.",
    link: { label: "Go to Tables", route: { name: "tables" } },
    try: ["2 pares with egg for table 3"],
  },
  {
    id: "custom",
    keys: ["custom item", "custom", "not on the menu", "wala sa menu", "special item", "other item"],
    en: "On a table’s order screen, tap “+ Custom” next to the search box, type a name and price. Or tell me “1 halo-halo for table 2” and I’ll ask for its price.",
    tl: "Sa order screen ng table, pindutin ang “+ Custom” sa tabi ng search, ilagay ang pangalan at presyo. O sabihin mo “1 halo-halo sa table 2” at itatanong ko ang presyo.",
  },
  {
    id: "split",
    keys: ["split", "split bill", "separate bill", "hiwalay", "hiwalay na bayad", "kanya kanya", "two bills", "another bill"],
    en: "Open the table and tap the split icon at the top (or “+ Bill”). Each bill is paid separately — switch between them with the Bill 1 / Bill 2 tabs. You can also say “split table 2”.",
    tl: "Buksan ang table at pindutin ang split icon sa taas (o “+ Bill”). Hiwalay ang bayad ng bawat bill — lumipat gamit ang Bill 1 / Bill 2. Puwede mo ring sabihin “split table 2”.",
  },
  {
    id: "pay",
    keys: ["pay", "paid", "settle", "bill out", "bayad", "magbayad", "mark paid", "checkout", "change", "sukli", "cash"],
    en: "Open the table, tap “View bill”, enter the cash received (or tap a quick amount) — the change shows right away — then tap “Paid”. Made a mistake? Tap Undo in the message that appears. Or say “table 3 paid 500”.",
    tl: "Buksan ang table, pindutin ang “View bill”, ilagay ang perang ibinigay — lalabas agad ang sukli — tapos pindutin ang “Paid”. Nagkamali? Pindutin ang Undo. O sabihin mo “table 3 bayad 500”.",
    try: ["Change for 500 on table 1"],
  },
  {
    id: "gcash",
    keys: ["gcash", "maya", "paymaya", "e wallet", "ewallet", "online payment", "qr", "payment method", "bank"],
    en: "When paying, choose GCash or Maya above the Paid button (instead of Cash). Summary then shows how much came in by cash, GCash and Maya. Or say “table 3 paid gcash”.",
    tl: "Sa pagbayad, piliin ang GCash o Maya sa itaas ng Paid button. Makikita sa Summary kung magkano ang cash, GCash at Maya. O sabihin “table 3 bayad gcash”.",
  },
  {
    id: "utang",
    keys: ["utang", "credit", "pay later", "lista", "listahan", "owe", "owes", "debt", "ilista", "suki", "babayaran mamaya"],
    en: "When paying, choose “Utang” and type the customer’s name, then tap the button — the order counts as sold and goes on their list. When they pay, open Summary → Utang, tap their name and “Record payment”. Or say “table 2 utang ni Ben” and later “Ben paid 100”.",
    tl: "Sa pagbayad, piliin ang “Utang” at ilagay ang pangalan ng customer. Kapag nagbayad na, buksan ang Summary → Utang, pindutin ang pangalan at “Record payment”. O sabihin “table 2 utang ni Ben”, tapos “nagbayad si Ben 100”.",
    link: { label: "Open utang list", route: { name: "utang" } },
    try: ["Sino may utang?"],
  },
  {
    id: "restore",
    keys: ["undo payment", "undo paid", "wrong payment", "mistake", "restore", "reopen", "mali bayad", "maling bayad", "undo"],
    en: "Right after paying, tap Undo in the message at the bottom. Later: open Summary, tap the order, then “Restore to table” — it goes back as an open bill. You can also say “undo” or “restore the last order”.",
    tl: "Pagkatapos magbayad, pindutin ang Undo sa baba. Kung huli na: buksan ang Summary, pindutin ang order, tapos “Restore to table”. Puwede ring sabihin “undo”.",
  },
  {
    id: "delete",
    keys: ["delete order", "delete sale", "remove sale", "void", "burahin", "delete transaction"],
    en: "Open Summary, tap the order, then “Delete order” and type the 4-letter code shown. For safety I can’t delete sales myself.",
    tl: "Buksan ang Summary, pindutin ang order, tapos “Delete order” at i-type ang 4-letter code. Para ligtas, hindi ako puwedeng magbura ng benta.",
    link: { label: "Open Summary", route: { name: "summary" } },
  },
  {
    id: "reset",
    keys: ["reset", "reset today", "start over", "clear sales", "ulitin"],
    en: "Summary → “Reset today” removes today’s sales after you type a confirmation code. It can’t be undone, so export a backup first if unsure.",
    tl: "Summary → “Reset today” — binubura ang benta ngayon pagkatapos mong i-type ang code. Hindi na ito maibabalik kaya mag-backup muna.",
    link: { label: "Open Summary", route: { name: "summary" } },
  },
  {
    id: "clear",
    keys: ["clear table", "cancel order", "customer left", "umalis", "clear bill", "empty table"],
    en: "Open the table, tap “View bill”, then “Clear”. Nothing is recorded as a sale, and you can Undo right after. Or say “clear table 2”.",
    tl: "Buksan ang table, “View bill”, tapos “Clear”. Walang benta na maitatala, at puwedeng i-Undo. O sabihin “clear table 2”.",
  },
  {
    id: "tables",
    keys: ["add table", "new table", "remove table", "delete table", "takeout", "take out", "grab", "foodpanda", "dagdag table"],
    en: "On Tables, tap “Add table” at the end and give it a name like Takeout or Grab. Custom tables can be removed with the ✕ when they’re empty. Or say “add table Takeout”.",
    tl: "Sa Tables, pindutin ang “Add table” at pangalanan, hal. Takeout o Grab. Puwedeng tanggalin gamit ang ✕ kapag walang laman. O sabihin “add table Takeout”.",
    link: { label: "Go to Tables", route: { name: "tables" } },
  },
  {
    id: "move",
    keys: ["move table", "transfer", "lipat", "ilipat", "change table", "merge"],
    en: "Say “move table 2 to table 4” and I’ll move the whole bill (it becomes a separate bill if table 4 already has one).",
    tl: "Sabihin “ilipat ang table 2 sa table 4” at ililipat ko ang buong bill.",
  },
  {
    id: "served",
    keys: ["served", "serve", "na serve", "naserve", "hain", "naihain", "check mark", "not served", "waiting", "naghihintay", "timer", "wait time", "how long"],
    en: "On the bill, tap the ✓ circle next to an item once it’s served (“All served” marks everything). Tables show how long they’ve been open and how many items are still to serve — they turn red after 20 minutes. Or say “table 2 served”.",
    tl: "Sa bill, pindutin ang ✓ sa tabi ng item kapag na-serve na (“All served” para lahat). Makikita sa Tables kung gaano katagal na at ilan pa ang hindi na-serve — pupula pagkalipas ng 20 minuto. O sabihin “served na table 2”.",
  },
  {
    id: "notes",
    keys: ["note", "notes", "walang sibuyas", "no onions", "special request", "request", "bilin", "extra sabaw", "spicy", "maanghang"],
    en: "Open the bill and tap an item’s name to add a note like “walang sibuyas” or “extra sabaw”. Or say “2 pares walang sibuyas for table 3”, or “note pares table 3 extra sabaw”.",
    tl: "Buksan ang bill at pindutin ang pangalan ng item para maglagay ng note, hal. “walang sibuyas”. O sabihin “2 pares walang sibuyas sa table 3”.",
  },
  {
    id: "soldout",
    keys: ["sold out", "ubos", "naubos", "out of stock", "wala na", "available", "in stock", "restock"],
    en: "Long-press an item on the order screen (or use Settings → Menu) to mark it sold out. It turns grey and I’ll warn if someone orders it. It comes back automatically the next business day. Or say “ubos na ang pastil”.",
    tl: "I-long-press ang item sa order screen (o Settings → Menu) para markahang ubos. Babalaan kita kapag may umorder. Babalik ito bukas. O sabihin “ubos na ang pastil”.",
  },
  {
    id: "expenses",
    keys: ["expense", "expenses", "gastos", "gasto", "spent", "spend", "bought", "bumili", "binili", "ingredients", "lpg", "gas", "ice", "yelo"],
    en: "Open Summary and tap “Add expense” under Money (amount + what for). Or tell me “gastos 300 sa yelo” or “expense 500 gas”.",
    tl: "Buksan ang Summary at pindutin ang “Add expense” sa Money. O sabihin mo “gastos 300 sa yelo”.",
    link: { label: "Open Summary", route: { name: "summary" } },
  },
  {
    id: "profit",
    keys: ["profit", "tubo", "net", "kita", "income", "earnings", "money received"],
    en: "Summary → Money shows sales by Cash/GCash/Maya, utang, expenses and Profit (sales minus expenses) for any period. Or ask “profit today” or “magkano tubo this week”.",
    tl: "Sa Summary → Money makikita ang benta (Cash/GCash/Maya), utang, gastos at Profit (benta bawas gastos). O itanong “tubo ngayon”.",
    try: ["Profit today"],
  },
  {
    id: "summary",
    keys: ["summary", "sales", "report", "reports", "best seller", "date range", "yesterday", "week", "month", "history", "benta"],
    en: "Summary shows Today, This week, This month, All time or any date range: earnings, best sellers, money breakdown and every order. Tap a day to see its orders.",
    tl: "Sa Summary makikita ang benta ngayon, ngayong linggo, buwan, lahat, o kahit anong petsa — kasama ang best sellers at bawat order.",
    link: { label: "Open Summary", route: { name: "summary" } },
  },
  {
    id: "export",
    keys: ["export", "pdf", "csv", "excel", "print", "download report", "share report", "i print"],
    en: "Summary → Export → CSV (Google Sheets/Excel) or PDF (printable report with your business name). Or say “export today’s report as pdf”.",
    tl: "Summary → Export → CSV (para sa Sheets/Excel) o PDF (pang-print). O sabihin “export today report pdf”.",
    link: { label: "Open Summary", route: { name: "summary" } },
  },
  {
    id: "backup",
    keys: ["backup", "back up", "save data", "lost phone", "nawala", "transfer phone", "new phone", "bagong phone", "import", "restore backup"],
    en: "Settings → “Export all data” saves one backup file — keep it somewhere off this phone (Google Drive, Messenger to yourself). On a new phone: Settings → “Import backup”. I’ll remind you when your last backup is over a week old.",
    tl: "Settings → “Export all data” para mag-save ng backup file — itago sa labas ng phone (Drive o i-send sa sarili). Sa bagong phone: Settings → “Import backup”.",
    link: { label: "Open Settings", route: { name: "settings" } },
    try: ["Back up now"],
  },
  {
    id: "menu",
    keys: ["menu", "edit menu", "price", "change price", "add item to menu", "reorder", "nickname", "alias", "category", "presyo"],
    en: "Settings → Menu: tap an item to change its name, price or nicknames, drag ⋮⋮ to reorder, “+” to add a category. Or say “change the price of mami to 55” or “add tapsilog to the menu for 95”.",
    tl: "Settings → Menu: pindutin ang item para palitan ang pangalan, presyo o palayaw; i-drag para ayusin. O sabihin “palitan ang presyo ng mami 55”.",
    link: { label: "Open the menu editor", route: { name: "menu" } },
  },
  {
    id: "hours",
    keys: ["working hours", "hours", "business day", "midnight", "after midnight", "open time", "close time", "oras"],
    en: "Settings → Working hours. Sales after midnight count toward the same night, and the day rolls over halfway through your closed hours. Or say “set hours 5pm to 2am”.",
    tl: "Settings → Working hours. Ang benta pagkalipas ng hatinggabi ay kasama sa parehong gabi.",
    link: { label: "Open Settings", route: { name: "settings" } },
  },
  {
    id: "name",
    keys: ["business name", "store name", "stall name", "letterhead", "pangalan ng tindahan"],
    en: "Settings → Business name. It appears at the top of the app and as the letterhead on reports.",
    link: { label: "Open Settings", route: { name: "settings" } },
  },
  {
    id: "theme",
    keys: ["theme", "dark mode", "light mode", "dark", "light", "brightness", "kulay"],
    en: "Settings → Theme: Dark, Light or Auto. Or say “light mode”.",
    link: { label: "Open Settings", route: { name: "settings" } },
  },
  {
    id: "voice",
    keys: ["voice", "talk", "talk mode", "mic", "microphone", "speak", "hands free", "salita", "magsalita", "boses"],
    en: "Tap the mic in Ask to say one thing, or open Talk mode (the waveform button in Ask) for a hands-free conversation — I listen, answer out loud, and listen again. Voice needs internet on Android; typing always works offline.",
    tl: "Pindutin ang mic sa Ask para magsalita, o buksan ang Talk mode para tuloy-tuloy na usapan — makikinig ako, sasagot, at makikinig ulit. Kailangan ng internet ang voice; ang pag-type ay gumagana kahit offline.",
    link: { label: "Start Talk mode", route: { name: "talk" } },
  },
  {
    id: "offline",
    keys: ["offline", "internet", "no signal", "walang signal", "data", "wifi", "load"],
    en: "Everything works offline — orders, payments, reports and me. Only voice recognition needs internet (Google’s speech service on Android).",
    tl: "Gumagana lahat kahit walang internet — order, bayad, report at ako. Ang voice lang ang nangangailangan ng internet.",
  },
  {
    id: "privacy",
    keys: ["privacy", "where is my data", "data stored", "safe", "secure", "who can see", "terms"],
    en: "Your data stays on this phone only — nothing is sent anywhere. That’s also why backups matter. See Settings → Privacy Policy.",
    tl: "Nasa phone mo lang ang data — walang ipinapadala kahit saan. Kaya mahalaga ang backup.",
    link: { label: "Read the Privacy Policy", route: { name: "legal", doc: "privacy" } },
  },
  {
    id: "install",
    keys: ["install", "update", "home screen", "app icon", "new version", "icon"],
    en: "In Chrome, open the menu ⋮ → “Install app” / “Add to Home screen”. Updates install by themselves: close and reopen the app to get the newest version. Don’t uninstall to update — uninstalling can delete your data.",
    tl: "Sa Chrome, ⋮ → “Install app”. Kusang nag-a-update: isara at buksan ulit ang app. Huwag i-uninstall para mag-update — puwedeng mabura ang data.",
    link: { label: "What’s new", route: { name: "changelog" } },
  },
  {
    id: "chat",
    keys: ["clear chat", "delete chat", "chat history", "conversation"],
    en: "Your recent chat is saved on this phone so you can scroll back. Tap the trash icon at the top of Ask to clear it.",
  },
];

const HOWTO_RE =
  /\b(how (?:do|can|to|does|should|would)|paano|pano|papaano|where (?:is|are|do|can|can i)|wheres|saan|nasaan|can i|could i|pwede ba|puwede ba|pwede bang|puwede bang|is there a way|explain|tutorial|teach me|turuan mo|i want to learn)\b/;

const ARTICLES = /\b(a|an|the|ang|yung|ng|my|ko|mo|po|ba|na|naman|i|we|you|to|do|can|how|paano|pano)\b/g;

/** Words many topics share; a specific word (gcash, utang…) should win over these. */
const GENERIC = new Set(["pay", "paid", "order", "menu", "cash", "change", "data", "price", "sales", "summary", "report", "history", "undo", "available", "table", "hours", "icon", "update", "dark", "light", "net", "income", "earnings", "kita"]);

function scoreTopic(t: Topic, norm: string): number {
  let score = 0;
  const padded = ` ${norm.replace(ARTICLES, " ").replace(/\s+/g, " ").trim()} `;
  const full = ` ${norm} `;
  for (const k of t.keys) if (padded.includes(` ${k} `) || full.includes(` ${k} `)) score += GENERIC.has(k) ? 0.6 : k.split(" ").length + 0.5;
  return score;
}

/** A how-to answer when the message reads like a question about using the app. */
export function howTo(norm: string, raw: string): Topic | null {
  const asked = HOWTO_RE.test(norm) || HOWTO_RE.test(raw.toLowerCase());
  if (!asked) return null;
  let best: Topic | null = null;
  let bestScore = 0;
  for (const t of TOPICS) {
    const s = scoreTopic(t, norm);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return bestScore >= 1 ? best : null;
}

// ---------- small talk ----------

export interface Chat {
  en: string;
  tl: string;
  /** Append a quick status line (sales so far, open tables). */
  status?: boolean;
}

const JOKES: [string, string][] = [
  ["Why did the pares go to school? To become a little more “sabaw-ified”. …Okay, I’ll stick to taking orders.", "Bakit malungkot ang siomai? Kasi lagi siyang naiipit sa steamer. …Sige, orders na lang ako."],
  ["What do you call a sleepy mami? Mami-ga-gabi. I’m better at math than jokes!", "Anong tawag sa mami na puyat? Mami-ga-gabi. Mas magaling ako sa kwenta kaysa sa biro!"],
];

export function smallTalk(norm: string, raw: string, hour: number): Chat | null {
  const t = norm;
  const short = t.split(" ").length <= 6;
  const greet = hour < 12 ? ["Good morning", "Magandang umaga"] : hour < 18 ? ["Good afternoon", "Magandang hapon"] : ["Good evening", "Magandang gabi"];

  if (/^(hi|hello|hey|hiya|yo|uy|oy|oi|hoy|good (morning|afternoon|evening|night)|magandang (umaga|hapon|gabi)|kumusta|kamusta|musta|helo|halo)\b/.test(t) && short && !/\b(benta|sales|sold)\b/.test(t)) {
    if (/\b(ka|kayo|you)\b/.test(t)) return { en: "I’m doing great, thanks for asking! Ready to take orders.", tl: "Ayos lang ako, salamat! Handa na akong tumanggap ng order.", status: true };
    return { en: `${greet[0]}! I’m here.`, tl: `${greet[1]}! Nandito ako.`, status: true };
  }
  if (/\b(how are you|how r u|kumusta ka|kamusta ka|musta ka|how you doing)\b/.test(t)) {
    return { en: "I’m doing great, thanks for asking! Ready to take orders.", tl: "Ayos lang ako, salamat sa pagtatanong! Handa na ako.", status: true };
  }
  if (/\b(thanks|thank you|salamat|ty|thx|tnx|maraming salamat|thank u)\b/.test(t) && short) {
    return { en: "You’re welcome! Anything else?", tl: "Walang anuman! May iba pa ba?" };
  }
  if (/\b(good job|great job|nice one|galing|ang galing|astig|husay|well done|you are the best|the best ka|youre the best|good work)\b/.test(t)) {
    return { en: "Thank you! Let’s keep the orders coming. 😊", tl: "Salamat! Tuloy-tuloy lang ang order. 😊" };
  }
  if (/\b(tired|pagod|inaantok|antok|sleepy|exhausted|hirap)\b/.test(t)) {
    return { en: "You’re doing great — hang in there! Here’s how tonight is going:", tl: "Kaya mo ’yan! Konting tiis na lang. Eto ang lagay ngayong gabi:", status: true };
  }
  if (/\b(joke|biro|patawa|funny|tell me something)\b/.test(t)) {
    const j = JOKES[Math.floor((hour * 7 + t.length) % JOKES.length)]!;
    return { en: j[0], tl: j[1] };
  }
  if (/\b(who made you|who built you|who created you|sino gumawa|sino ang gumawa|gumawa sayo)\b/.test(t)) {
    return { en: "I was built into Order Board for this stall. I run entirely on this phone — no internet, no account.", tl: "Ginawa ako para sa Order Board ng stall na ito. Tumatakbo ako sa phone mismo — walang internet, walang account." };
  }
  if (/\b(are you there|you there|nandyan ka|nandiyan ka|andyan ka|gising ka)\b/.test(t)) {
    return { en: "I’m here! What do you need?", tl: "Nandito ako! Ano’ng kailangan mo?" };
  }
  if (/^(bye|goodbye|good night|goodnight|see you|paalam|ingat|sige na|sige bye|tulog na)\b/.test(t) && short) {
    return { en: "Good work tonight! Here’s where we ended up:", tl: "Salamat sa sipag ngayong gabi! Eto ang naging benta:", status: true };
  }
  if (/\b(i love you|love you|mahal kita|crush kita)\b/.test(t)) {
    return { en: "Aww! I love a busy night of orders. 💛", tl: "Ay, kinikilig ako! Pero mas mahal ko ang maraming order. 💛" };
  }
  if (/\b(your name|ano pangalan mo|anong pangalan mo|who are you|what are you|sino ka|ano ka)\b/.test(t)) {
    return {
      en: "I’m Ask Agent, Order Board’s assistant. I take orders, manage bills, track utang and expenses, and answer questions about your sales — all on this phone.",
      tl: "Ako si Ask Agent, ang katulong ng Order Board. Kumukuha ako ng order, nag-aasikaso ng bill, utang at gastos, at sumasagot tungkol sa benta — dito lang sa phone.",
    };
  }
  if (/^(sorry|pasensya|pasensiya|my bad|oops sorry)\b/.test(t) && short) {
    return { en: "No worries at all!", tl: "Okay lang ’yan!" };
  }
  if (/^(haha|hahaha|lol|hehe|hihi|xd)\b/.test(t) && short) {
    return { en: "😄", tl: "😄" };
  }
  if (/^(nice|cool|great|awesome|ayos|sige|okay sige|noted|got it|gets|copy)$/.test(t)) {
    return { en: "👍 Anything else?", tl: "👍 May iba pa ba?" };
  }
  void raw;
  return null;
}
