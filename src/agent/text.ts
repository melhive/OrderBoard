// Text utilities for the offline agent: normalization, number words,
// stemming, fuzzy and phonetic token similarity.

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

/** Lowercase, expand shorthand, strip punctuation. Keeps "," as its own token. */
export function normalize(input: string): string {
  let s = ` ${input.toLowerCase()} `;
  s = s.replace(/[‘’‛`´]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/\bw\/o\b/g, " without ").replace(/\bw\//g, " with ").replace(/\bw\s+(?=[a-z])/g, " with ");
  s = s.replace(/&/g, " and ").replace(/\+/g, " plus ");
  s = s.replace(/₱\s*(\d)/g, "$1").replace(/\bphp\s*(\d)/g, "$1");
  s = s.replace(/(\d),(\d{3})\b/g, "$1$2"); // 1,000 -> 1000
  s = s.replace(/\b(\d+)\s*x\b/g, "$1 x ").replace(/\bx\s*(\d+)\b/g, " x $1"); // 2x / x2
  s = s.replace(/#\s*(\d+)/g, " number $1 ");
  s = s.replace(/'s\b/g, "").replace(/n't\b/g, " not").replace(/'re\b/g, " are").replace(/'ll\b/g, " will").replace(/'m\b/g, " am").replace(/'d\b/g, " would").replace(/'ve\b/g, " have");
  s = s.replace(/'/g, "");
  s = s.replace(/[.!?;:]+(?=\s|$)/g, " ");
  s = s.replace(/,/g, " , ");
  s = s.replace(/[^a-z0-9.,\s-]/g, " ").replace(/(?<![a-z0-9])-|-(?![a-z0-9])/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function tokenize(s: string): string[] {
  return s ? s.split(" ").filter(Boolean) : [];
}

/** Converts spelled-out numbers to digits: "twenty five" -> "25", "five hundred" -> "500". */
export function wordsToNumbers(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (!(t in UNITS) && !(t in TENS) && !(t === "hundred" && out.length) && !(t === "thousand" && out.length)) {
      if (t in ORDINALS) out.push(String(ORDINALS[t]));
      else out.push(t);
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let consumed = 0;
    while (i < tokens.length) {
      const w = tokens[i]!;
      if (w in UNITS) current += UNITS[w]!;
      else if (w in TENS) current += TENS[w]!;
      else if (w === "hundred") current = (current || 1) * 100;
      else if (w === "thousand") {
        total += (current || 1) * 1000;
        current = 0;
      } else if (w === "and" && consumed && tokens[i + 1] && (tokens[i + 1]! in UNITS || tokens[i + 1]! in TENS) && /hundred|thousand/.test(tokens[i - 1] ?? "")) {
        // "five hundred and fifty"
      } else break;
      consumed++;
      i++;
      // Don't glue "two three" into one number; only valid compounds continue.
      const nextW = tokens[i];
      if (!nextW) break;
      const isUnitNow = w in UNITS;
      if (isUnitNow && (nextW in UNITS || nextW in TENS)) break;
      if (w in TENS && nextW in TENS) break;
    }
    out.push(String(total + current));
  }
  return out;
}

export function isNumberToken(t: string | undefined): boolean {
  return !!t && /^\d+(\.\d+)?$/.test(t);
}

export function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && /(ch|sh|x|ss|o)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Rough sound-alike key so speech-recognition spellings still match (paris→pares, mommy→mami). */
export function phoneticKey(t: string): string {
  let s = t.toLowerCase().replace(/[^a-z]/g, "");
  s = s.replace(/ph/g, "f").replace(/ck/g, "k").replace(/sh/g, "s").replace(/ch/g, "s").replace(/q/g, "k")
    .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/z/g, "s").replace(/x/g, "ks").replace(/w/g, "")
    .replace(/h/g, "").replace(/y/g, "i");
  const first = s.charAt(0);
  const rest = s.slice(1).replace(/[aeiou]/g, "");
  return (first + rest).replace(/(.)\1+/g, "$1");
}

/** Similarity between a spoken/typed token and a menu token, 0..1. */
export function tokenSimilarity(q: string, m: string): number {
  if (q === m) return 1;
  const sq = stem(q);
  const sm = stem(m);
  if (sq === sm) return 1;
  if (isNumberToken(q) || isNumberToken(m)) return 0;
  const minLen = Math.min(sq.length, sm.length);
  // Mishearings and typos almost always keep the first sound; requiring it
  // stops false matches like "price" ~ "rice".
  if (sq[0] !== sm[0] && phoneticKey(sq)[0] !== phoneticKey(sm)[0]) return 0;
  if (minLen >= 4) {
    const d = levenshtein(sq, sm);
    if (d === 1) return 0.85;
    if (d === 2 && minLen >= 7) return 0.75;
  }
  if (minLen >= 4 && phoneticKey(sq) === phoneticKey(sm) && phoneticKey(sq).length >= 2) return 0.8;
  // Clipped words: "eg" -> "egg", "sio" won't (too far), "softdrink" handled by stem.
  if (sq.length >= 2 && sm.startsWith(sq) && sm.length - sq.length === 1) return 0.7;
  return 0;
}

/** Known speech-recognition mishearings and synonyms, applied token by token. */
export const TOKEN_SYNONYMS: Record<string, string> = {
  paris: "pares", pairs: "pares", parez: "pares", parish: "pares", paddies: "pares",
  mommy: "mami", mummy: "mami", mommies: "mami", mamie: "mami", mommie: "mami", mamy: "mami",
  pastel: "pastil", pistol: "pastil", pastille: "pastil", pastils: "pastil",
  shumai: "siomai", shomai: "siomai", siomay: "siomai", shumay: "siomai", siumai: "siomai", somai: "siomai",
  eggs: "egg", itlog: "egg", rices: "rice", kanin: "rice",
  sodas: "soda", cokes: "coke", tubig: "water",
  drinks: "drink", beverage: "drink",
  // Filipino numbers (with and without the -ng linker)
  isa: "1", isang: "1", dalawa: "2", dalawang: "2", tatlo: "3", tatlong: "3", apat: "4", lima: "5", limang: "5",
  anim: "6", pito: "7", pitong: "7", walo: "8", walong: "8", siyam: "9", sampu: "10", sampung: "10",
  // Filipino / Taglish intent words, mapped to the English words the engine understands
  dagdag: "add", dagdagan: "add", idagdag: "add", lagyan: "add", lagay: "add", ilagay: "add", pakidagdag: "add",
  tanggalin: "remove", alisin: "remove", tanggal: "remove", alis: "remove", bawasan: "remove", bawas: "remove", ibawas: "remove",
  kanselahin: "cancel", linisin: "clear",
  lipat: "move", ilipat: "move",
  bayad: "paid", nagbayad: "paid", bayaran: "pay", magbabayad: "pay",
  sukli: "change", panukli: "change",
  nabenta: "sold", naibenta: "sold", nabili: "sold",
  kahapon: "yesterday", ngayon: "today", ngayong: "today",
  ilan: "how", anong: "what", ano: "what", meron: "have", mayroon: "have", lahat: "all",
  para: "for", mesa: "table",
  // Money, utang, serving, stock
  gastos: "expense", gasto: "expense", nagastos: "expense", ginastos: "expense", gastusin: "expense",
  bumili: "bought", binili: "bought", pinamili: "bought",
  tubo: "profit", ganansya: "profit",
  ilista: "utang", lista: "utang", listahan: "utang", inutang: "utang", umutang: "utang",
  paymaya: "maya", gcashed: "gcash",
  naserve: "served", "na-serve": "served", "nai-serve": "served", naiserve: "served", naihain: "served", nahain: "served", inihain: "served", hain: "served", ihain: "served",
  ubos: "soldout", naubos: "soldout", soldout: "soldout",
  // Bisaya (Cebuano), for taking orders: numbers, "og/ug" (and), "naay" (with),
  // "buok" (pieces), "dugang/dugangi" (add). Replies stay English/Taglish.
  usa: "1", duha: "2", tulo: "3", upat: "4", unom: "6", napulo: "10",
  og: "and", ug: "and", naay: "with", adunay: "with", buok: "piece", kanon: "rice",
  dugang: "add", dugangi: "add", idugang: "add", dugangan: "add",
  lamesa: "table",
};

/** Multi-word mishearings and Taglish phrases, applied on the normalized string. */
export const PHRASE_SYNONYMS: [RegExp, string][] = [
  [/\bmagkano\b/g, "how much"],
  [/\bilan\b/g, "how many"],
  [/\b(?:ngayong|ngayon na) araw\b|\bngayong gabi\b|\bngayon\b/g, "today"],
  [/\b(?:ngayong|itong|nitong) linggo\b/g, "this week"],
  [/\b(?:ngayong|itong|nitong) buwan\b/g, "this month"],
  [/\bnoong isang linggo\b|\bnakaraang linggo\b/g, "last week"],
  [/\bnakaraang buwan\b/g, "last month"],
  [/\bpa-?order\b|\bpaorder\b|\bpa-?add\b/g, "order"],
  // Taglish verb forms: "mag-backup", "i-print", "nag-order", "mag-utang" → the English word.
  [/\b(?:mag|nag|pag|i|ipa|maka|naka|pinag)-(?=[a-z]{3,})/g, ""],
  // "usa pa ka pastil" = one more pastil (an item named); bare "isa pa" = one more of the last.
  [/\b(?:isa|usa) pa ka\b/g, "1"],
  [/\b(?:isa|usa) pa\b/g, "one more"],
  // Bisaya: "isa ka pares", "duha ka mami" — drop the "ka" after a number
  // (the mic often glues it on: "duhaka"). "kan-on" is rice.
  [/\b(\d+|isa|usa|duha|tulo|upat|lima|unom|pito|walo|siyam|napulo)\s?ka\b/g, "$1"],
  [/\bkan on\b|\bkan-on\b/g, "kanon"],
  [/\bnga (?:naay|adunay|may)\b/g, "with"],
  // Filipino "at" means "and" between items; keep English "at table 3".
  [/\bat\b(?! (?:table|tbl|mesa|number|\d))/g, "and"],
  [/\bshu mai\b|\bsiu mai\b|\bsio mai\b|\bsho mai\b/g, "siomai"],
  [/\bsoft drinks?\b/g, "softdrinks"],
  [/\bpa res\b|\bpar es\b/g, "pares"],
  [/\bma mi\b/g, "mami"],
  [/\btake ?out\b/g, "takeout"],
  [/\bsold[ -]out\b|\bout of stock\b/g, "soldout"],
  [/\bg[ -]cash\b/g, "gcash"],
  [/\bpay maya\b/g, "maya"],
  [/\bdine in\b/g, "dinein"],
];
