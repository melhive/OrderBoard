// Turns free-form order phrases into menu items.
//
//   "2 pares with egg and rice, a water"  ->  2× Pares w/ Egg & Rice, 1× Water
//   "siomai with rice"                     ->  1× Siomai, 1× Rice   (no combined item exists)
//   "paris w egg"                          ->  1× Pares w/ Egg      (speech mishearing)
//
// Approach: split on hard separators and quantities into chunks, then use
// dynamic programming to segment each chunk into spans, scoring each span
// against every menu item by fuzzy token-set overlap. The best-scoring
// segmentation wins, so "and"/"with" are only treated as separators when
// no single menu item explains the words better.

import type { MenuCategory } from "../data/types";
import {
  PHRASE_SYNONYMS,
  TOKEN_SYNONYMS,
  isNumberToken,
  normalize,
  stem,
  tokenSimilarity,
  tokenize,
  wordsToNumbers,
} from "./text";

export interface MenuEntry {
  id: number;
  catId: number;
  cat: string;
  name: string;
  price: number;
  /** Token lists for the name and each alias. */
  variants: string[][];
}

export interface MenuIndex {
  entries: MenuEntry[];
  vocab: Set<string>;
  catTokens: Map<string, number>;
}

export interface ParsedLine {
  item: MenuEntry;
  qty: number;
  /** 0..1: how exactly the words matched the menu name. */
  confidence: number;
  heard: string;
}

export interface ParseResult {
  lines: ParsedLine[];
  unknown: string[];
  /** Unknown phrases with the quantity said for them ("2 halo halo"). */
  unknownItems: { text: string; qty: number; explicitQty: boolean }[];
}

/** Words that carry no meaning for item matching. */
export const FILLER = new Set([
  "the", "of", "order", "orders", "please", "pls", "plz", "po", "add", "also", "for", "to", "on", "at", "in",
  "some", "get", "give", "me", "us", "i", "we", "want", "wants", "would", "like", "can", "could", "have", "has",
  "may", "need", "put", "more", "extra", "piece", "pieces", "pc", "pcs", "serving", "servings", "plate", "plates",
  "bowl", "bowls", "glass", "glasses", "bottle", "bottles", "cup", "cups", "order", "um", "uh", "uhm", "ah",
  "okay", "ok", "just", "lang", "then", "too", "x", "times", "each", "of", "one", "ones", "kindly", "yes", "now",
  "it", "them", "that", "this", "is", "are", "be", "will", "let", "make", "do", "pesos", "peso", "php", "from",
  // Filipino particles and fillers
  "ang", "na", "ng", "nang", "yung", "ung", "iyong", "mga", "sa", "po", "pa", "pang", "pong", "nga", "naman", "ba",
  "ko", "mo", "natin", "namin", "din", "rin", "nalang", "paki", "pakibigay", "bigyan", "bigay", "isang", "kay",
]);
const SOFT = new Set(["and", "with", "n", "w"]);
const HARD = new Set([",", "plus", "then", "also", "tsaka", "next"]);
const NEGATORS = new Set(["without", "no", "minus", "hold"]);
const QTY_WORDS: Record<string, number> = { a: 1, an: 1, another: 1, single: 1, couple: 2, pair: 2, dozen: 12, both: 2 };

const EXTRA_PENALTY = 0.6;
const MISSING_PENALTY = 0.7;
const SEGMENT_PENALTY = 0.5;
const IMPLICIT_SPLIT_PENALTY = 0.3;
const NEGATIVE_PENALTY = 1.5;
const MIN_SEGMENT_SCORE = 0.3;

/** Shared pipeline used for both user input and menu names, so they compare like-for-like. */
export function prepareTokens(input: string): string[] {
  let s = normalize(input);
  for (const [re, rep] of PHRASE_SYNONYMS) s = s.replace(re, rep);
  return wordsToNumbers(tokenize(s)).map((t) => TOKEN_SYNONYMS[t] ?? t);
}

function contentTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !FILLER.has(t) && !SOFT.has(t) && !HARD.has(t) && !isNumberToken(t) && !(t in QTY_WORDS));
}

export function buildMenuIndex(menu: MenuCategory[]): MenuIndex {
  const entries: MenuEntry[] = [];
  const vocab = new Set<string>();
  const catTokens = new Map<string, number>();
  for (const c of menu) {
    for (const t of contentTokens(prepareTokens(c.cat))) catTokens.set(stem(t), c.id);
    for (const it of c.items) {
      const variants = [it.name, ...(it.aliases ?? [])]
        .map((n) => contentTokens(prepareTokens(n)))
        .filter((v) => v.length > 0);
      variants.forEach((v) => v.forEach((t) => vocab.add(stem(t))));
      entries.push({ id: it.id, catId: c.id, cat: c.cat, name: it.name, price: it.price, variants });
    }
  }
  return { entries, vocab, catTokens };
}

/** Joins adjacent tokens when together they form a menu word ("soft drinks" -> "softdrinks"). */
function mergeCompounds(tokens: string[], vocab: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1];
    if (b && !vocab.has(stem(a)) && vocab.has(stem(a + b))) {
      out.push(a + b);
      i++;
    } else out.push(a);
  }
  return out;
}

interface Match {
  entry: MenuEntry;
  score: number;
  confidence: number;
}

function scoreAgainst(span: string[], variant: string[], negatives: string[]): { score: number; confidence: number; matched: number } {
  const pairs: { i: number; j: number; s: number }[] = [];
  span.forEach((q, i) =>
    variant.forEach((m, j) => {
      const s = tokenSimilarity(q, m);
      if (s > 0) pairs.push({ i, j, s });
    }),
  );
  pairs.sort((a, b) => b.s - a.s);
  const usedI = new Set<number>();
  const usedJ = new Set<number>();
  let sum = 0;
  for (const p of pairs) {
    if (usedI.has(p.i) || usedJ.has(p.j)) continue;
    usedI.add(p.i);
    usedJ.add(p.j);
    sum += p.s;
  }
  const extra = span.length - usedI.size;
  const missing = variant.length - usedJ.size;
  let score = sum - EXTRA_PENALTY * extra - MISSING_PENALTY * missing;
  for (const n of negatives) if (variant.some((m) => tokenSimilarity(n, m) >= 0.8)) score -= NEGATIVE_PENALTY;
  return { score, confidence: sum / Math.max(span.length, variant.length), matched: usedI.size };
}

function bestMatch(span: string[], index: MenuIndex, negatives: string[]): Match | null {
  let best: Match | null = null;
  for (const entry of index.entries) {
    for (const v of entry.variants) {
      const r = scoreAgainst(span, v, negatives);
      if (r.matched === 0) continue;
      if (!best || r.score > best.score + 1e-9 || (Math.abs(r.score - best.score) < 1e-9 && v.length < best.entry.variants[0]!.length)) {
        best = { entry, score: r.score, confidence: r.confidence };
      }
    }
  }
  return best;
}

interface Chunk {
  qty: number | null;
  tokens: string[];
  negatives: string[];
}

function chunkTokens(tokens: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Chunk = { qty: null, tokens: [], negatives: [] };
  const hasContent = (c: Chunk) => contentTokens(c.tokens).length > 0;
  const flush = () => {
    if (cur.tokens.length || cur.qty !== null) chunks.push(cur);
    cur = { qty: null, tokens: [], negatives: [] };
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if (HARD.has(t)) {
      flush();
      continue;
    }
    // Postfix quantity: "pares x 2", "siomai times 3"
    if ((t === "x" || t === "times") && isNumberToken(next) && hasContent(cur)) {
      cur.qty = Math.min(99, parseInt(next!, 10));
      i++;
      flush();
      continue;
    }
    const isQty = (isNumberToken(t) && parseFloat(t) >= 1 && parseFloat(t) <= 99 && Number.isInteger(parseFloat(t))) || t in QTY_WORDS;
    if (isQty) {
      if (hasContent(cur)) {
        // "pares 2 mami": a number after content starts a new item; "and 2 waters" too.
        while (cur.tokens.length && SOFT.has(cur.tokens[cur.tokens.length - 1]!)) cur.tokens.pop();
        flush();
      }
      const q = isNumberToken(t) ? parseInt(t, 10) : QTY_WORDS[t]!;
      if (t === "dozen") cur.qty = (cur.qty ?? 1) * 12; // "a dozen", "2 dozen"
      else cur.qty = q;
      if (next === "of") i++;
      continue;
    }
    if (NEGATORS.has(t) && next && !FILLER.has(next) && !SOFT.has(next)) {
      cur.negatives.push(next);
      i++;
      continue;
    }
    cur.tokens.push(t);
  }
  flush();
  return chunks;
}

interface Seg {
  start: number;
  end: number;
  boundary: "start" | "and" | "with" | "implicit";
  match: Match | null;
  content: string[];
}

function segmentChunk(chunk: Chunk, index: MenuIndex): Seg[] {
  const toks = chunk.tokens;
  const n = toks.length;
  const dp: { score: number; segs: Seg[] }[] = Array.from({ length: n + 2 }, () => ({ score: -Infinity, segs: [] }));
  dp[0] = { score: 0, segs: [] };
  const cache = new Map<string, Match | null>();
  for (let i = 0; i < n; i++) {
    if (dp[i]!.score === -Infinity) continue;
    const prevSoft = i > 0 && SOFT.has(toks[i - 1]!) ? (toks[i - 1] === "and" || toks[i - 1] === "n" ? "and" : "with") : null;
    const boundary: Seg["boundary"] = i === 0 ? "start" : prevSoft ?? "implicit";
    // A segment never starts on a soft word: skip it instead.
    if (SOFT.has(toks[i]!)) {
      if (dp[i]!.score > dp[i + 1]!.score) dp[i + 1] = { score: dp[i]!.score, segs: dp[i]!.segs };
      continue;
    }
    for (let j = i + 1; j <= n; j++) {
      if (SOFT.has(toks[j - 1]!)) continue; // segments end on content
      const span = toks.slice(i, j);
      const content = contentTokens(span);
      const key = `${i}:${j}`;
      let match: Match | null;
      if (cache.has(key)) match = cache.get(key)!;
      else {
        match = content.length ? bestMatch(content, index, chunk.negatives) : null;
        cache.set(key, match);
      }
      let segScore: number;
      if (!content.length) segScore = 0;
      else if (!match || match.score < MIN_SEGMENT_SCORE) segScore = -1 - 0.1 * content.length;
      else segScore = match.score - SEGMENT_PENALTY;
      if (boundary === "implicit" && content.length) segScore -= IMPLICIT_SPLIT_PENALTY;
      const total = dp[i]!.score + segScore;
      // Next segment may start right after j, or after a soft word at j.
      const seg: Seg = { start: i, end: j, boundary, match: match && match.score >= MIN_SEGMENT_SCORE ? match : null, content };
      if (total > dp[j]!.score) dp[j] = { score: total, segs: [...dp[i]!.segs, seg] };
    }
  }
  return dp[n]!.segs.filter((s) => s.content.length);
}

export function parseItems(tokens: string[], index: MenuIndex): ParseResult {
  const merged = mergeCompounds(tokens, index.vocab);
  const lines: ParsedLine[] = [];
  const unknown: string[] = [];
  const unknownItems: ParseResult["unknownItems"] = [];
  for (const chunk of chunkTokens(merged)) {
    const segs = segmentChunk(chunk, index);
    let prevQty = chunk.qty ?? 1;
    segs.forEach((seg, k) => {
      const qty = k === 0 ? chunk.qty ?? 1 : seg.boundary === "with" ? prevQty : 1;
      prevQty = qty;
      const heard = chunk.tokens.slice(seg.start, seg.end).join(" ");
      if (!seg.match) {
        unknown.push(seg.content.join(" "));
        unknownItems.push({ text: seg.content.join(" "), qty, explicitQty: k === 0 && chunk.qty !== null });
        return;
      }
      const existing = lines.find((l) => l.item.id === seg.match!.entry.id);
      if (existing) existing.qty += qty;
      else lines.push({ item: seg.match.entry, qty, confidence: seg.match.confidence, heard });
    });
  }
  return { lines, unknown, unknownItems };
}

/** Finds a single menu item named in a phrase (for price questions, menu edits). */
export function findMenuItem(phrase: string | string[], index: MenuIndex): (Match & { heard: string }) | null {
  const toks = Array.isArray(phrase) ? phrase : prepareTokens(phrase);
  const content = contentTokens(mergeCompounds(toks, index.vocab));
  if (!content.length) return null;
  const m = bestMatch(content, index, []);
  if (!m || m.score < MIN_SEGMENT_SCORE) return null;
  return { ...m, heard: content.join(" ") };
}

/** Finds a category named in a phrase ("drinks", "add-ons"). */
export function findCategory(tokens: string[], index: MenuIndex): number | null {
  for (const t of tokens) {
    const id = index.catTokens.get(stem(t));
    if (id !== undefined) return id;
  }
  return null;
}

/** Closest menu names to an unknown phrase, for "did you mean" suggestions. */
export function suggestItems(phrase: string, index: MenuIndex, limit = 3): MenuEntry[] {
  const content = contentTokens(prepareTokens(phrase));
  if (!content.length) return [];
  return index.entries
    .map((e) => ({ e, s: Math.max(...e.variants.map((v) => scoreAgainst(content, v, []).confidence)) }))
    .filter((x) => x.s > 0.2)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);
}
