"use client";

import Link from "next/link";
import { useState } from "react";
import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/forms";
import { MAX_PME_REMARKS, PME_BANDS, PME_QUESTION_IDS, PME_V1, pmeBand, pmeField, type PmeAnswers, type PmeQuestionId, type PmeRating } from "@/lib/forms/pme";
import { evaluatePmeAction } from "./actions";

type Entry = { rating: PmeRating | ""; percent: string };

/**
 * The Performance Monitoring Form, for the HOD. Each question takes a rating
 * band and a percentage inside it; the mark underneath adds up as they go.
 * `initial` is what the HOD wrote before, when L&D sent it back.
 */
export function PmeForm({ pmeId, staffName, initial, cancelHref }: { pmeId: number; staffName: string; initial: PmeAnswers | null; cancelHref: string }) {
  const { state, onSubmit, pending } = useFormAction(evaluatePmeAction.bind(null, pmeId));
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [entries, setEntries] = useState<Record<PmeQuestionId, Entry>>(
    () =>
      Object.fromEntries(
        PME_QUESTION_IDS.map((id) => [id, { rating: initial?.[id].rating ?? "", percent: initial ? String(initial[id].percent) : "" }]),
      ) as Record<PmeQuestionId, Entry>,
  );
  const [ojt, setOjt] = useState<"YES" | "NO" | "">(initial?.ojtConducted == null ? "" : initial.ojtConducted ? "YES" : "NO");

  const set = (id: PmeQuestionId, patch: Partial<Entry>) => setEntries((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  /** Picking a band clears a percentage that doesn't belong to it. */
  const pick = (id: PmeQuestionId, rating: PmeRating) => {
    const band = pmeBand(rating);
    const n = Number(entries[id].percent);
    set(id, { rating, percent: entries[id].percent && n >= band.min && n <= band.max ? entries[id].percent : "" });
  };

  const percents = PME_QUESTION_IDS.map((id) => (/^\d{1,3}$/.test(entries[id].percent) ? Number(entries[id].percent) : null));
  const complete = percents.every((p) => p !== null);
  const total = percents.reduce<number>((sum, p) => sum + (p ?? 0), 0);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormMessage state={state} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-sunken px-4 py-3 text-[12.5px] sm:grid-cols-3 lg:grid-cols-6" aria-label="Rating bands">
        {PME_BANDS.map((b) => (
          <div key={b.value}>
            <dt className="font-medium text-ink">{b.label}</dt>
            <dd className="num text-[11.5px] text-ink-3">
              {b.min}–{b.max}%
            </dd>
          </div>
        ))}
      </dl>

      {PME_V1.questions.map((q, i) => {
        const entry = entries[q.id];
        const band = entry.rating ? pmeBand(entry.rating) : null;
        const ratingName = pmeField(q.id, "rating");
        const percentName = pmeField(q.id, "percent");
        const remarksName = pmeField(q.id, "remarks");
        const ratingError = errors?.[ratingName]?.[0];
        const percentError = errors?.[percentName]?.[0];
        const remarksError = errors?.[remarksName]?.[0];
        const first = q.id === "q1";
        return (
          <section key={q.id} className="flex flex-col gap-3.5">
            {(i === 0 || PME_V1.questions[i - 1].section !== q.section) && <h3 className="ruled-heading">{q.section}</h3>}

            <fieldset aria-invalid={ratingError ? true : undefined} aria-describedby={ratingError ? `${ratingName}-error` : undefined}>
              <legend className="req mb-2.5 text-[13.5px] font-medium text-ink">
                <span className="num mr-1.5 text-ink-3">{i + 1}.</span>
                {q.text}
              </legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
                {PME_BANDS.map((b) => (
                  <label
                    key={b.value}
                    className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] leading-tight transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium has-[:checked]:text-accent-deep has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent hover:bg-sunken ${
                      ratingError ? "border-bad/60" : "border-rule-strong"
                    }`}
                  >
                    <input
                      type="radio"
                      name={ratingName}
                      value={b.value}
                      checked={entry.rating === b.value}
                      onChange={() => pick(q.id, b.value)}
                      className="accent-accent"
                    />
                    {b.label}
                  </label>
                ))}
              </div>
              {ratingError && (
                <div id={`${ratingName}-error`} className="field-error">
                  {ratingError}
                </div>
              )}
            </fieldset>

            <div className="w-full sm:w-64">
              <label htmlFor={percentName} className="label req">
                Percentage for question {i + 1}
              </label>
              <div className="relative">
                <input
                  id={percentName}
                  name={percentName}
                  value={entry.percent}
                  onChange={(e) => set(q.id, { percent: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                  inputMode="numeric"
                  autoComplete="off"
                  className="input num pr-8"
                  placeholder={band ? `${band.min} to ${band.max}` : "Choose a rating first"}
                  aria-invalid={percentError ? true : undefined}
                  aria-describedby={percentError ? `${percentName}-error` : `${percentName}-hint`}
                />
                <span aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-3">
                  %
                </span>
              </div>
              {percentError ? (
                <div id={`${percentName}-error`} className="field-error">
                  {percentError}
                </div>
              ) : (
                <div id={`${percentName}-hint`} className="hint">
                  {band ? `${band.label} is ${band.min} to ${band.max}.` : "A whole number inside the rating's band."}
                </div>
              )}
            </div>

            {first && (
              <fieldset aria-invalid={errors?.ojtConducted ? true : undefined} aria-describedby={errors?.ojtConducted ? "ojtConducted-error" : undefined}>
                <legend className="req mb-2 text-[13.5px] font-medium text-ink">{PME_V1.ojt.text}</legend>
                <div className="grid max-w-xs grid-cols-2 gap-1.5">
                  {(["YES", "NO"] as const).map((v) => (
                    <label
                      key={v}
                      className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium has-[:checked]:text-accent-deep has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent hover:bg-sunken ${
                        errors?.ojtConducted ? "border-bad/60" : "border-rule-strong"
                      }`}
                    >
                      <input type="radio" name="ojtConducted" value={v} checked={ojt === v} onChange={() => setOjt(v)} className="accent-accent" />
                      {v === "YES" ? "Yes" : "No"}
                    </label>
                  ))}
                </div>
                {errors?.ojtConducted && (
                  <div id="ojtConducted-error" className="field-error">
                    {errors.ojtConducted[0]}
                  </div>
                )}
              </fieldset>
            )}

            <div>
              <label htmlFor={remarksName} className={`label ${first ? "req" : ""}`}>
                Remarks for question {i + 1}
              </label>
              <textarea
                id={remarksName}
                name={remarksName}
                defaultValue={initial?.[q.id].remarks ?? ""}
                maxLength={MAX_PME_REMARKS}
                rows={first ? 3 : 2}
                className="textarea"
                aria-invalid={remarksError ? true : undefined}
                aria-describedby={remarksError ? `${remarksName}-error` : first ? `${remarksName}-hint` : undefined}
              />
              {remarksError ? (
                <div id={`${remarksName}-error`} className="field-error">
                  {remarksError}
                </div>
              ) : (
                first && (
                  <div id={`${remarksName}-hint`} className="hint">
                    {PME_V1.ojt.remarks}
                  </div>
                )
              )}
            </div>
          </section>
        );
      })}

      <div
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg bg-sunken px-4 py-3 text-[13.5px]"
        role="status"
        aria-label="Mark so far"
      >
        <span className="text-ink-2">
          Total <span className="num font-semibold text-ink">{complete ? total : "–"}</span> of 400
        </span>
        <span className="text-ink-2">
          Average mark{" "}
          <span className="num text-[17px] font-semibold text-ink">{complete ? (total / 4).toLocaleString("en-MY", { maximumFractionDigits: 2 }) : "–"}</span>{" "}
          out of 100
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-5">
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Submit evaluation
        </SubmitButton>
        <Link href={cancelHref} className="btn btn-ghost">
          Cancel
        </Link>
        <span className="text-xs text-ink-3">{staffName} then acknowledges it, and the L&amp;D unit verifies it.</span>
      </div>
    </form>
  );
}
