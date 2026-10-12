import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  ChartColumnStacked,
  FileDown,
  GraduationCap,
  Presentation,
  UserCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { DivisionMark } from "@/components/brand";
import { BarList } from "@/components/charts/BarList";
import { ColumnChart } from "@/components/charts/ColumnChart";
import { StackedColumnChart, type StackSeries } from "@/components/charts/StackedColumnChart";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { withBasePath } from "@/lib/base-path";
import { formatHours, formatMoney, nowInMalaysia, plural } from "@/lib/format";
import { divisionTone, TONE, type Tone } from "@/lib/tones";
import { DESIGNATION_LABELS, type DESIGNATIONS } from "@/lib/validation/staff";
import { TRAINING_TYPE_LABELS, TRAINING_TYPES, type TrainingTypeCode } from "@/lib/validation/training";
import { perHead, type Bucket } from "@/server/rules/dashboard";
import { progressDashboard, trainingDashboard, type TrainingDashboard } from "@/server/services/dashboard";
import { requirePermission } from "@/server/session";
import { parseReportFilters, reportQuery } from "../reports/filters";
import { PeriodLabel, ReportFilterBar } from "../reports/ReportParts";
import { CostYear } from "./CostYear";
import { ProgressTab } from "./ProgressTab";

export const metadata: Metadata = { title: "Dashboard" };

// One colour per training type, the same wherever the types are charted.
const TYPE_COLOR: Record<TrainingTypeCode, { bar: string; text: string }> = {
  PUBLIC_INHOUSE: { bar: "bg-accent", text: "text-accent" },
  OJT: { bar: "bg-marigold", text: "text-marigold" },
};
const SERIES: StackSeries[] = TRAINING_TYPES.map((t) => ({ label: TRAINING_TYPE_LABELS[t], color: TYPE_COLOR[t].bar }));

// Designation colours, the same as the department make-up bar on the overview.
const DESIGNATION_TONE: Record<(typeof DESIGNATIONS)[number], Tone> = {
  MANAGER: "plum",
  EXECUTIVE: "cobalt",
  NON_EXECUTIVE: "jade",
  CONTRACT: "marigold",
  TRAINEE: "coral",
};

const TABS = [
  { key: "total", label: "Total man hour" },
  { key: "average", label: "Average total hour" },
  { key: "progress", label: "Progress" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** 2,500 → "2.5K" beside a chart's axis, where "RM 2,500.00" doesn't fit. */
const compactMoney = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString("en-MY", { maximumFractionDigits: 1 })}K` : n.toLocaleString("en-MY", { maximumFractionDigits: 0 });

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Training in charts, for the same people as the reports and adding up the
 * same way: L&D see all of PHN, a HOD their departments, a division head
 * their divisions. Three tabs: total man hours (?tab=total, the default) and
 * average hours per person (?tab=average), as on the old system's dashboard,
 * and how far each department has got with PME, the skill matrix, TNA and TNI
 * (?tab=progress).
 * The only filter is the period; the cost chart can also be set to one year
 * (?costYear=2026).
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requirePermission("report.view");
  const sp = await searchParams;
  // Only the period: a division or department in the address is ignored.
  const { from, to } = parseReportFilters(sp);
  const f = { from, to };
  const tab: TabKey = TABS.find((t) => t.key === one(sp.tab))?.key ?? "total";
  const today = nowInMalaysia();
  const costYear = /^\d{4}$/.test(one(sp.costYear)) ? Number(one(sp.costYear)) : undefined;
  // Each tab loads only its own figures.
  const [data, progress] = await Promise.all([
    tab === "progress" ? null : trainingDashboard(user, f, today, costYear),
    tab === "progress" ? progressDashboard(user, f, today) : null,
  ]);
  const period = (data ?? progress)!.period;
  const departmentCount = data ? data.departments.length : progress!.tni.length;
  const shownCostYear = data ? (data.cost?.year ?? null) : (costYear ?? null);

  const query = (key: TabKey) => {
    const params = new URLSearchParams(reportQuery(f));
    if (key !== "total") params.set("tab", key);
    if (shownCostYear) params.set("costYear", String(shownCostYear));
    const s = params.toString();
    return s ? `?${s}` : "";
  };
  // The same period (and a department) in a report.
  const report = (key: string, departmentId?: number) => `/reports/${key}${reportQuery({ from, to, departmentId })}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        module="dashboard"
        title="Dashboard"
        meta={
          <>
            <span>{tab === "progress" ? "PME, skill matrix, TNA and TNI" : "Training"}</span>
            <PeriodLabel period={period} />
            <span>{(data ?? progress)!.isAdmin ? "All of PHN" : plural(departmentCount, "department")}</span>
          </>
        }
        actions={
          <a href={withBasePath(`/dashboard/export${query("total")}`)} className="btn">
            <FileDown size={15} aria-hidden /> Export to Excel
          </a>
        }
      />

      <div className="-mt-5">
        <ReportFilterBar f={f} period={period} departments={[]} clearHref={`/dashboard${tab === "total" ? "" : `?tab=${tab}`}`}>
          {tab !== "total" && <input type="hidden" name="tab" value={tab} />}
          {shownCostYear && <input type="hidden" name="costYear" value={shownCostYear} />}
        </ReportFilterBar>
      </div>

      <nav aria-label="Dashboard" className="flex gap-1 border-b border-rule">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/dashboard${query(t.key)}`}
              aria-current={active ? "page" : undefined}
              className={`border-b-2 px-3 py-2 text-[13.5px] whitespace-nowrap ${
                active ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover:border-rule-strong hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {progress ? (
        <ProgressTab data={progress} period={period} />
      ) : tab === "average" ? (
        <AverageTab data={data!} report={report} />
      ) : (
        <TotalTab data={data!} report={report} />
      )}
    </div>
  );
}

type TabProps = { data: TrainingDashboard; report: (key: string, departmentId?: number) => string };

// ---------- Total man hour ----------

// The tabs are bento grids: tiles of different sizes on twelve columns, the
// one figure that matters most on a dark tile, the rest white. On a phone
// every tile is a full-width row, the small figures two to a row.

function TotalTab({ data, report }: TabProps) {
  const { overview, trend, top, cost, buckets } = data;
  const byDepartment = [...data.departments].sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
  // Public / In-house against OJT, as on the old dashboard's pie: here a bar on the total, each part with its share.
  const share = (hours: number) => `${overview.hours > 0 ? Math.round((hours / overview.hours) * 100) : 0}%`;
  const publicShare = overview.hours > 0 ? (overview.hoursByType.PUBLIC_INHOUSE / overview.hours) * 100 : 0;
  const months = buckets.map((b, i) => ({ label: b.label, short: b.short, title: b.title, group: String(b.year), future: b.future, values: data.byType[i] }));
  // Each division with its departments (most hours first) and their hours added up, in the divisions' usual order.
  const divisions = [...new Map(data.departments.map((d) => [d.division.id, d.division])).values()].map((division) => {
    const departments = byDepartment.filter((d) => d.division.id === division.id);
    return {
      ...division,
      departments,
      hours: Math.round(departments.reduce((sum, d) => sum + d.hours, 0) * 100) / 100,
      headcount: departments.reduce((sum, d) => sum + d.headcount, 0),
    };
  });
  // The busiest month, for the line under the hours chart.
  const monthHours = data.byType.map((values) => values.reduce((a, h) => a + h, 0));
  const peak = monthHours.indexOf(Math.max(...monthHours));
  const active = monthHours.filter((h) => h > 0).length;
  const past = buckets.filter((b) => !b.future).length;

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* Training overview: total hours on the dark tile with its two parts; the four counts beside it, each with how it is spread. */}
      <section aria-label="Training overview" className="grid gap-5 lg:col-span-12 lg:grid-cols-12">
        <dl className="relative flex flex-col justify-between gap-8 overflow-hidden rounded-xl bg-night p-6 text-white sm:p-7 lg:col-span-5">
          {/* The LDMS steps, faint, in the corner, as on the overview's hero. */}
          <svg aria-hidden viewBox="0 0 84 88" className="absolute right-6 bottom-0 hidden h-32 text-white opacity-[0.06] sm:block" fill="currentColor">
            {[34, 52, 70, 88].map((h, i) => (
              <rect key={h} x={i * 22} y={88 - h} width="16" height={h} rx="3" />
            ))}
          </svg>
          <div className="relative">
            <dt className="text-[13px] text-night-text">Total hours</dt>
            <dd className="num mt-2 text-[56px] leading-none font-semibold tracking-tight">{formatHours(overview.hours)}</dd>
            <dd className="mt-3 text-[13px] text-night-text">
              <span className="num font-semibold text-white">{formatHours(perHead(overview.hours, overview.manpower))}</span> for each person in the manpower
            </dd>
          </div>
          <div className="relative">
            <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-night-2" aria-hidden>
              {overview.hoursByType.PUBLIC_INHOUSE > 0 && <span className="bg-accent-bright" style={{ width: `${publicShare}%` }} />}
              {overview.hoursByType.OJT > 0 && <span className="flex-1 bg-marigold" />}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-6">
              <div>
                <dt className="flex items-center gap-1.5 text-[12.5px] text-night-muted">
                  <span aria-hidden className="size-2 shrink-0 rounded-[2px] bg-accent-bright" />
                  Total public training hours
                </dt>
                <dd className="num mt-1 text-[26px] leading-tight font-semibold">
                  {formatHours(overview.hoursByType.PUBLIC_INHOUSE)}
                  <span className="ml-2 text-[15px] font-medium text-night-text">{share(overview.hoursByType.PUBLIC_INHOUSE)}</span>
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-[12.5px] text-night-muted">
                  <span aria-hidden className="size-2 shrink-0 rounded-[2px] bg-marigold" />
                  Total OJT hours
                </dt>
                <dd className="num mt-1 text-[26px] leading-tight font-semibold">
                  {formatHours(overview.hoursByType.OJT)}
                  <span className="ml-2 text-[15px] font-medium text-night-text">{share(overview.hoursByType.OJT)}</span>
                </dd>
              </div>
            </div>
          </div>
        </dl>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-7">
          <Tile icon={GraduationCap} tone="marigold" label="Total trainings" value={String(overview.trainings)}>
            <MiniColumns values={trend.trainings} buckets={buckets} color={TONE.marigold.bar} what="trainings" />
          </Tile>
          <Tile icon={UserCheck} tone="jade" label="Total participant attend training" value={String(overview.attended)}>
            <MiniColumns values={trend.attended} buckets={buckets} color={TONE.jade.bar} what="people" />
          </Tile>
          <Tile icon={Users} tone="cobalt" label="Total manpower" value={overview.manpower.toLocaleString("en-MY")}>
            {/* Who the manpower is: one segment for each designation. */}
            <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
              {overview.manpowerByDesignation.map((d) => (
                <span key={d.designation} className={TONE[DESIGNATION_TONE[d.designation]].bar} style={{ flexGrow: d.count, flexBasis: 0, minWidth: 3 }} />
              ))}
            </div>
            <ul aria-label="Manpower by designation" className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-3">
              {overview.manpowerByDesignation.map((d) => (
                <li key={d.designation} className="flex items-center gap-1.5">
                  <span aria-hidden className={`size-2 rounded-[2px] ${TONE[DESIGNATION_TONE[d.designation]].bar}`} />
                  {DESIGNATION_LABELS[d.designation]} <span className="num font-semibold text-ink">{d.count.toLocaleString("en-MY")}</span>
                </li>
              ))}
            </ul>
          </Tile>
          <Tile icon={CalendarDays} tone="plum" label="Total training days" value={overview.days.toLocaleString("en-MY")}>
            <MiniColumns values={trend.days} buckets={buckets} color={TONE.plum.bar} what="days" />
          </Tile>
        </dl>
      </section>

      <Panel
        className={cost ? "lg:col-span-6" : "lg:col-span-12"}
        title="Training hours by month"
        description={`Completed hours, by the ${data.unit} the training started`}
        action={
          <Link href={report("attendance")} className="link inline-flex items-center gap-1 font-medium">
            Trainings <ArrowRight size={13} aria-hidden />
          </Link>
        }
      >
        {overview.hours > 0 ? (
          <>
            <StackedColumnChart
              series={SERIES}
              data={months}
              caption={`Total hours by ${data.unit} and training type`}
              format={(n) => formatHours(n)}
              height={340}
            />
            {/* What the chart says, in words. */}
            <p className="mt-4 border-t border-rule pt-3 text-[13px] text-ink-2">
              Busiest {data.unit}: <strong className="font-semibold text-ink">{buckets[peak].title}</strong>, {formatHours(monthHours[peak])} (
              {Math.round((monthHours[peak] / overview.hours) * 100)}% of the period). Training was completed in{" "}
              <strong className="font-semibold text-ink">
                {active} of {plural(past, data.unit)}
              </strong>{" "}
              so far.
            </p>
          </>
        ) : (
          <EmptyState compact icon={ChartColumnStacked} title="No completed training in this period">
            Hours appear here once attendance is recorded as completed.
          </EmptyState>
        )}
      </Panel>

      {cost && (
        <Panel
          className="lg:col-span-6"
          title="Monthly total cost (RM)"
          description={
            cost.year
              ? `Trainings that started in ${cost.year}; cancelled ones not counted`
              : "Trainings that started in the period above; cancelled ones not counted"
          }
        >
          {/* The chart's own year sits with its total, so the title keeps the card's width on a phone. */}
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="num text-[28px] leading-none font-semibold tracking-tight text-ink">{formatMoney(cost.total)}</div>
              <div className="mt-1.5 text-xs text-ink-3">total entered</div>
            </div>
            <CostYear years={cost.years} year={cost.year} />
          </div>
          {cost.total > 0 ? (
            <ColumnChart
              data={cost.buckets.map((b, i) => ({ label: b.label, short: b.short, title: b.title, value: cost.byBucket[i], future: b.future }))}
              caption={`Course cost by ${cost.unit}`}
              format={(n) => formatMoney(n)}
              axisFormat={compactMoney}
              labelFormat={compactMoney}
              height={300}
            />
          ) : (
            <EmptyState compact icon={Banknote} title={cost.year ? `No cost entered in ${cost.year}` : "No cost entered in this period"}>
              A training&apos;s cost is entered on its form.
            </EmptyState>
          )}
          {cost.withoutCost > 0 && (
            <p className="mt-4 rounded-lg bg-wait-soft px-3 py-2 text-[13px] text-ink-2">
              <strong className="font-semibold text-ink">{plural(cost.withoutCost, "training")}</strong> {cost.withoutCost === 1 ? "has" : "have"} no cost
              entered, so the real total is higher. {plural(cost.withCost, "training")} {cost.withCost === 1 ? "has" : "have"} one. OJT has no cost and
              isn&apos;t counted.
            </p>
          )}
        </Panel>
      )}

      {/* One department has nothing to be compared with. */}
      {byDepartment.length > 1 && (
        <Panel
          className="lg:col-span-12"
          title="All Department List (Total Man Hour)"
          description="Completed hours of each department's staff, the most first"
          action={
            <Link href={report("department-hours")} className="link inline-flex items-center gap-1 font-medium">
              Department report <ArrowRight size={13} aria-hidden />
            </Link>
          }
        >
          {/* With many departments the chart keeps its columns readable and slides sideways inside the card. */}
          <div className="overflow-x-auto pt-5">
            <div style={{ minWidth: byDepartment.length * 52 }}>
              <ColumnChart
                data={byDepartment.map((d) => ({
                  label: d.shortName ?? d.name,
                  short: d.shortName ?? d.name,
                  title: d.name,
                  value: d.hours,
                }))}
                caption="Total man hours by department"
                format={(n) => formatHours(n)}
                height={280}
              />
            </div>
          </div>
        </Panel>
      )}

      {/* The same hours division by division: one chart for each, with its departments. */}
      {divisions.length > 1 &&
        divisions.map((division, n) => (
          <Panel
            key={division.id}
            // An odd one out at the end takes the whole row.
            className={n === divisions.length - 1 && divisions.length % 2 === 1 ? "lg:col-span-12" : "lg:col-span-6"}
            title={
              <span className="inline-flex items-center gap-2">
                <DivisionMark tone={divisionTone(division.id)} />
                {division.name} (Total Man Hour)
              </span>
            }
            description={`${plural(division.departments.length, "department")} · headcount ${division.headcount.toLocaleString("en-MY")}`}
            action={<span className="num text-[15px] font-semibold text-ink">{formatHours(division.hours)}</span>}
          >
            <div className="overflow-x-auto pt-5">
              <div style={{ minWidth: division.departments.length * 52 }}>
                <ColumnChart
                  data={division.departments.map((d) => ({ label: d.shortName ?? d.name, short: d.shortName ?? d.name, title: d.name, value: d.hours }))}
                  caption={`Total man hours by department, ${division.name}`}
                  format={(h) => formatHours(h)}
                  color={TONE[divisionTone(division.id)].bar}
                  height={200}
                />
              </div>
            </div>
          </Panel>
        ))}

      {/* Three rankings side by side: who learnt the most, who taught the most, which trainings gave the most. */}
      <Panel
        className="lg:col-span-4"
        title="Top 5 most hours"
        description="Staff with the most completed hours"
        action={
          <Link href={report("staff-hours")} className="link inline-flex items-center gap-1 font-medium">
            All staff <ArrowRight size={13} aria-hidden />
          </Link>
        }
      >
        {top.length ? (
          <BarList
            label="Staff with the most hours"
            numbered
            rows={top.map((s) => ({
              key: s.id,
              label: s.name,
              sub: `${s.staffNo} · ${s.department.name}`,
              value: s.hours,
              text: formatHours(s.hours),
              note: plural(s.completed, "training"),
              href: `/staff/${s.id}`,
            }))}
          />
        ) : (
          <EmptyState compact icon={Users} title="No one has hours yet">
            The people with the most completed hours are listed here.
          </EmptyState>
        )}
      </Panel>

      <Panel className="lg:col-span-4" title="Top 5 in-house trainers" description="Staff who gave the most training hours as the internal trainer">
        {data.topTrainers.length ? (
          <BarList
            label="In-house trainers with the most hours"
            numbered
            color={TONE.plum.bar}
            rows={data.topTrainers.map((s) => ({
              key: s.id,
              label: s.name,
              sub: `${s.staffNo} · ${s.department.name}`,
              value: s.hours,
              text: formatHours(s.hours),
              note: `${plural(s.completed, "training")} given`,
              href: `/staff/${s.id}`,
            }))}
          />
        ) : (
          <EmptyState compact icon={Presentation} title="No in-house trainer in this period">
            Staff set as a training&apos;s internal trainer are listed here.
          </EmptyState>
        )}
      </Panel>

      <Panel
        className="lg:col-span-4"
        title="Top 5 trainings (total man hour)"
        description="A training's hours × the people who completed it"
        action={
          <Link href={report("attendance")} className="link inline-flex items-center gap-1 font-medium">
            All trainings <ArrowRight size={13} aria-hidden />
          </Link>
        }
      >
        {data.topTrainings.length ? (
          <BarList
            label="Trainings with the most man hours"
            numbered
            color={TONE.marigold.bar}
            rows={data.topTrainings.map((t) => ({
              key: t.id,
              label: t.title,
              sub: `${TRAINING_TYPE_LABELS[t.type]} · ${t.trainingCode}`,
              value: t.manHours,
              text: formatHours(t.manHours),
              note: `${t.completed} completed`,
              href: `/reports/attendance/${t.id}`,
            }))}
          />
        ) : (
          <EmptyState compact icon={GraduationCap} title="No completed training in this period">
            The trainings that gave the most hours are listed here.
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}

// ---------- Average total hour ----------

function AverageTab({ data, report }: TabProps) {
  const { total, overview, buckets } = data;
  // As on the old system: the average total divides by the manpower, but the public and OJT averages divide by
  // the staff who attended training (public and OJT together), so those two don't add up to the total.
  const manpower = overview.manpower;
  const average = perHead(overview.hours, manpower);
  const attended = overview.attended;
  const publicAverage = perHead(overview.hoursByType.PUBLIC_INHOUSE, attended);
  const ojtAverage = perHead(overview.hoursByType.OJT, attended);
  const share = (hours: number) => `${overview.hours > 0 ? Math.round((hours / overview.hours) * 100) : 0}%`;
  const publicShare = overview.hours > 0 ? (overview.hoursByType.PUBLIC_INHOUSE / overview.hours) * 100 : 0;
  const months = buckets.map((b, i) => ({
    label: b.label,
    short: b.short,
    title: b.title,
    group: String(b.year),
    future: b.future,
    values: data.byType[i].map((h) => perHead(h, manpower)),
  }));
  const typeIndex = (type: TrainingTypeCode) => TRAINING_TYPES.indexOf(type);
  const byDepartment = data.departments.map((d) => ({ ...d, value: d.average ?? 0 })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  // Each division with its departments (highest average first) and its own average: its hours ÷ its headcount.
  const divisions = [...new Map(data.departments.map((d) => [d.division.id, d.division])).values()].map((division) => {
    const departments = byDepartment.filter((d) => d.division.id === division.id);
    const headcount = departments.reduce((sum, d) => sum + d.headcount, 0);
    return {
      ...division,
      departments,
      headcount,
      average: perHead(
        departments.reduce((sum, d) => sum + d.hours, 0),
        headcount,
      ),
    };
  });

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* Training overview: the average on the dark tile, its public and OJT parts beside it. */}
      <section aria-label="Training overview" className="grid gap-5 lg:col-span-12 lg:grid-cols-12">
        <dl className="relative flex flex-col justify-between gap-8 overflow-hidden rounded-xl bg-night p-6 text-white sm:p-7 lg:col-span-5">
          <svg aria-hidden viewBox="0 0 84 88" className="absolute right-6 bottom-0 hidden h-32 text-white opacity-[0.06] sm:block" fill="currentColor">
            {[34, 52, 70, 88].map((h, i) => (
              <rect key={h} x={i * 22} y={88 - h} width="16" height={h} rx="3" />
            ))}
          </svg>
          <div className="relative">
            <dt className="text-[13px] text-night-text">Average total hours</dt>
            <dd className="num mt-2 text-[56px] leading-none font-semibold tracking-tight">{formatHours(average)}</dd>
            <dd className="mt-3 text-[13px] text-night-text">
              <span className="num font-semibold text-white">{formatHours(overview.hours)}</span> over a manpower of{" "}
              <span className="num font-semibold text-white">{manpower.toLocaleString("en-MY")}</span>
            </dd>
          </div>
          <div className="relative">
            <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-night-2" aria-hidden>
              {overview.hoursByType.PUBLIC_INHOUSE > 0 && <span className="bg-accent-bright" style={{ width: `${publicShare}%` }} />}
              {overview.hoursByType.OJT > 0 && <span className="flex-1 bg-marigold" />}
            </div>
            <div className="mt-3 flex justify-between gap-4 text-[12.5px] text-night-muted">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 shrink-0 rounded-[2px] bg-accent-bright" />
                Public <span className="num font-semibold text-white">{share(overview.hoursByType.PUBLIC_INHOUSE)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 shrink-0 rounded-[2px] bg-marigold" />
                OJT <span className="num font-semibold text-white">{share(overview.hoursByType.OJT)}</span>
              </span>
            </div>
          </div>
        </dl>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-7">
          <Tile icon={GraduationCap} tone="jade" label="Average public training hours" value={formatHours(publicAverage)}>
            <MiniColumns
              values={data.byType.map((hours) => perHead(hours[typeIndex("PUBLIC_INHOUSE")], attended))}
              buckets={buckets}
              color={TONE.jade.bar}
              what="h per person who attended"
            />
          </Tile>
          <Tile icon={Wrench} tone="marigold" label="Average OJT hours" value={formatHours(ojtAverage)}>
            <MiniColumns
              values={data.byType.map((hours) => perHead(hours[typeIndex("OJT")], attended))}
              buckets={buckets}
              color={TONE.marigold.bar}
              what="h per person who attended"
            />
          </Tile>
        </dl>
      </section>

      {/* One department has nothing to be compared with. */}
      {byDepartment.length > 1 && (
        <Panel
          className="lg:col-span-12"
          title="All Department List (Average Total Hour)"
          description="Each department's completed hours ÷ its headcount, the highest first"
          action={
            <Link href={report("department-hours")} className="link inline-flex items-center gap-1 font-medium">
              Department report <ArrowRight size={13} aria-hidden />
            </Link>
          }
        >
          <div className="overflow-x-auto pt-5">
            <div style={{ minWidth: byDepartment.length * 52 }}>
              <ColumnChart
                data={byDepartment.map((d) => ({
                  label: d.shortName ?? d.name,
                  short: d.shortName ?? d.name,
                  title: `${d.name} (headcount ${d.headcount})`,
                  value: d.value,
                }))}
                caption="Average total hours by department"
                format={(n) => formatHours(n)}
                height={280}
              />
            </div>
          </div>
        </Panel>
      )}

      <Panel
        className="lg:col-span-12"
        title="Average Monthly Total Training Hour"
        description={`Completed hours ÷ manpower, by the ${data.unit} the training started`}
      >
        {total.hours > 0 ? (
          <StackedColumnChart
            series={SERIES}
            data={months}
            caption={`Average hours per person by ${data.unit} and training type`}
            format={(n) => formatHours(n)}
            height={300}
          />
        ) : (
          <EmptyState compact icon={ChartColumnStacked} title="No completed training in this period">
            Hours appear here once attendance is recorded as completed.
          </EmptyState>
        )}
      </Panel>

      {/* The same averages division by division: one chart for each, with its departments. */}
      {divisions.length > 1 &&
        divisions.map((division, n) => (
          <Panel
            key={division.id}
            // An odd one out at the end takes the whole row.
            className={n === divisions.length - 1 && divisions.length % 2 === 1 ? "lg:col-span-12" : "lg:col-span-6"}
            title={
              <span className="inline-flex items-center gap-2">
                <DivisionMark tone={divisionTone(division.id)} />
                {division.name} (Average Total Hour)
              </span>
            }
            description={`${plural(division.departments.length, "department")} · headcount ${division.headcount.toLocaleString("en-MY")}`}
            action={<span className="num text-[15px] font-semibold text-ink">{formatHours(division.average)}</span>}
          >
            <div className="overflow-x-auto pt-5">
              <div style={{ minWidth: division.departments.length * 52 }}>
                <ColumnChart
                  data={division.departments.map((d) => ({
                    label: d.shortName ?? d.name,
                    short: d.shortName ?? d.name,
                    title: `${d.name} (headcount ${d.headcount})`,
                    value: d.value,
                  }))}
                  caption={`Average total hours by department, ${division.name}`}
                  format={(h) => formatHours(h)}
                  color={TONE[divisionTone(division.id)].bar}
                  height={200}
                />
              </div>
            </div>
          </Panel>
        ))}
    </div>
  );
}

/**
 * One count of the overview: its icon and the number side by side, its name
 * under them, then a small drawing of how the count is made up (children).
 */
function Tile({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card grid min-w-0 grid-cols-[auto_1fr] content-start items-center gap-x-4 p-4 sm:p-5">
      <span aria-hidden className={`row-start-1 flex size-12 items-center justify-center rounded-xl ${TONE[tone].tile}`}>
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <dt className="col-span-2 row-start-2 mt-3 text-[13px] leading-snug font-medium text-ink-2">{label}</dt>
      <dd className="num col-start-2 row-start-1 text-[40px] leading-none font-semibold tracking-tight text-ink">{value}</dd>
      {sub && <dd className="col-span-2 row-start-3 mt-1 text-xs text-ink-3">{sub}</dd>}
      {children && <dd className="col-span-2 row-start-3 mt-4">{children}</dd>}
    </div>
  );
}

/**
 * A count month by month, as a row of small columns with the highest named:
 * enough to see whether it is spread over the period or bunched in a month.
 * The numbers themselves are in the chart below and in the export.
 */
function MiniColumns({ values, buckets, color, what }: { values: number[]; buckets: Bucket[]; color: string; what: string }) {
  const max = Math.max(0, ...values);
  const peak = values.indexOf(max);
  return (
    <>
      <div className="flex h-9 items-end gap-[3px]" aria-hidden>
        {values.map((v, i) => (
          <span key={buckets[i].key} title={`${buckets[i].title}: ${v.toLocaleString("en-MY")} ${what}`} className="flex h-full flex-1 items-end">
            <span
              className={`w-full rounded-t-[2px] ${buckets[i].future ? "" : v > 0 ? `${color} ${i === peak ? "" : "opacity-45"}` : "bg-rule-strong"}`}
              style={{ height: buckets[i].future ? 0 : v > 0 ? `max(${(v / max) * 100}%, 3px)` : 2 }}
            />
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-xs text-ink-3">
        <span>
          {buckets[0].label} – {buckets[buckets.length - 1].label}
        </span>
        {max > 0 && (
          <span>
            most in <span className="font-semibold text-ink">{buckets[peak].title.split(" ")[0]}</span>:{" "}
            <span className="num font-semibold text-ink">{max.toLocaleString("en-MY")}</span>
          </span>
        )}
      </div>
    </>
  );
}
