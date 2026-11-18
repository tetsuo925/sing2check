/** 3 桁ごとに空白で区切る: 48000 → "48 000" */
export function groupDigits(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** dBFS の表示: −50 */
export function dbLabel(db: number): string {
  return `${db < 0 ? "−" : ""}${Math.abs(db)}dBFS`;
}

/** ISO の日時 → "11/20 19:12"（端末の時刻） */
export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** 周波数 → 音名（英字。階名と混ざらないように）とセント */
export function noteNameOf(hz: number): { name: string; cents: number } {
  const exact = 69 + 12 * Math.log2(hz / 440);
  const midi = Math.round(exact);
  return { name: `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`, cents: Math.round((exact - midi) * 100) };
}
