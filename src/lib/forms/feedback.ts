import { z } from "zod";

// The forms staff fill in about their training, in one file so the wording can
// change without touching anything else. Answers are stored with the form's
// version (Participant.feedbackVersion), so a new version never changes how
// old answers read: add FEEDBACK_V2 beside V1 rather than editing V1 once used.
//
// Which form a training uses: OJT has its own short form (OJT_V1), every other
// training the course feedback form (FEEDBACK_V1).
//
// Both forms are the old system's, word for word: OJT_V1 its OJT evaluation
// (confirmed 1 Oct 2026) and FEEDBACK_V1 its Training Evaluation form, in
// English and Malay (taken from the old attendance page on 12 Oct 2026; until
// then it was placeholder wording). The ids are the old columns: q1–q16.

/**
 * The 1–5 scales: agreement with a statement; a rating of a level against
 * percentages (the OJT form); and the same five levels without percentages
 * (the course feedback form).
 */
export type ScaleKind = "agree" | "rating" | "level";

export type Question =
  | { id: string; kind: "scale"; scale: ScaleKind; text: string; required: boolean }
  | { id: string; kind: "yesno"; text: string; required: boolean }
  | { id: string; kind: "text"; text: string; required: boolean; hint?: string };

export type FormDefinition = {
  version: number;
  /** Placeholder wording waiting for L&D: the form says so on screen. */
  draft: boolean;
  /** `intro` is shown under a section's title, e.g. to explain its scale. */
  sections: { title: string; intro?: string; questions: Question[] }[];
};

/** Each 1–5 scale, lowest first. `hint` is shown under the label. */
export const SCALES: Record<ScaleKind, readonly { value: number; label: string; hint?: string }[]> = {
  agree: [
    { value: 1, label: "Strongly disagree" },
    { value: 2, label: "Disagree" },
    { value: 3, label: "Neutral" },
    { value: 4, label: "Agree" },
    { value: 5, label: "Strongly agree" },
  ],
  // The old OJT form's scale: 5 Excellent > 90% … 1 Poor < 49%.
  rating: [
    { value: 1, label: "Poor", hint: "below 50%" },
    { value: 2, label: "Fair", hint: "50–69%" },
    { value: 3, label: "Average", hint: "70–79%" },
    { value: 4, label: "Good", hint: "80–89%" },
    { value: 5, label: "Excellent", hint: "90% and above" },
  ],
  // The old course feedback form's scale: 5 Excellent, 4 Good, 3 Average, 2 Fair, 1 Poor.
  level: [
    { value: 1, label: "Poor" },
    { value: 2, label: "Fair" },
    { value: 3, label: "Average" },
    { value: 4, label: "Good" },
    { value: 5, label: "Excellent" },
  ],
};

export const YES_NO = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
] as const;

/** Longest answer to a written question. */
export const MAX_ANSWER = 1000;

const scale = (id: string, text: string, kind: ScaleKind = "agree"): Question => ({ id, kind: "scale", scale: kind, text, required: true });

/**
 * Course feedback: the old system's Training Evaluation form, 16 questions in
 * three sections, every one required. Filled in from the training's last day.
 */
export const FEEDBACK_V1: FormDefinition = {
  version: 1,
  draft: false,
  sections: [
    {
      title: "Section A: Training content & quality of training",
      intro: "Please assess the training program using the scale below.",
      questions: [
        scale(
          "q1",
          "Knowledge / skill presented in the training is suitable for job application (Pengetahuan/kemahiran yang disampaikan dalam kursus ini sesuai diaplikasikan di tempat kerja)",
          "level",
        ),
        scale(
          "q2",
          "The objective of this course is clearly stated in the beginning of the course (Tujuan kursus ini dinyatakan dengan jelas pada permulaan kursus)",
          "level",
        ),
        scale("q3", "Training content provided is complete and suitable (Bahan latihan yang digunakan adalah lengkap dan bersesuaian)", "level"),
        scale(
          "q4",
          "Activities carried out such as case study, simulation and group discussion is suitable and effective (Aktiviti yang dijalankan seperti kajian kes, simulasi dan perbincangan kumpulan adalah sesuai dan berkesan)",
          "level",
        ),
        scale("q5", "Training duration is sufficient (Jangkamasa kursus adalah sesuai)", "level"),
        scale(
          "q6",
          "Quality and cleanliness of food preparation throughout the course (Kualiti dan kebersihan makanan yang disediakan sepanjang kursus adalah baik)",
          "level",
        ),
        scale("q7", "Complete training facilities (Kemudahan kursus adalah lengkap)", "level"),
        scale("q8", "Overall evaluation (Penilaian secara keseluruhan)", "level"),
      ],
    },
    {
      title: "Section B: Facilitator / trainer",
      intro: "Please assess the training facilitator/trainer using the scale below.",
      questions: [
        scale("q9", "Knowledge on the subject (Pengetahuan berkaitan tajuk kursus)", "level"),
        scale("q10", "Methods and manner of presentation (Cara dan gaya penyampaian)", "level"),
        scale("q11", "Overall evaluation (Penilaian secara keseluruhan)", "level"),
      ],
    },
    {
      title: "Section C: Recommendation & suggestion",
      questions: [
        {
          id: "q12",
          kind: "yesno",
          text: "Would you recommend the course to other employees? (Adakah anda akan mensyorkan kursus ini kepada pekerja lain?)",
          required: true,
        },
        {
          id: "q13",
          kind: "text",
          text: "What have you benefited from the course? (Apakah faedah-faedah yang telah anda perolehi daripada kursus ini?)",
          required: true,
        },
        {
          id: "q14",
          kind: "text",
          text: "What is your plan for improvement based on the knowledge gained from this course? (Short term - within 6 months) Apakah perancangan anda untuk pembaikan berdasarkan pengetahuan diperolehi dari kursus ini? (Jangkamasa pendek - dalam tempoh 6 bulan)",
          required: true,
        },
        {
          id: "q15",
          kind: "text",
          text: "What is your plan for improvement based on the knowledge gained from this course? (Long term - within more than 1 year) Apakah perancangan anda untuk pembaikan berdasarkan pengetahuan diperolehi dari kursus ini? (Jangkamasa panjang - dalam tempoh lebih 1 tahun)",
          required: true,
        },
        {
          id: "q16",
          kind: "text",
          text: "Please write your comments/suggestions for improvement, problem encountered and other recommendations regarding the course (Sila nyatakan cadangan-cadangan untuk kemajuan, masalah-masalah yang timbul dan lain-lain cadangan berkenaan kursus tersebut)",
          required: true,
        },
      ],
    },
  ],
};

/** OJT: Section B of the old system's OJT form, given when the OJT is recorded or completed. */
export const OJT_V1: FormDefinition = {
  version: 1,
  draft: false,
  sections: [
    {
      title: "Training evaluation",
      questions: [{ id: "a1", kind: "text", text: "Please highlight what you have learned from the OJT", required: true }],
    },
    {
      title: "Pre & post evaluation",
      intro: "Please assess the training program using the scale below.",
      questions: [
        scale("a2", "Your knowledge / skill before training (Pengetahuan/kemahiran sebelum training)", "rating"),
        scale("a3", "Your knowledge / skill after training (Pengetahuan/kemahiran selepas latihan)", "rating"),
      ],
    },
  ],
};

export type FormKind = "FEEDBACK" | "OJT";

/** The form used for new answers, per kind. */
export const CURRENT_FORM: Record<FormKind, FormDefinition> = { FEEDBACK: FEEDBACK_V1, OJT: OJT_V1 };

/** Every version, to read answers stored under an older one. */
const VERSIONS: Record<FormKind, Record<number, FormDefinition>> = {
  FEEDBACK: { 1: FEEDBACK_V1 },
  OJT: { 1: OJT_V1 },
};

export function formVersion(kind: FormKind, version: number | null | undefined): FormDefinition | null {
  return version ? (VERSIONS[kind][version] ?? null) : null;
}

export const questionsOf = (form: FormDefinition) => form.sections.flatMap((s) => s.questions);

export type Answers = Record<string, number | string | null>;

const CHOOSE = "Choose an answer";

/**
 * Checks a form's answers, as submitted (every value a string), and turns them
 * into what is stored: scale answers as 1–5, yes/no as YES or NO, written
 * answers trimmed (empty ones as null).
 */
export function answersSchema(form: FormDefinition) {
  const shape: Record<string, z.ZodType> = {};
  for (const q of questionsOf(form)) {
    if (q.kind === "scale") {
      const value = z.enum(["1", "2", "3", "4", "5"], CHOOSE).transform(Number);
      shape[q.id] = q.required ? value : z.union([z.literal("").transform(() => null), value]);
    } else if (q.kind === "yesno") {
      const value = z.enum(["YES", "NO"], CHOOSE);
      shape[q.id] = q.required ? value : z.union([z.literal("").transform(() => null), value]);
    } else {
      const value = z.string("Write an answer").trim().max(MAX_ANSWER, `Keep it under ${MAX_ANSWER} characters`);
      shape[q.id] = q.required ? value.min(1, "Write an answer") : value.transform((v) => v || null);
    }
  }
  return z.object(shape) as unknown as z.ZodType<Answers>;
}

/** An answer as words, for showing what someone gave. */
export function answerLabel(q: Question, value: Answers[string] | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (q.kind === "scale") {
    const s = SCALES[q.scale].find((s) => s.value === value);
    // A rating or level reads with its number, as on the old forms: "4 · Good".
    return s ? (q.scale === "agree" ? s.label : `${s.value} · ${s.label}`) : String(value);
  }
  if (q.kind === "yesno") return YES_NO.find((s) => s.value === value)?.label ?? String(value);
  return String(value);
}

/**
 * A stored set of answers as spreadsheet cells: one for each question of the
 * kind's current form, in order. Ratings are their number and yes/no is in
 * words, as the old system's audit reports had them. Blank where nothing was
 * given, or the answers were given on a version this code doesn't know.
 */
export function answerCells(kind: FormKind, version: number | null | undefined, answers: unknown): (number | string)[] {
  const given = formVersion(kind, version) && answers && typeof answers === "object" ? (answers as Answers) : null;
  return questionsOf(CURRENT_FORM[kind]).map((q) => {
    const value = given?.[q.id];
    if (value === null || value === undefined) return "";
    return q.kind === "yesno" ? (answerLabel(q, value) ?? "") : value;
  });
}
