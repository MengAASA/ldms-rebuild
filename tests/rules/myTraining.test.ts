import { describe, expect, it } from "vitest";
import type { Attendance } from "@prisma/client";
import { answerLabel, answersSchema, CURRENT_FORM, FEEDBACK_V1, formVersion, OJT_V1, questionsOf, answerCells } from "@/lib/forms/feedback";
import { ojtSchema } from "@/lib/validation/myTraining";
import { feedbackDue, formAccess, formKind, ojtDateBlock, ojtDeleteBlock, ojtDetailsBlock } from "@/server/rules/myTraining";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = new Date("2026-09-30T10:00:00Z");

const course = { type: "PUBLIC_INHOUSE" as const, status: "SCHEDULED" as const, endDate: d("2026-09-08") };
const ojt = { ...course, type: "OJT" as const };
const endsToday = { ...course, endDate: d("2026-09-30") };
const upcoming = { ...course, endDate: d("2026-11-12") };
const cancelled = { ...course, status: "CANCELLED" as const };

const me = (attendance: Attendance, submittedAt: Date | null = null) => ({ attendance, submittedAt });

describe("which form a training uses", () => {
  it("OJT has its own form; a course the feedback form", () => {
    expect(formKind({ type: "OJT" })).toBe("OJT");
    expect(formKind({ type: "PUBLIC_INHOUSE" })).toBe("FEEDBACK");
  });
});

describe("feedback availability", () => {
  it("opens on the training's last day while attendance is pending", () => {
    expect(formAccess(me("PENDING"), course, today).mode).toBe("submit");
    expect(formAccess(me("PENDING"), endsToday, today).mode).toBe("submit");
  });

  it("is not open before the last day, and says when it opens", () => {
    const a = formAccess(me("PENDING"), upcoming, today);
    expect(a).toEqual({ mode: "closed", reason: "The form opens on 12 Nov 2026, the training's last day." });
  });

  it("is closed for a cancelled training and for someone marked absent", () => {
    expect(formAccess(me("PENDING"), cancelled, today)).toMatchObject({ mode: "closed", reason: expect.stringMatching(/cancelled/) });
    expect(formAccess(me("ABSENT"), course, today)).toMatchObject({ mode: "closed", reason: expect.stringMatching(/absent/) });
  });

  it("once sent, course feedback is shown but not changed", () => {
    expect(formAccess(me("COMPLETED", d("2026-09-09")), course, today).mode).toBe("view");
  });

  it("completed by L&D without a form: nothing to fill in, and it says so", () => {
    expect(formAccess(me("COMPLETED"), course, today)).toMatchObject({ mode: "closed", reason: expect.stringMatching(/L&D unit recorded/) });
  });

  it("a completed OJT's answers can always be updated", () => {
    expect(formAccess(me("COMPLETED"), ojt, today).mode).toBe("update");
    expect(formAccess(me("COMPLETED", d("2026-09-09")), ojt, today).mode).toBe("update");
  });

  it("feedback is due exactly when the form is open to submit", () => {
    expect(feedbackDue(me("PENDING"), course, today)).toBe(true);
    expect(feedbackDue(me("PENDING"), upcoming, today)).toBe(false);
    expect(feedbackDue(me("COMPLETED", d("2026-09-09")), course, today)).toBe(false);
    expect(feedbackDue(me("PENDING"), cancelled, today)).toBe(false);
  });
});

describe("OJT edit and delete by source", () => {
  it("OJT the person recorded can be edited and deleted while it's theirs alone", () => {
    expect(ojtDetailsBlock({ source: "SELF" }, 0)).toBeNull();
    expect(ojtDeleteBlock({ source: "SELF" }, 0)).toBeNull();
  });

  it("OJT from a clerk or L&D can't be edited or deleted by the staff member", () => {
    for (const source of ["CLERK", "ADMIN", "IMPORT"] as const) {
      expect(ojtDetailsBlock({ source }, 0)).toMatch(/clerk or the L&D unit/);
      expect(ojtDeleteBlock({ source }, 0)).toMatch(/stays on your record/);
    }
  });

  it("once others are on it, even their own OJT goes through L&D", () => {
    expect(ojtDetailsBlock({ source: "SELF" }, 2)).toMatch(/Other staff/);
    expect(ojtDeleteBlock({ source: "SELF" }, 1)).toMatch(/Other staff/);
  });

  it("OJT is recorded once it has happened: today or earlier", () => {
    expect(ojtDateBlock(d("2026-09-30"), today)).toBeNull();
    expect(ojtDateBlock(d("2026-09-01"), today)).toBeNull();
    expect(ojtDateBlock(d("2026-10-01"), today)).toMatch(/once it has happened/);
  });
});

describe("feedback form (FEEDBACK_V1)", () => {
  const filled = Object.fromEntries(
    questionsOf(FEEDBACK_V1).map((q) => [q.id, q.kind === "scale" ? "4" : q.kind === "yesno" ? "YES" : "Good examples"]),
  ) as Record<string, string>;

  it("is the old system's form: 11 ratings, a yes/no, then 4 written answers, in English and Malay", () => {
    expect(FEEDBACK_V1.draft).toBe(false);
    expect(questionsOf(FEEDBACK_V1).map((q) => q.kind)).toEqual([...Array(11).fill("scale"), "yesno", ...Array(4).fill("text")]);
    expect(questionsOf(FEEDBACK_V1).every((q) => q.required)).toBe(true);
    expect(FEEDBACK_V1.sections.map((s) => s.questions.length)).toEqual([8, 3, 5]);
    expect(questionsOf(FEEDBACK_V1)[0].text).toContain("Pengetahuan/kemahiran");
  });

  it("gives its answers as spreadsheet cells in question order: ratings as numbers, yes/no in words", () => {
    const stored = answersSchema(FEEDBACK_V1).parse(filled);
    const cells = answerCells("FEEDBACK", 1, stored);
    expect(cells).toHaveLength(16);
    expect(cells.slice(0, 11)).toEqual(Array(11).fill(4));
    expect(cells[11]).toBe("Yes");
    expect(cells[12]).toBe("Good examples");
    // Nothing given, or a version this code doesn't know: every cell blank.
    expect(answerCells("FEEDBACK", null, null)).toEqual(Array(16).fill(""));
    expect(answerCells("FEEDBACK", 99, stored)).toEqual(Array(16).fill(""));
    expect(answerCells("OJT", 1, { a1: "The steps", a2: 2, a3: 4 })).toEqual(["The steps", 2, 4]);
  });

  it("has the 16 questions the old system stored as q1–q16", () => {
    expect(questionsOf(FEEDBACK_V1).map((q) => q.id)).toEqual(Array.from({ length: 16 }, (_, i) => `q${i + 1}`));
  });

  it("is the current form and is found again by its version", () => {
    expect(CURRENT_FORM.FEEDBACK).toBe(FEEDBACK_V1);
    expect(formVersion("FEEDBACK", 1)).toBe(FEEDBACK_V1);
    expect(formVersion("FEEDBACK", 99)).toBeNull();
    expect(formVersion("FEEDBACK", null)).toBeNull();
  });

  it("stores scale answers as numbers and yes/no as YES or NO", () => {
    const r = answersSchema(FEEDBACK_V1).safeParse(filled);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ q1: 4, q11: 4, q12: "YES", q13: "Good examples", q16: "Good examples" });
  });

  it("requires every answer, written ones too, and flags each one missing", () => {
    const r = answersSchema(FEEDBACK_V1).safeParse({ ...filled, q3: "", q12: "", q14: "  " });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["q3", "q12", "q14"]));
    expect(paths).toHaveLength(3);
  });

  it("refuses out-of-range and unknown answers", () => {
    expect(answersSchema(FEEDBACK_V1).safeParse({ ...filled, q1: "6" }).success).toBe(false);
    expect(answersSchema(FEEDBACK_V1).safeParse({ ...filled, q1: "0" }).success).toBe(false);
    expect(answersSchema(FEEDBACK_V1).safeParse({ ...filled, q12: "MAYBE" }).success).toBe(false);
  });

  it("trims written answers and limits their length", () => {
    expect(answersSchema(FEEDBACK_V1).safeParse({ ...filled, q16: "  More practice  " }).data).toMatchObject({ q16: "More practice" });
    expect(answersSchema(FEEDBACK_V1).safeParse({ ...filled, q16: "x".repeat(1001) }).success).toBe(false);
  });

  it("reads answers back in words", () => {
    const [q1] = questionsOf(FEEDBACK_V1);
    expect(answerLabel(q1, 5)).toBe("5 · Excellent");
    expect(answerLabel(questionsOf(FEEDBACK_V1)[11], "NO")).toBe("No");
    expect(answerLabel(q1, null)).toBeNull();
  });
});

describe("OJT form (OJT_V1): the old system's Section B", () => {
  it("asks what was learned, then knowledge before and after on the old rating scale", () => {
    expect(questionsOf(OJT_V1).map((q) => [q.id, q.kind])).toEqual([
      ["a1", "text"],
      ["a2", "scale"],
      ["a3", "scale"],
    ]);
    expect(OJT_V1.draft).toBe(false);
    const [, before] = questionsOf(OJT_V1);
    expect(answerLabel(before, 5)).toBe("5 · Excellent");
    expect(answerLabel(before, 1)).toBe("1 · Poor");
  });

  it("needs all three answers, and stores the ratings as numbers", () => {
    const r = answersSchema(OJT_V1).safeParse({ a1: "", a2: "", a3: "4" });
    expect(r.error!.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["a1", "a2"]));
    expect(answersSchema(OJT_V1).safeParse({ a1: "Die setting", a2: "2", a3: "4" }).data).toEqual({ a1: "Die setting", a2: 2, a3: 4 });
  });
});

describe("record-OJT details: the old system's Section A", () => {
  const ok = {
    title: "Die setting",
    ojtMethod: "COACHING",
    startDate: "2026-09-28",
    endDate: "2026-09-29",
    startTime: "08:30",
    endTime: "11:30",
    venue: "Tooling Workshop",
    trainer: "EXTERNAL",
  };

  it("accepts a multi-day OJT and stores the external/internal trainer as the program", () => {
    const r = ojtSchema.safeParse(ok);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ ojtMethod: "COACHING", venue: "Tooling Workshop", program: "INTERNAL_EXTERNAL_TRAINER" });
    expect(r.data!.endDate.toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(ojtSchema.safeParse({ ...ok, trainer: "INTERNAL" }).data!.program).toBe("INTERNAL_INTERNAL_TRAINER");
  });

  it("flags every missing field at once", () => {
    const r = ojtSchema.safeParse({ title: "", ojtMethod: "", startDate: "", endDate: "", startTime: "", endTime: "", venue: "", trainer: "" });
    expect(r.error!.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(["title", "ojtMethod", "startDate", "endDate", "startTime", "endTime", "venue", "trainer"]),
    );
  });

  it("refuses an end before the start, by date or by time", () => {
    expect(ojtSchema.safeParse({ ...ok, endDate: "2026-09-27" }).error!.issues[0].path[0]).toBe("endDate");
    expect(ojtSchema.safeParse({ ...ok, endTime: "08:00" }).error!.issues[0].path[0]).toBe("endTime");
  });
});
