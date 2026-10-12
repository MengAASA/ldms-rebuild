// The Dashboard's charts (phase 4, module 3). Pure functions over the same
// rows the reports use, so a chart and its report agree:
//
//   - A training belongs to the month it starts in (as in the reports).
//   - Hours are those that count toward a person's record (completed, training
//     not cancelled); a chart only adds them up differently.
//   - "Average per person" divides by the manpower headcount, as the
//     department report does.
//   - A period of up to two years is drawn month by month; a longer one, year
//     by year, so the columns stay readable.

import { round2 } from "./report";

export const MAX_MONTHS = 24;
/** How many are listed in each "top" card. */
export const TOP = 5;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type BucketUnit = "month" | "year";

export type Bucket = {
  /** "2026-03" for a month, "2026" for a year. */
  key: string;
  /** Axis label: "Mar", or "2026". */
  label: string;
  /** For narrow screens: "M", or "26". */
  short: string;
  /** In full: "March 2026", or "2026". */
  title: string;
  /** The year it falls in, to group months when a period covers more than one. */
  year: number;
  /** It hasn't begun yet: drawn as an empty slot. */
  future: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The columns a period is drawn in: its months, or its years when it is longer than MAX_MONTHS. */
export function periodBuckets(period: { from: string; to: string }, today: Date): { unit: BucketUnit; buckets: Bucket[] } {
  const [fy, fm] = [Number(period.from.slice(0, 4)), Number(period.from.slice(5, 7))];
  const [ty, tm] = [Number(period.to.slice(0, 4)), Number(period.to.slice(5, 7))];
  const thisMonth = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}`;
  const months = (ty - fy) * 12 + (tm - fm) + 1;
  if (months > MAX_MONTHS) {
    const buckets: Bucket[] = [];
    for (let y = fy; y <= ty; y++)
      buckets.push({ key: String(y), label: String(y), short: String(y).slice(2), title: String(y), year: y, future: y > today.getUTCFullYear() });
    return { unit: "year", buckets };
  }
  const buckets: Bucket[] = [];
  for (let i = 0; i < Math.max(1, months); i++) {
    const y = fy + Math.floor((fm - 1 + i) / 12);
    const m = (fm - 1 + i) % 12;
    const key = `${y}-${pad(m + 1)}`;
    buckets.push({ key, label: MONTHS[m].slice(0, 3), short: MONTHS[m][0], title: `${MONTHS[m]} ${y}`, year: y, future: key > thisMonth });
  }
  return { unit: "month", buckets };
}

/** The bucket a date falls in. */
export function bucketKey(date: Date, unit: BucketUnit): string {
  return unit === "year" ? String(date.getUTCFullYear()) : `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/** Hours for each bucket, split by series (e.g. training type): one row per bucket, one number per series. */
export function stackHours<S extends string>(
  buckets: Bucket[],
  unit: BucketUnit,
  series: readonly S[],
  rows: { date: Date; series: S; hours: number }[],
): number[][] {
  const at = new Map(buckets.map((b, i) => [b.key, i]));
  const out = buckets.map(() => series.map(() => 0));
  for (const r of rows) {
    const b = at.get(bucketKey(r.date, unit));
    const s = series.indexOf(r.series);
    if (b !== undefined && s >= 0) out[b][s] += r.hours;
  }
  return out.map((values) => values.map(round2));
}

/** An amount for each bucket (e.g. course cost). */
export function sumByBucket(buckets: Bucket[], unit: BucketUnit, rows: { date: Date; amount: number }[]): number[] {
  const at = new Map(buckets.map((b, i) => [b.key, i]));
  const out = buckets.map(() => 0);
  for (const r of rows) {
    const b = at.get(bucketKey(r.date, unit));
    if (b !== undefined) out[b] += r.amount;
  }
  return out.map(round2);
}

/** Hours per head; 0 when there is no one to divide by. */
export function perHead(hours: number, headcount: number): number {
  return headcount > 0 ? round2(hours / headcount) : 0;
}

/** The people with the most hours, most first; no one without hours. Ties: more trainings, then by name. */
export function topByHours<T extends { hours: number; completed: number; name: string }>(rows: T[], take = TOP): T[] {
  return rows
    .filter((r) => r.hours > 0)
    .sort((a, b) => b.hours - a.hours || b.completed - a.completed || a.name.localeCompare(b.name))
    .slice(0, take);
}

export type TrainerTotal = { trainings: number; hours: number };

/**
 * What each in-house trainer gave: the trainings they ran and those
 * trainings' hours (a training's own hours, however many attended), as the
 * old system's trainer list counted them.
 */
export function trainerTotals(trainings: { trainerId: number; hours: number }[]): Map<number, TrainerTotal> {
  const totals = new Map<number, TrainerTotal>();
  for (const t of trainings) {
    const total = totals.get(t.trainerId) ?? { trainings: 0, hours: 0 };
    total.trainings += 1;
    total.hours += t.hours;
    totals.set(t.trainerId, total);
  }
  for (const total of totals.values()) total.hours = round2(total.hours);
  return totals;
}

/** The trainings that gave the most man hours (their hours × the people who completed them), most first. Ties: more people, then by title. */
export function topTrainings<T extends { trainingId: number; hours: number }, M extends { title: string }>(counted: T[], details: Map<number, M>, take = TOP) {
  const totals = new Map<number, { completed: number; manHours: number }>();
  for (const c of counted) {
    const total = totals.get(c.trainingId) ?? { completed: 0, manHours: 0 };
    total.completed += 1;
    total.manHours += c.hours;
    totals.set(c.trainingId, total);
  }
  return [...totals.entries()]
    .flatMap(([id, total]) => {
      const training = details.get(id);
      return training && total.manHours > 0 ? [{ id, ...training, completed: total.completed, manHours: round2(total.manHours) }] : [];
    })
    .sort((a, b) => b.manHours - a.manHours || b.completed - a.completed || a.title.localeCompare(b.title))
    .slice(0, take);
}

/**
 * What a cost chart can and can't say: the total entered, and how many
 * trainings have no cost entered. OJT has no cost field, so it isn't counted
 * as missing one.
 */
export function costSummary(trainings: { cost: number | null; type: string }[]): { total: number; withCost: number; withoutCost: number } {
  const costed = trainings.filter((t) => t.cost !== null);
  return {
    total: round2(costed.reduce((a, t) => a + (t.cost ?? 0), 0)),
    withCost: costed.length,
    withoutCost: trainings.filter((t) => t.cost === null && t.type !== "OJT").length,
  };
}

// ---------- The Progress tab (phase 4, module 4) ----------

/**
 * How many records stand at each stage, department by department: one row for
 * every department given (zeros when it has none), in the order given, and a
 * total over them. A record in a department that isn't listed is left out.
 */
export function countStages<S extends string, D extends { id: number }>(stages: readonly S[], departments: D[], records: { departmentId: number; stage: S }[]) {
  const empty = () => Object.fromEntries(stages.map((s) => [s, 0])) as Record<S, number>;
  const byDepartment = new Map(departments.map((d) => [d.id, empty()]));
  const total = empty();
  for (const r of records) {
    const counts = byDepartment.get(r.departmentId);
    if (!counts || !(r.stage in total)) continue;
    counts[r.stage] += 1;
    total[r.stage] += 1;
  }
  return { rows: departments.map((department) => ({ department, counts: byDepartment.get(department.id)! })), total };
}

/** A whole-number percentage of a total; 0 when there is nothing to divide by. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
