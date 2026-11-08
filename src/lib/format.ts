export function peso(n: number): string {
  return "₱" + Math.round(n).toLocaleString("en-PH");
}

export function pad2(n: number): string {
  return (n < 10 ? "0" : "") + n;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad2(m)} ${ampm}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDayLabel(d: Date): string {
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtLongDate(d: Date): string {
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

export function plural(n: number, word: string, pluralWord = word + "s"): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** 4-character code with no look-alike characters (no O/0, I/1/L). */
export function generateVerifyCode(random: () => number = Math.random): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(random() * chars.length));
  return code;
}
