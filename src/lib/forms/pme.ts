import { z } from "zod";

// The Performance Monitoring Form a HOD fills in about one staff member and
// one training, three months after it. The old system's form, question for
// question (staff/hod/pme/edit_pme.php). Answers are stored with the form's
// version (Pme.answersVersion): add PME_V2 beside V1 rather than editing V1
// once it has been used.

/** The six rating bands, best first. A percentage must sit inside its band. */
export const PME_BANDS = [
  { value: "EXCELLENT", label: "Excellent", min: 90, max: 100 },
  { value: "VERY_GOOD", label: "Very good", min: 80, max: 89 },
  { value: "GOOD", label: "Good", min: 70, max: 79 },
  { value: "SATISFACTORY", label: "Satisfactory", min: 60, max: 69 },
  { value: "FAIR", label: "Fair", min: 50, max: 59 },
  { value: "POOR", label: "Poor", min: 1, max: 49 },
] as const;

export type PmeRating = (typeof PME_BANDS)[number]["value"];
export const PME_RATINGS = PME_BANDS.map((b) => b.value) as [PmeRating, ...PmeRating[]];
export const pmeBand = (rating: PmeRating) => PME_BANDS.find((b) => b.value === rating)!;
/** The band a percentage falls in, or null when it is outside 1 to 100. */
export const pmeBandOf = (percent: number) => PME_BANDS.find((b) => percent >= b.min && percent <= b.max) ?? null;

export const PME_QUESTION_IDS = ["q1", "q2", "q3", "q4"] as const;
export type PmeQuestionId = (typeof PME_QUESTION_IDS)[number];

export type PmeQuestion = { id: PmeQuestionId; section: string; text: string };

export const PME_V1 = {
  version: 1,
  title: "Performance Monitoring Form",
  questions: [
    {
      id: "q1",
      section: "Learning level",
      text: "Evaluate the employee's Knowledge Sharing Sessions (KSS) and On-the-Job Training (OJT) conducted for their team after attending the training.",
    },
    { id: "q2", section: "Learning level", text: "Did the employee learn what they were supposed to learn from the training attended?" },
    { id: "q3", section: "Behavioural change", text: "Did the employee apply their newly acquired skills and knowledge to their job?" },
    { id: "q4", section: "Result of training attended", text: "Did the training have any measurable business impact?" },
  ] satisfies PmeQuestion[],
  /** Asked under question 1, with remarks that must be filled in. */
  ojt: {
    text: "Was the On-the-Job Training (OJT) conducted?",
    remarks: "If yes, give the date, time and place of the OJT. If no, say why not.",
  },
} as const;

export const CURRENT_PME_FORM = PME_V1;

/** Longest remarks on a question. */
export const MAX_PME_REMARKS = 1000;

export type PmeAnswer = { rating: PmeRating; percent: number; remarks: string | null };
/** `ojtConducted` is null only on some PMEs brought from the old system, where the question was left unanswered. */
export type PmeAnswers = Record<PmeQuestionId, PmeAnswer> & { ojtConducted: boolean | null };

/** Field names on the form: q1_rating, q1_percent, q1_remarks ... and ojtConducted. */
export const pmeField = (id: PmeQuestionId, part: "rating" | "percent" | "remarks") => `${id}_${part}`;

/**
 * Checks the form as submitted (every field a string) and returns the answers
 * as stored. Errors are keyed by field name, so each shows beside its field.
 */
export const pmeAnswersSchema = z.record(z.string(), z.string()).transform((raw, ctx): PmeAnswers => {
  const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  const answers = {} as Record<PmeQuestionId, PmeAnswer>;

  const ojt = raw.ojtConducted;
  if (ojt !== "YES" && ojt !== "NO") fail("ojtConducted", "Choose yes or no");

  for (const id of PME_QUESTION_IDS) {
    const rating = PME_RATINGS.find((r) => r === raw[pmeField(id, "rating")]);
    const percentText = (raw[pmeField(id, "percent")] ?? "").trim();
    const remarks = (raw[pmeField(id, "remarks")] ?? "").trim();
    let percent = Number.NaN;

    if (!rating) fail(pmeField(id, "rating"), "Choose a rating");
    if (!percentText) fail(pmeField(id, "percent"), "Enter the percentage");
    else if (!/^\d{1,3}$/.test(percentText)) fail(pmeField(id, "percent"), "A whole number, without the % sign");
    else {
      percent = Number(percentText);
      if (rating) {
        const band = pmeBand(rating);
        if (percent < band.min || percent > band.max) fail(pmeField(id, "percent"), `${band.label} is ${band.min} to ${band.max}`);
      } else if (percent < 1 || percent > 100) fail(pmeField(id, "percent"), "From 1 to 100");
    }

    if (remarks.length > MAX_PME_REMARKS) fail(pmeField(id, "remarks"), `At most ${MAX_PME_REMARKS} characters`);
    else if (id === "q1" && !remarks)
      fail(pmeField(id, "remarks"), ojt === "NO" ? "Say why the OJT wasn't conducted" : "Give the date, time and place of the OJT");

    if (rating) answers[id] = { rating, percent, remarks: remarks || null };
  }
  return { ...answers, ojtConducted: ojt === "YES" };
});

/** Stored answers, read back. Null when they are missing or not this version's shape. */
export function readPmeAnswers(value: unknown, version: number | null | undefined): PmeAnswers | null {
  if (version !== PME_V1.version || !value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  for (const id of PME_QUESTION_IDS) {
    const a = v[id] as Partial<PmeAnswer> | undefined;
    if (!a || typeof a.percent !== "number" || !PME_RATINGS.includes(a.rating as PmeRating)) return null;
  }
  return typeof v.ojtConducted === "boolean" || v.ojtConducted === null ? (v as unknown as PmeAnswers) : null;
}
