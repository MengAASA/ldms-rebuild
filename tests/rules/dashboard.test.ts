import { describe, expect, it } from "vitest";
import {
  bucketKey,
  costSummary,
  countStages,
  percent,
  MAX_MONTHS,
  perHead,
  periodBuckets,
  stackHours,
  sumByBucket,
  topByHours,
  topTrainings,
  trainerTotals,
} from "@/server/rules/dashboard";

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const today = day("2026-10-09");

describe("the columns a period is drawn in", () => {
  it("gives a calendar year its twelve months, those still to come marked", () => {
    const { unit, buckets } = periodBuckets({ from: "2026-01-01", to: "2026-12-31" }, today);
    expect(unit).toBe("month");
    expect(buckets.map((b) => b.label).join(" ")).toBe("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec");
    expect(buckets[2]).toEqual({ key: "2026-03", label: "Mar", short: "M", title: "March 2026", year: 2026, future: false });
    expect(buckets.filter((b) => b.future).map((b) => b.label)).toEqual(["Nov", "Dec"]);
  });
  it("follows the dates across a year end", () => {
    const { buckets } = periodBuckets({ from: "2025-11-15", to: "2026-02-03" }, today);
    expect(buckets.map((b) => b.key)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(buckets.map((b) => b.year)).toEqual([2025, 2025, 2026, 2026]);
  });
  it("draws one day as its month", () => {
    expect(periodBuckets({ from: "2026-03-05", to: "2026-03-05" }, today).buckets.map((b) => b.key)).toEqual(["2026-03"]);
  });
  it("draws up to two years by month and anything longer by year", () => {
    expect(periodBuckets({ from: "2025-01-01", to: "2026-12-31" }, today).buckets).toHaveLength(MAX_MONTHS);
    const long = periodBuckets({ from: "2024-06-01", to: "2027-01-31" }, today);
    expect(long.unit).toBe("year");
    expect(long.buckets.map((b) => b.key)).toEqual(["2024", "2025", "2026", "2027"]);
    expect(long.buckets.map((b) => b.future)).toEqual([false, false, false, true]);
    expect(long.buckets[0].short).toBe("24");
  });
  it("puts a date in its month or its year", () => {
    expect(bucketKey(day("2026-03-31"), "month")).toBe("2026-03");
    expect(bucketKey(day("2026-03-31"), "year")).toBe("2026");
  });
});

describe("hours by training type", () => {
  const { unit, buckets } = periodBuckets({ from: "2026-01-01", to: "2026-03-31" }, today);
  const types = ["PUBLIC_INHOUSE", "OJT"] as const;
  it("adds each attendance to its month and its type", () => {
    const out = stackHours(buckets, unit, types, [
      { date: day("2026-01-10"), series: "PUBLIC_INHOUSE", hours: 9 },
      { date: day("2026-01-28"), series: "PUBLIC_INHOUSE", hours: 4.5 },
      { date: day("2026-01-28"), series: "OJT", hours: 1.1 },
      { date: day("2026-03-01"), series: "OJT", hours: 2.2 },
      { date: day("2026-03-02"), series: "OJT", hours: 0.1 },
    ]);
    expect(out).toEqual([
      [13.5, 1.1],
      [0, 0],
      [0, 2.3],
    ]);
  });
  it("leaves out what falls outside the period", () => {
    expect(
      stackHours(buckets, unit, types, [{ date: day("2026-04-01"), series: "OJT", hours: 5 }])
        .flat()
        .every((h) => h === 0),
    ).toBe(true);
  });
  it("adds up to the same total however it is split", () => {
    const rows = [
      { date: day("2026-01-10"), series: "PUBLIC_INHOUSE" as const, hours: 7.25 },
      { date: day("2026-02-10"), series: "PUBLIC_INHOUSE" as const, hours: 3.5 },
      { date: day("2026-03-10"), series: "OJT" as const, hours: 1.25 },
    ];
    const total = stackHours(buckets, unit, types, rows)
      .flat()
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(12);
  });
});

describe("cost", () => {
  const { unit, buckets } = periodBuckets({ from: "2026-01-01", to: "2026-02-28" }, today);
  it("adds each training's cost to the month it started", () => {
    expect(
      sumByBucket(buckets, unit, [
        { date: day("2026-01-05"), amount: 1200.5 },
        { date: day("2026-01-20"), amount: 300 },
        { date: day("2026-02-01"), amount: 0 },
      ]),
    ).toEqual([1500.5, 0]);
  });
  it("says how many trainings have no cost, not counting OJT", () => {
    expect(
      costSummary([
        { cost: 1000, type: "PUBLIC_INHOUSE" },
        { cost: 0, type: "PUBLIC_INHOUSE" },
        { cost: null, type: "PUBLIC_INHOUSE" },
        { cost: null, type: "PUBLIC_INHOUSE" },
        { cost: null, type: "OJT" },
      ]),
    ).toEqual({ total: 1000, withCost: 2, withoutCost: 2 });
  });
});

describe("average per person", () => {
  it("divides by the headcount, and is 0 with no one to divide by", () => {
    expect(perHead(10, 4)).toBe(2.5);
    expect(perHead(10, 3)).toBe(3.33);
    expect(perHead(10, 0)).toBe(0);
  });
});

describe("most hours", () => {
  const people = [
    { name: "Chong", hours: 9, completed: 1 },
    { name: "Aminah", hours: 9, completed: 2 },
    { name: "Bala", hours: 9, completed: 1 },
    { name: "Devi", hours: 20, completed: 1 },
    { name: "Ali", hours: 0, completed: 0 },
  ];
  it("lists the most hours first, then more trainings, then by name, and no one without hours", () => {
    expect(topByHours(people).map((p) => p.name)).toEqual(["Devi", "Aminah", "Bala", "Chong"]);
  });
  it("stops at five", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ name: `P${String(i).padStart(2, "0")}`, hours: i + 1, completed: 1 }));
    const top = topByHours(many);
    expect(top).toHaveLength(5);
    expect(top[0].hours).toBe(15);
  });
});

describe("in-house trainers", () => {
  it("gives each trainer the trainings they ran and those trainings' own hours", () => {
    const totals = trainerTotals([
      { trainerId: 7, hours: 9 },
      { trainerId: 7, hours: 4.5 },
      { trainerId: 9, hours: 2 },
    ]);
    expect(totals.get(7)).toEqual({ trainings: 2, hours: 13.5 });
    expect(totals.get(9)).toEqual({ trainings: 1, hours: 2 });
  });
});

describe("the trainings that gave the most man hours", () => {
  const details = new Map([
    [1, { title: "Safety" }],
    [2, { title: "Excel" }],
    [3, { title: "5S" }],
  ]);
  it("adds a training's hours once for each person who completed it, most first", () => {
    const top = topTrainings(
      [
        { trainingId: 1, hours: 9 },
        { trainingId: 1, hours: 9 },
        { trainingId: 2, hours: 4 },
        { trainingId: 3, hours: 6 },
        { trainingId: 3, hours: 6 },
        { trainingId: 3, hours: 6 },
      ],
      details,
    );
    expect(top.map((t) => [t.title, t.completed, t.manHours])).toEqual([
      ["5S", 3, 18],
      ["Safety", 2, 18],
      ["Excel", 1, 4],
    ]);
  });
  it("stops at five and leaves out a training with no hours", () => {
    const many = new Map(Array.from({ length: 8 }, (_, i) => [i, { title: `T${i}` }] as const));
    const counted = Array.from({ length: 8 }, (_, i) => ({ trainingId: i, hours: i }));
    const top = topTrainings(counted, many);
    expect(top).toHaveLength(5);
    expect(top[0].title).toBe("T7");
    expect(top.some((t) => t.title === "T0")).toBe(false);
  });
});

describe("where each department's records stand", () => {
  const stages = ["NOT_STARTED", "DRAFT", "APPROVED"] as const;
  const departments = [
    { id: 1, name: "Stamping" },
    { id: 2, name: "Finance" },
    { id: 3, name: "IT" },
  ];
  const counted = countStages(stages, departments, [
    { departmentId: 1, stage: "APPROVED" },
    { departmentId: 1, stage: "APPROVED" },
    { departmentId: 1, stage: "DRAFT" },
    { departmentId: 2, stage: "NOT_STARTED" },
    { departmentId: 9, stage: "APPROVED" },
  ]);
  it("counts each stage for each department, in the departments' order", () => {
    expect(counted.rows.map((r) => [r.department.name, r.counts])).toEqual([
      ["Stamping", { NOT_STARTED: 0, DRAFT: 1, APPROVED: 2 }],
      ["Finance", { NOT_STARTED: 1, DRAFT: 0, APPROVED: 0 }],
      ["IT", { NOT_STARTED: 0, DRAFT: 0, APPROVED: 0 }],
    ]);
  });
  it("adds up only what belongs to a listed department", () => {
    expect(counted.total).toEqual({ NOT_STARTED: 1, DRAFT: 1, APPROVED: 2 });
  });
  it("gives a share as a whole percentage, and 0 of nothing", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBe(0);
  });
});
