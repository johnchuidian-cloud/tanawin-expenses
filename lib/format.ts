/**
 * Formatters — peso amounts, dates, etc. Centralised so the whole app
 * uses identical formatting and we can adjust in one place.
 */

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const pesoFormatterWithCents = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function peso(n: number, opts: { cents?: boolean } = {}): string {
  return opts.cents ? pesoFormatterWithCents.format(n) : pesoFormatter.format(n);
}

export function pesoShort(n: number): string {
  // For chart axes and tight UI — e.g., ₱65k, ₱1.2k
  if (Math.abs(n) >= 1000) return `₱${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `₱${Math.round(n)}`;
}

export function pesoSigned(n: number): string {
  const sign = n < 0 ? "-" : "+";
  return `${sign}${peso(Math.abs(n))}`;
}

export function formatDate(iso: string, opts: { withYear?: boolean } = {}): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  return opts.withYear ? `${month} ${day}, ${d.getFullYear()}` : `${month} ${day}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = formatDate(iso);
  const hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  const h12 = hours % 12 || 12;
  return `${date} · ${h12}:${mins}${ampm}`;
}

/**
 * Returns a friendly relative label: "Today", "Yesterday", or "May 12".
 */
export function relativeDate(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const diffMs = today.getTime() - d.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return formatDate(iso);
}

/** Returns YYYY-MM-DD for a Date, in local TZ. */
export function toIsoDate(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Returns YYYY-MM for a date or ISO string. */
export function toMonthKey(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

/** True if the entry occurred in the given YYYY-MM. */
export function entryInMonth(entryDate: string, monthKey: string): boolean {
  return toMonthKey(entryDate) === monthKey;
}
