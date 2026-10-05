import type { ChartPoint, RangeKey, WeightEntry } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, amount: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

export function subtractMonths(date: Date, amount: number) {
  const copy = new Date(date);
  const originalDay = copy.getDate();
  copy.setDate(1);
  copy.setMonth(copy.getMonth() - amount);
  const daysInTargetMonth = new Date(copy.getFullYear(), copy.getMonth() + 1, 0).getDate();
  copy.setDate(Math.min(originalDay, daysInTargetMonth));
  return copy;
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(
    parseLocalDate(value)
  );
}

export function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parseLocalDate(value));
}

export function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseLocalDate(value));
}

export function getRangeStart(range: RangeKey, today: Date, entries: WeightEntry[]) {
  if (range === "ALL") {
    return entries.length ? parseLocalDate(entries[0].date) : today;
  }
  if (range === "7D") return addDays(today, -7);
  if (range === "30D") return addDays(today, -30);
  if (range === "3M") return subtractMonths(today, 3);
  if (range === "6M") return subtractMonths(today, 6);
  return subtractMonths(today, 12);
}

export function getRangeLabel(range: RangeKey) {
  const labels: Record<RangeKey, string> = {
    "7D": "LAST 7 DAYS",
    "30D": "LAST 30 DAYS",
    "3M": "LAST 3 MONTHS",
    "6M": "LAST 6 MONTHS",
    "1Y": "LAST YEAR",
    ALL: "ALL TIME",
  };
  return labels[range];
}

export function averageForWindow(entries: WeightEntry[], endDate: string) {
  const end = parseLocalDate(endDate).getTime();
  const start = end - 6 * DAY_MS;
  const values = entries
    .filter((entry) => {
      const time = parseLocalDate(entry.date).getTime();
      return time >= start && time <= end;
    })
    .map((entry) => entry.weight);
  if (!values.length) return null;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function buildChartData(entries: WeightEntry[], range: RangeKey, todayIso = localIsoDate()) {
  if (!entries.length) return [] as ChartPoint[];

  const today = parseLocalDate(todayIso);
  const start = getRangeStart(range, today, entries);
  const firstEntryDate = parseLocalDate(entries[0].date);
  const actualStart = range === "ALL" && firstEntryDate > start ? firstEntryDate : start;
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const points: ChartPoint[] = [];

  for (let cursor = new Date(actualStart); cursor <= today; cursor = addDays(cursor, 1)) {
    const date = localIsoDate(cursor);
    const entry = byDate.get(date);
    points.push({
      date,
      label: formatShortDate(date),
      weight: entry?.weight ?? null,
      sevenDayAvg: averageForWindow(entries, date),
      phase: entry?.phase ?? null,
      notes: entry?.notes ?? "",
    });
  }

  return points;
}

export function latestEntry(entries: WeightEntry[]) {
  return entries.length ? entries[entries.length - 1] : null;
}

export function selectedRangeChange(entries: WeightEntry[], range: RangeKey, todayIso = localIsoDate()) {
  const latest = latestEntry(entries);
  if (!latest || entries.length < 2) return null;

  if (range === "ALL") {
    const baseline = entries[0];
    if (baseline.date === latest.date) return null;
    return makeChange(baseline.weight, latest.weight);
  }

  const start = getRangeStart(range, parseLocalDate(todayIso), entries);
  const candidates = entries.filter((entry) => parseLocalDate(entry.date) >= start && entry.date <= latest.date);
  if (candidates.length < 2) return null;
  return makeChange(candidates[0].weight, latest.weight);
}

function makeChange(startWeight: number, currentWeight: number) {
  const pounds = round2(currentWeight - startWeight);
  const percent = round2((pounds / startWeight) * 100);
  return { pounds, percent, startWeight, currentWeight };
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatWeight(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)} lb`;
}

export function formatChange(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  if (value === 0) return "0.0 lb";
  return `${value < 0 ? "↓" : "↑"} ${Math.abs(value).toFixed(1)} lb`;
}

export function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "";
  if (value === 0) return "0.0%";
  return `${value < 0 ? "↓" : "↑"} ${Math.abs(value).toFixed(1)}%`;
}
