import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CalendarDays, Check, GraduationCap, Hourglass, Lock, UserRound } from "lucide-react";
import { HistoryPanel, type HistoryFields } from "@/components/HistoryPanel";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { Fact, Row } from "@/components/RecordParts";
import { Status } from "@/components/ui/Status";
import { PME_V1, pmeBand } from "@/lib/forms/pme";
import { formatDate, formatDateRange, formatDateTime, formatHours, nowInMalaysia } from "@/lib/format";
import { DESIGNATION_LABELS } from "@/lib/validation/staff";
import { can } from "@/server/permissions";
import { PME_SHORT_HOURS, PME_STAGE_TONE, pmeOpensOn, type PmeStage } from "@/server/rules/pme";
import { getPme, pmeHistory, type PmeView } from "@/server/services/pme";
import { requireUser } from "@/server/session";
import { formatMark, pmeStageLabel } from "../labels";
import { AcknowledgeForm, SendBackPmeDialog, VerifyPmeDialog } from "../PmeActions";
import { PmeForm } from "../PmeForm";

export const metadata: Metadata = { title: "PME" };

const SAVED: Record<string, string> = {
  evaluated: "Evaluation submitted. The staff member can now acknowledge it.",
  acknowledged: "Thank you. You have acknowledged this evaluation; the L&D unit will verify it.",
};

/** The Malaysia-time day of a timestamp, e.g. when it was evaluated. */
const localDate = (d: Date) => formatDateTime(d).split(",")[0];

const PME_HISTORY_FIELDS: HistoryFields = {
  status: {
    label: "Status",
    format: (v) => ({ PENDING: "With the HOD", EVALUATED: "Evaluated", ACKNOWLEDGED: "Acknowledged", VERIFIED: "Verified" })[String(v)] ?? String(v),
  },
  averageMark: { label: "Average mark" },
  reason: { label: "Reason", listing: true },
  comment: { label: "Staff comment" },
};

export default async function PmePage({ params, searchParams }: PageProps<"/pme/[id]">) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const today = nowInMalaysia();
  // Only the person it is about, their HOD or division head, and L&D: anyone else's id is simply not found.
  const p = await getPme(user, id, today);
  if (!p) notFound();
  const history = can(user, "audit.view") ? await pmeHistory(id) : [];

  const { saved } = await searchParams;
  const { staff, training: t, viewer } = p;
  // Their own PME, opened from My training; everyone else comes from the PME list.
  const own = viewer.isSubject;
  const back = can(user, "pme.view") && !own ? { href: "/pme", label: "PME" } : { href: `/my-training/${p.participantId}`, label: "My training" };
  const canEvaluate = p.blocked.EVALUATE === null;
  const canAcknowledge = p.blocked.ACKNOWLEDGE === null;

  return (
    <div>
      <PageHeader
        module="pme"
        context={back}
        title={own ? t.title : staff.name}
        meta={
          <>
            {own ? (
              <span>Your performance evaluation</span>
            ) : (
              <>
                <span className="num">{staff.staffNo}</span>
                <span>{staff.department}</span>
                <span>{t.title}</span>
              </>
            )}
            <Status tone={PME_STAGE_TONE[p.stage]}>{pmeStageLabel(p.stage, own)}</Status>
          </>
        }
        actions={
          viewer.canVerify && (
            <>
              <SendBackPmeDialog pmeId={p.id} staffName={staff.name} hodName={p.evaluator?.name ?? null} hidden={p.blocked.SEND_BACK !== null} />
              <VerifyPmeDialog pmeId={p.id} staffName={staff.name} average={p.mark?.average ?? null} hidden={p.blocked.VERIFY !== null} />
            </>
          )
        }
      />

      {typeof saved === "string" && SAVED[saved] && (
        <div role="status" className="notice notice-ok mb-5">
          {SAVED[saved]}
        </div>
      )}
      {t.status === "CANCELLED" && <div className="notice notice-bad mb-5">This training was cancelled, so its PME is closed.</div>}
      {/* L&D, between the HOD's evaluation and the staff member's acknowledgement: why Verify isn't offered yet. */}
      {viewer.canVerify && p.status === "EVALUATED" && p.blocked.VERIFY && (
        <div className="notice notice-wait mb-5">{p.blocked.VERIFY} You can verify once they have.</div>
      )}

      <div className="flex flex-col gap-5">
        <section aria-label="At a glance" className="card p-5 sm:p-6">
          <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact icon={own ? UserRound : GraduationCap} label={own ? "Evaluated by" : "Training"}>
              {own ? (
                p.evaluator ? (
                  <>
                    {p.evaluator.name} <span className="text-ink-3">· your HOD</span>
                  </>
                ) : (
                  <span className="text-ink-3">Your department has no HOD yet</span>
                )
              ) : can(user, "training.view") ? (
                <Link href={`/trainings/${t.id}`} className="link">
                  {t.title}
                </Link>
              ) : (
                t.title
              )}
            </Fact>
            <Fact icon={CalendarDays} label="Training dates">
              <span className="num">{formatDateRange(t.startDate, t.endDate)}</span>
              <span className="num text-ink-3"> · {formatHours(t.hours)}</span>
            </Fact>
            <Fact icon={CalendarClock} label="Evaluation period">
              <span className="num">{formatDateRange(p.periodStart, p.periodEnd)}</span>
            </Fact>
            {own ? (
              <Fact icon={GraduationCap} label="Trainer">
                {t.trainerName ?? <span className="text-ink-3">Not recorded</span>}
              </Fact>
            ) : (
              <Fact icon={UserRound} label="HOD who evaluates">
                {p.evaluator ? p.evaluator.name : <span className="text-ink-3">None: the department has no active HOD</span>}
              </Fact>
            )}
          </dl>
          {p.status !== "NOT_REQUIRED" && <Steps p={p} />}
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-12">
          <Panel
            className="lg:col-span-8"
            title={PME_V1.title}
            description={
              canEvaluate
                ? `How well ${staff.name} has applied the training, three months on. Each question takes a rating and a percentage inside its band.`
                : p.answers
                  ? `${p.evaluatedBy?.name ?? "The HOD"}'s evaluation${p.evaluatedAt ? `, ${localDate(p.evaluatedAt)}` : ""}.`
                  : undefined
            }
          >
            {canEvaluate ? (
              <div className="flex flex-col gap-5">
                {p.returnReason && (
                  <div className="notice notice-wait flex-col gap-0.5">
                    <span className="font-medium">The L&amp;D unit sent this back{p.returnedAt && <> on {localDate(p.returnedAt)}</>}:</span>
                    <span>{p.returnReason}</span>
                  </div>
                )}
                <PmeForm pmeId={p.id} staffName={staff.name} initial={p.answers} cancelHref={back.href} />
              </div>
            ) : p.answers && p.status !== "PENDING" ? (
              <Evaluation p={p} />
            ) : (
              <Waiting p={p} own={own} />
            )}
          </Panel>

          <div className="flex min-w-0 flex-col gap-5 lg:col-span-4">
            {canAcknowledge && (
              <Panel title="Acknowledge" description="Read your HOD's evaluation, then acknowledge it. It goes to the L&D unit to verify.">
                <AcknowledgeForm pmeId={p.id} />
              </Panel>
            )}
            <Panel title="Record">
              <dl className="-my-1 flex flex-col text-[13.5px]">
                <Row label="Status">
                  <Status tone={PME_STAGE_TONE[p.stage]}>{pmeStageLabel(p.stage, own)}</Status>
                </Row>
                {!own && (
                  <Row label="Staff">
                    {can(user, "staff.view") ? (
                      <Link href={`/staff/${staff.id}`} className="link">
                        {staff.name}
                      </Link>
                    ) : (
                      staff.name
                    )}
                    <div className="text-xs text-ink-3">
                      {staff.position ?? DESIGNATION_LABELS[staff.designation]}
                      {staff.status === "RESIGNED" && " · resigned"}
                    </div>
                  </Row>
                )}
                {p.mark && p.status !== "PENDING" && (
                  <Row label="Mark">
                    <span className="num font-semibold">{formatMark(p.mark.average)}</span> <span className="text-ink-3">out of 100</span>
                  </Row>
                )}
                {p.evaluatedAt && p.status !== "PENDING" && (
                  <Row label="Evaluated">
                    <span className="num">{formatDateTime(p.evaluatedAt)}</span>
                    {p.evaluatedBy && <div className="text-xs text-ink-3">by {p.evaluatedBy.name}</div>}
                  </Row>
                )}
                {p.acknowledgedAt && (
                  <Row label="Acknowledged">
                    <span className="num">{formatDateTime(p.acknowledgedAt)}</span>
                  </Row>
                )}
                {p.verifiedAt && (
                  <Row label="Verified">
                    <span className="num">{formatDateTime(p.verifiedAt)}</span>
                    {p.verifiedBy && <div className="text-xs text-ink-3">by {p.verifiedBy.name}</div>}
                  </Row>
                )}
              </dl>
              {p.staffComment && (
                <div className="mt-4 rounded-lg bg-sunken px-3 py-2.5 text-[13px]">
                  <div className="text-xs text-ink-3">{own ? "Your comment" : `${staff.name}'s comment`}</div>
                  <p className="mt-0.5 whitespace-pre-line break-words">{p.staffComment}</p>
                </div>
              )}
              {/* Sent back and not yet evaluated again: said here for everyone but the HOD, who sees it above the form. */}
              {p.status === "PENDING" && p.returnReason && !canEvaluate && (
                <div className="mt-4 rounded-lg bg-sunken px-3 py-2.5 text-[13px]">
                  <div className="text-xs text-ink-3">Sent back to the HOD by the L&amp;D unit</div>
                  <p className="mt-0.5 break-words">{p.returnReason}</p>
                </div>
              )}
            </Panel>
          </div>
        </div>

        <HistoryPanel entries={history} fields={PME_HISTORY_FIELDS} />
      </div>
    </div>
  );
}

const STEP_ORDER: PmeStage[] = ["IN_PERIOD", "TO_EVALUATE", "TO_ACKNOWLEDGE", "TO_VERIFY", "VERIFIED"];

/** The path a PME takes, with where this one is. */
function Steps({ p }: { p: PmeView }) {
  const at = STEP_ORDER.indexOf(p.stage);
  const steps = [
    { title: "Evaluation period", detail: `Until ${formatDate(p.periodEnd)}` },
    {
      title: "HOD evaluates",
      detail: at > 1 && p.evaluatedAt ? `${localDate(p.evaluatedAt)}${p.evaluatedBy ? `, ${p.evaluatedBy.name}` : ""}` : `From ${formatDate(pmeOpensOn(p))}`,
    },
    { title: "Staff acknowledges", detail: p.acknowledgedAt ? localDate(p.acknowledgedAt) : "After the evaluation" },
    { title: "L&D verifies", detail: p.verifiedAt ? localDate(p.verifiedAt) : "After the acknowledgement" },
  ];
  return (
    <ol aria-label="Progress" className="mt-5 grid gap-x-4 gap-y-3 border-t border-rule pt-5 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s, i) => {
        const state = i < at ? "done" : i === at ? "now" : "next";
        return (
          <li key={s.title} className="flex gap-3" aria-current={state === "now" ? "step" : undefined}>
            <span
              aria-hidden
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                state === "done"
                  ? "bg-accent text-white"
                  : state === "now"
                    ? "bg-accent-soft text-accent-deep ring-2 ring-accent"
                    : "border border-rule-strong bg-surface text-ink-3"
              }`}
            >
              {state === "done" ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0">
              <div className={`text-[13.5px] ${state === "next" ? "text-ink-2" : "font-medium"}`}>
                {s.title}
                {state === "done" && <span className="sr-only"> (done)</span>}
              </div>
              <div className="num text-xs text-ink-3">{s.detail}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The HOD's evaluation, read-only: each question with its rating, percentage and remarks, then the mark. */
function Evaluation({ p }: { p: PmeView }) {
  const a = p.answers!;
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col">
        {PME_V1.questions.map((q, i) => {
          const answer = a[q.id];
          return (
            <li key={q.id} className="border-b border-rule py-3.5 first:pt-0 last:border-b-0">
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-[1fr_auto]">
                <p className="text-[13.5px] text-ink-2">
                  <span className="num mr-1.5 text-ink-3">{i + 1}.</span>
                  {q.text}
                </p>
                <p className="text-[13.5px] whitespace-nowrap">
                  <span className="font-medium">{pmeBand(answer.rating).label}</span> <span className="num font-semibold">· {answer.percent}%</span>
                </p>
              </div>
              {q.id === "q1" && (
                <p className="mt-1.5 text-[13px]">
                  <span className="text-ink-3">OJT conducted:</span>{" "}
                  <span className="font-medium">{a.ojtConducted === null ? "Not recorded" : a.ojtConducted ? "Yes" : "No"}</span>
                </p>
              )}
              {answer.remarks && (
                <p className="mt-1.5 text-[13px] break-words whitespace-pre-line">
                  <span className="text-ink-3">Remarks:</span> {answer.remarks}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {p.mark && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg bg-sunken px-4 py-3 text-[13.5px]">
          <span className="text-ink-2">
            Total <span className="num font-semibold text-ink">{p.mark.total}</span> of 400
          </span>
          <span className="text-ink-2">
            Average mark <span className="num text-[17px] font-semibold text-ink">{formatMark(p.mark.average)}</span> out of 100
          </span>
        </div>
      )}
    </div>
  );
}

/** No evaluation to show yet (or ever), and why. */
function Waiting({ p, own }: { p: PmeView; own: boolean }) {
  const hod = p.evaluator?.name;
  let text: string;
  if (p.training.status === "CANCELLED") text = "This training was cancelled, so there is nothing to evaluate.";
  else if (p.status === "NOT_REQUIRED")
    // A longer training's comes from the old system's "not applicable": a PME no one could evaluate.
    text =
      p.training.hours !== null && p.training.hours > PME_SHORT_HOURS
        ? "The old system marked this PME not applicable: no one could evaluate it (only executives and managers with a HOD are evaluated, and not HODs, division heads or staff who have left)."
        : `This training was ${PME_SHORT_HOURS} hours or less, so no evaluation is needed.`;
  // Brought from the old system, which marked many PMEs done without keeping the HOD's answers.
  else if (p.status !== "PENDING")
    text = "This PME was completed in the old system, which kept no record of the evaluation itself. Only where it got to came across.";
  else if (p.viewer.isApprover && p.blocked.EVALUATE) text = p.blocked.EVALUATE;
  else if (p.staff.status !== "ACTIVE") text = `${p.staff.name} has resigned, so this PME won't be evaluated.`;
  else if (p.stage === "IN_PERIOD")
    text = own
      ? `Your evaluation period runs until ${formatDate(p.periodEnd)}. ${hod ?? "Your HOD"} evaluates how you've applied the training after that.`
      : `The evaluation period runs until ${formatDate(p.periodEnd)}. ${hod ?? "The HOD"} can evaluate from ${formatDate(pmeOpensOn(p))}.`;
  else if (!hod)
    text = own
      ? "Your department has no HOD at the moment, so no one can evaluate this yet."
      : `${p.staff.department} has no active HOD, so no one can evaluate this yet. Set one in Organization.`;
  else text = own ? `Waiting for ${hod} to evaluate you.` : `Waiting for ${hod} to evaluate, since ${formatDate(pmeOpensOn(p))}.`;
  return (
    <div className="flex items-start gap-3 rounded-lg bg-sunken px-4 py-3.5 text-[13.5px] text-ink-2">
      {p.stage === "IN_PERIOD" || p.stage === "TO_EVALUATE" ? (
        <Hourglass size={17} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
      ) : (
        <Lock size={17} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
      )}
      <p>{text}</p>
    </div>
  );
}
