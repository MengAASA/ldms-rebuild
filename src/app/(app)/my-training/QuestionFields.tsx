import type { ActionState } from "@/lib/action-state";
import { MAX_ANSWER, questionsOf, SCALES, YES_NO, type Answers, type FormDefinition, type Question } from "@/lib/forms/feedback";

/**
 * A form's questions, section by section: agree/disagree and yes/no questions
 * as a row of worded choices, ratings as a 1–5 row of numbers with the scale
 * explained once above them, written questions as a text box. Field names are
 * the question ids. Used inside a <form>; it has no submit button of its own.
 */
export function QuestionFields({ form, initial, state }: { form: FormDefinition; initial?: Answers | null; state: ActionState }) {
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  // Questions are numbered straight through, across sections.
  const number = new Map(questionsOf(form).map((q, i) => [q.id, i + 1]));
  return (
    <div className="flex flex-col gap-7">
      {form.draft && <p className="notice notice-wait text-[12.5px]">Draft questions: the L&amp;D unit is still confirming the wording, so it may change.</p>}
      {form.sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-5">
          <div>
            <h3 className="ruled-heading">{section.title}</h3>
            {section.intro && <p className="mt-2 text-[13px] text-ink-2">{section.intro}</p>}
            <ScaleKey questions={section.questions} />
          </div>
          {section.questions.map((q) => (
            <QuestionField key={q.id} n={number.get(q.id)!} q={q} value={initial?.[q.id]} error={errors?.[q.id]?.[0]} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** The numbered scale a section's questions use (a rating or a level), if any. */
const numberedScale = (questions: Question[]) => questions.flatMap((q) => (q.kind === "scale" && q.scale !== "agree" ? [q.scale] : []))[0];

/** The numbered scale, explained once for the questions under it, as the old forms did. */
function ScaleKey({ questions }: { questions: Question[] }) {
  const kind = numberedScale(questions);
  if (!kind) return null;
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-sunken px-4 py-3 text-[12.5px] sm:grid-cols-5">
      {SCALES[kind].map((s) => (
        <div key={s.value} className="flex items-baseline gap-2">
          <dt className="num w-3 shrink-0 font-semibold text-ink">{s.value}</dt>
          <dd className="min-w-0">
            <span className="font-medium text-ink">{s.label}</span>
            {s.hint && <span className="block text-[11.5px] text-ink-3">{s.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function QuestionField({ n, q, value, error }: { n: number; q: Question; value: Answers[string] | undefined; error?: string }) {
  const errorId = `${q.id}-error`;
  const legend = (
    <span className={`text-[13.5px] font-medium text-ink ${q.required ? "req" : ""}`}>
      <span className="num mr-1.5 text-ink-3">{n}.</span>
      {q.text}
    </span>
  );
  const message = error ? (
    <div id={errorId} className="field-error">
      {error}
    </div>
  ) : null;
  const checked = (v: string) => String(value ?? "") === v;

  if (q.kind === "text")
    return (
      <div>
        <label htmlFor={q.id} className="mb-1.5 block">
          {legend}
        </label>
        <textarea
          id={q.id}
          name={q.id}
          defaultValue={typeof value === "string" ? value : ""}
          maxLength={MAX_ANSWER}
          rows={3}
          className="textarea"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {message ?? (q.hint && <div className="hint">{q.hint}</div>)}
      </div>
    );

  if (q.kind === "scale" && q.scale !== "agree") {
    const scale = SCALES[q.scale];
    return (
      <fieldset aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}>
        <legend className="mb-2.5">{legend}</legend>
        <div className="max-w-md">
          {/* Five equal buttons showing the number; the words are in the key above, and read out by screen readers. */}
          <div className="grid grid-cols-5 gap-2">
            {scale.map((s) => (
              <label
                key={s.value}
                className={`relative flex h-11 cursor-pointer items-center justify-center rounded-lg border bg-surface text-ink-2 transition-colors hover:border-accent has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                  error ? "border-bad/60" : "border-rule-strong"
                }`}
              >
                <input
                  type="radio"
                  name={q.id}
                  value={String(s.value)}
                  defaultChecked={checked(String(s.value))}
                  aria-label={[s.value, s.label, s.hint].filter(Boolean).join(", ")}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
                <span aria-hidden className="num text-[16px] font-semibold">
                  {s.value}
                </span>
              </label>
            ))}
          </div>
          <div aria-hidden className="mt-1.5 flex justify-between text-[11.5px] text-ink-3">
            <span>{scale[0].label}</span>
            <span>{scale[scale.length - 1].label}</span>
          </div>
        </div>
        {message}
      </fieldset>
    );
  }

  const choices =
    q.kind === "scale" ? SCALES[q.scale].map((s) => ({ value: String(s.value), label: s.label })) : YES_NO.map((s) => ({ value: s.value, label: s.label }));
  return (
    <fieldset aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}>
      <legend className="mb-2">{legend}</legend>
      <div className={`grid gap-1.5 ${q.kind === "scale" ? "grid-cols-1 sm:grid-cols-5" : "max-w-xs grid-cols-2"}`}>
        {choices.map((c) => (
          <label
            key={c.value}
            className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] leading-tight transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium has-[:checked]:text-accent-deep has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent hover:bg-sunken ${
              error ? "border-bad/60" : "border-rule-strong"
            }`}
          >
            <input type="radio" name={q.id} value={c.value} defaultChecked={checked(c.value)} className="accent-accent" />
            {c.label}
          </label>
        ))}
      </div>
      {message}
    </fieldset>
  );
}
