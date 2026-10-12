import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardCheck, ScanSearch, Target, type LucideIcon } from "lucide-react";
import { BarList } from "@/components/charts/BarList";
import { StackedColumnChart, type StackSeries } from "@/components/charts/StackedColumnChart";
import { Panel } from "@/components/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Status } from "@/components/ui/Status";
import { formatDate, plural } from "@/lib/format";
import { TONE, type Tone } from "@/lib/tones";
import { percent } from "@/server/rules/dashboard";
import { PME_STAGE_LABELS, type PmeStage } from "@/server/rules/pme";
import { quarterLabel, quarterParam, SKILL_STAGE_LABELS, type SkillStage } from "@/server/rules/skill";
import { TNA_STAGE_LABELS, type TnaStage } from "@/server/rules/tna";
import type { ProgressDashboard } from "@/server/services/dashboard";

// The Dashboard's third tab: how far each department has got with PME, the
// skill matrix, TNA and TNI. Four cards say how much is finished; a chart for
// each of the first three shows where every department's records stand.
//
// Colours mean the same in every chart: teal is finished, gold is waiting on
// someone, coral needs attention, grey hasn't started.

// Drawn from the bottom of a column up: what is finished first, what hasn't started last.
const PME_ORDER = ["VERIFIED", "TO_VERIFY", "TO_ACKNOWLEDGE", "TO_EVALUATE", "IN_PERIOD"] as const satisfies readonly PmeStage[];
const PME_COLOR: Record<(typeof PME_ORDER)[number], string> = {
  VERIFIED: "bg-accent",
  TO_VERIFY: "bg-cobalt",
  TO_ACKNOWLEDGE: "bg-marigold",
  TO_EVALUATE: "bg-coral",
  IN_PERIOD: "bg-slate/30",
};
const STEP_ORDER = ["APPROVED", "SUBMITTED", "RETURNED", "DRAFT", "NOT_STARTED"] as const satisfies readonly (SkillStage & TnaStage)[];
const STEP_COLOR: Record<(typeof STEP_ORDER)[number], string> = {
  APPROVED: "bg-accent",
  SUBMITTED: "bg-marigold",
  RETURNED: "bg-coral",
  DRAFT: "bg-slate",
  NOT_STARTED: "bg-slate/30",
};

type Department = ProgressDashboard["tni"][number]["department"];
type Counts<S extends string> = { rows: { department: Department; counts: Record<S, number> }[]; total: Record<S, number> };

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, n) => a + n, 0);

export function ProgressTab({ data, period }: { data: ProgressDashboard; period: { from: string; to: string } }) {
  const { pme, skill, tna, tni, quarter, year } = data;
  const several = tni.length > 1;
  // A PME still inside its evaluation period isn't due yet, so it isn't counted against the department.
  const pmeDue = sum(pme.total) - pme.total.IN_PERIOD;
  const skillAll = sum(skill.total);
  const tnaAll = sum(tna.total);
  const tniSaved = tni.filter((t) => t.tni).length;
  const pmeLink = `/pme?from=${period.from}&to=${period.to}`;
  const waiting = pme.rows
    .filter((r) => r.counts.TO_EVALUATE > 0)
    .sort((a, b) => b.counts.TO_EVALUATE - a.counts.TO_EVALUATE || a.department.name.localeCompare(b.department.name))
    .slice(0, 5);

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <section aria-label="Progress overview" className="lg:col-span-12">
        <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Done
            icon={ClipboardCheck}
            tone="coral"
            label="PME verified"
            done={pme.total.VERIFIED}
            of={pmeDue}
            note={pme.total.TO_EVALUATE ? `${pme.total.TO_EVALUATE} waiting for HOD` : "none waiting for HOD"}
            segments={PME_ORDER.filter((s) => s !== "IN_PERIOD").map((s) => ({ color: PME_COLOR[s], value: pme.total[s] }))}
          />
          <Done
            icon={Target}
            tone="olive"
            label={`Skill matrix approved, ${quarterLabel(quarter)}`}
            done={skill.total.APPROVED}
            of={skillAll}
            note={`${skill.total.NOT_STARTED} not started`}
            segments={STEP_ORDER.map((s) => ({ color: STEP_COLOR[s], value: skill.total[s] }))}
          />
          <Done
            icon={BookOpen}
            tone="jade"
            label={`TNA approved, ${year}`}
            done={tna.total.APPROVED}
            of={tnaAll}
            note={`${tna.total.NOT_STARTED} not started`}
            segments={STEP_ORDER.map((s) => ({ color: STEP_COLOR[s], value: tna.total[s] }))}
          />
          <Done
            icon={ScanSearch}
            tone="cobalt"
            label={`TNI saved, ${year}`}
            done={tniSaved}
            of={tni.length}
            note={`${tni.length - tniSaved} not yet`}
            unit="department"
            segments={[
              { color: "bg-accent", value: tniSaved },
              { color: "bg-slate/30", value: tni.length - tniSaved },
            ]}
          />
        </dl>
      </section>

      <StageChart
        title="PME by department"
        description="PMEs of trainings that started in the period, by where each stands. One still in its evaluation period isn't due yet."
        link={{ href: pmeLink, label: "PME list" }}
        series={PME_ORDER.map((s) => ({ label: PME_STAGE_LABELS[s], color: PME_COLOR[s] }))}
        order={PME_ORDER}
        data={pme}
        empty="No PME for trainings in this period"
        what="PMEs"
      />

      <StageChart
        title={`Skill matrix by department, ${quarterLabel(quarter)}`}
        description="Non-executive and contract staff, by where each one's matrix stands for the quarter being filled in"
        link={{ href: `/skill-matrix?quarter=${quarterParam(quarter)}`, label: "Skill matrix list" }}
        series={STEP_ORDER.map((s) => ({ label: SKILL_STAGE_LABELS[s], color: STEP_COLOR[s] }))}
        order={STEP_ORDER}
        data={skill}
        empty="No one needs a skill matrix"
        what="staff"
      />

      <StageChart
        title={`TNA by department, ${year}`}
        description="Each person who fills in their own TNA, and each job grade's TNA, by where it stands for the year being filled in"
        link={{ href: `/tna?year=${year}`, label: "TNA list" }}
        series={STEP_ORDER.map((s) => ({ label: TNA_STAGE_LABELS[s], color: STEP_COLOR[s] }))}
        order={STEP_ORDER}
        data={tna}
        empty="No TNA is due"
        what="TNAs"
      />

      <Panel
        className={several ? "lg:col-span-6" : "lg:col-span-12"}
        title={`TNI by department, ${year}`}
        description="Whether each department has saved its training needs identification for the year"
        action={
          <Link href={`/tni?year=${year}`} className="link inline-flex items-center gap-1 font-medium">
            TNI list <ArrowRight size={13} aria-hidden />
          </Link>
        }
        flush
      >
        <ul aria-label="TNI by department">
          {tni.map(({ department, tni: saved }) => (
            <li key={department.id} className="flex items-center justify-between gap-4 border-b border-rule px-5 py-2.5 text-[13px] last:border-b-0">
              <span className="min-w-0 truncate font-medium text-ink">{department.name}</span>
              {saved ? (
                <Status tone="ok">
                  Saved {formatDate(saved.updatedAt)} · {plural(saved._count.items, "row")}
                </Status>
              ) : (
                <Status tone="wait">Not yet</Status>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {several && (
        <Panel
          className="lg:col-span-6"
          title="PMEs waiting for the HOD"
          description="The departments with the most PMEs whose evaluation period has ended and which the HOD hasn't evaluated"
        >
          {waiting.length ? (
            <BarList
              label="Departments with the most PMEs waiting for the HOD"
              numbered
              color="bg-coral"
              rows={waiting.map((r) => ({
                key: r.department.id,
                label: r.department.name,
                sub: r.department.hod ? `HOD: ${r.department.hod.name}` : "No HOD",
                value: r.counts.TO_EVALUATE,
                text: String(r.counts.TO_EVALUATE),
                note: `of ${plural(sum(r.counts) - r.counts.IN_PERIOD, "PME")} due`,
                href: `${pmeLink}&stage=TO_EVALUATE&department=${r.department.id}`,
              }))}
            />
          ) : (
            <EmptyState compact icon={ClipboardCheck} title="No PME is waiting for a HOD">
              Departments appear here when an evaluation period ends and the PME hasn&apos;t been evaluated.
            </EmptyState>
          )}
        </Panel>
      )}
    </div>
  );
}

/**
 * One workflow's card: its icon beside the share finished, its name, a bar
 * split by stage in the charts' colours, then the count and what is left.
 */
function Done({
  icon: Icon,
  tone,
  label,
  done,
  of,
  note,
  unit,
  segments,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  done: number;
  of: number;
  note: string;
  unit?: string;
  segments: { color: string; value: number }[];
}) {
  return (
    <div className="card grid min-w-0 grid-cols-[auto_1fr] content-start items-center gap-x-4 p-4 sm:p-5">
      <span aria-hidden className={`row-start-1 flex size-12 items-center justify-center rounded-xl ${TONE[tone].tile}`}>
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <dt className="col-span-2 row-start-2 mt-3 text-[13px] leading-snug font-medium text-ink-2">{label}</dt>
      <dd className="num col-start-2 row-start-1 text-[40px] leading-none font-semibold tracking-tight text-ink">{of > 0 ? `${percent(done, of)}%` : "–"}</dd>
      <dd className="col-span-2 row-start-3 mt-4">
        <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-sunken" aria-hidden>
          {segments.map((s, i) => (s.value > 0 ? <span key={i} className={s.color} style={{ flexGrow: s.value, flexBasis: 0, minWidth: 3 }} /> : null))}
        </div>
        <div className="mt-1.5 flex justify-between gap-3 text-xs text-ink-3">
          <span>
            <span className="num font-semibold text-ink">
              {done.toLocaleString("en-MY")} of {of.toLocaleString("en-MY")}
            </span>
            {unit ? ` ${of === 1 ? unit : `${unit}s`}` : ""}
          </span>
          <span>{note}</span>
        </div>
      </dd>
    </div>
  );
}

/** A workflow's chart: one column for each department, split by the stage its records stand at. */
function StageChart<S extends string>({
  title,
  description,
  link,
  series,
  order,
  data,
  empty,
  what,
}: {
  title: string;
  description: string;
  link: { href: string; label: string };
  series: StackSeries[];
  order: readonly S[];
  data: Counts<S>;
  empty: string;
  what: string;
}) {
  return (
    <Panel
      className="lg:col-span-12"
      title={title}
      description={description}
      action={
        <Link href={link.href} className="link inline-flex items-center gap-1 font-medium">
          {link.label} <ArrowRight size={13} aria-hidden />
        </Link>
      }
    >
      {sum(data.total) > 0 ? (
        <div className="overflow-x-auto pt-5">
          <div style={{ minWidth: data.rows.length * 52 }}>
            <StackedColumnChart
              series={series}
              data={data.rows.map((r) => ({
                label: r.department.shortName ?? r.department.name,
                short: r.department.shortName ?? r.department.name,
                title: r.department.name,
                values: order.map((s) => r.counts[s]),
              }))}
              caption={`${title}: ${what} at each stage`}
              format={(n) => n.toLocaleString("en-MY")}
              height={260}
              whole
            />
          </div>
        </div>
      ) : (
        <EmptyState compact icon={ClipboardCheck} title={empty}>
          Each department&apos;s column appears here once there is something to count.
        </EmptyState>
      )}
    </Panel>
  );
}
