import Link from "next/link";
import { ExportButton } from "@/components/ExportButton";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { Select } from "@/components/ui/Select";
import { withBasePath } from "@/lib/base-path";
import { formatDateRange } from "@/lib/format";
import { TRAINING_TYPE_LABELS, TRAINING_TYPES } from "@/lib/validation/training";
import type { ReportFilters } from "@/server/services/report";
import { REPORTS, reportQuery, type ReportKey } from "./filters";

type Period = { from: string; to: string; isDefault: boolean };
type Department = { id: number; name: string; division: { id: number; name: string } };

const day = (d: string) => new Date(`${d}T00:00:00Z`);

/** "01 Jan – 31 Dec 2026", with a note when it's the default year. */
export function PeriodLabel({ period }: { period: Period }) {
  return (
    <span className="num" title="Trainings that started in this period">
      {formatDateRange(day(period.from), day(period.to))}
      {period.isDefault && <span className="text-ink-3"> (this year)</span>}
    </span>
  );
}

/** The four reports as tabs. Moving between them keeps the period. */
export function ReportTabs({ current, f }: { current: ReportKey; f: ReportFilters }) {
  const period = reportQuery(f, {}, ["from", "to"]);
  return (
    // On phones the four don't fit, so they slide sideways (no scrollbar drawn); never up and down.
    <nav
      aria-label="Reports"
      className="mb-4 flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-rule [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {REPORTS.map((r) => {
        const active = r.key === current;
        return (
          <Link
            key={r.key}
            href={`/reports/${r.key}${period}`}
            aria-current={active ? "page" : undefined}
            title={r.blurb}
            className={`shrink-0 border-b-2 px-3 py-2 text-[13.5px] whitespace-nowrap ${
              active ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover:border-rule-strong hover:text-ink"
            }`}
          >
            {r.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The Excel export of the report as filtered. `rows`: how many it would hold, when that can be more than one export takes. */
export function ExportLink({ report, f, training, rows }: { report: ReportKey; f: ReportFilters; training?: number; rows?: number }) {
  const query = reportQuery(f, { page: undefined });
  const more = `report=${report}${training ? `&training=${training}` : ""}`;
  return <ExportButton href={`/reports/export${query ? `${query}&${more}` : `?${more}`}`} rows={rows} />;
}

/**
 * A report's filters: which ones it has, then the period, Apply and Clear.
 * The period is "trainings that started from … to …"; left empty, it is this year.
 */
export function ReportFilterBar({
  report,
  f,
  period,
  departments,
  search,
  division = false,
  department = false,
  type = false,
  show = false,
  clearHref,
  children,
}: {
  /** Which report the bar is on. Left out on the Dashboard, which gives clearHref. */
  report?: ReportKey;
  f: ReportFilters;
  period: Period;
  departments: Department[];
  /** Placeholder of the search box; no box when left out. */
  search?: string;
  division?: boolean;
  department?: boolean;
  type?: boolean;
  /** Staff hours: everyone, only those with training, or only those without. */
  show?: boolean;
  /** Where Clear goes, when the bar isn't on a report. */
  clearHref?: string;
  /** Hidden fields to keep through Apply. */
  children?: React.ReactNode;
}) {
  const divisions = [...new Map(departments.map((d) => [d.division.id, d.division])).values()];
  return (
    <form method="get" className="card flex flex-wrap items-end gap-2 p-3" role="search" aria-label="Filter the report">
      {children}
      {search && (
        <div className="w-full sm:w-60">
          <label htmlFor="q" className="label">
            Search
          </label>
          <input id="q" name="q" defaultValue={f.q} className="input" placeholder={search} type="search" />
        </div>
      )}
      {type && (
        <div className="w-[calc(50%-4px)] sm:w-44">
          <label htmlFor="type" className="label">
            Type
          </label>
          <Select
            id="type"
            name="type"
            defaultValue={f.type ?? ""}
            options={[{ value: "", label: "All types" }, ...TRAINING_TYPES.map((t) => ({ value: t, label: TRAINING_TYPE_LABELS[t] }))]}
          />
        </div>
      )}
      {/* Someone with one division or department has nothing to choose between. */}
      {division && divisions.length > 1 && (
        <div className="w-[calc(50%-4px)] sm:w-52">
          <label htmlFor="division" className="label">
            Division
          </label>
          <Select
            id="division"
            name="division"
            defaultValue={f.divisionId ? String(f.divisionId) : ""}
            options={[{ value: "", label: "All divisions" }, ...divisions.map((d) => ({ value: String(d.id), label: d.name }))]}
          />
        </div>
      )}
      {department && departments.length > 1 && (
        <div className="w-[calc(50%-4px)] sm:w-56">
          <label htmlFor="department" className="label">
            Department
          </label>
          <Select
            id="department"
            name="department"
            defaultValue={f.departmentId ? String(f.departmentId) : ""}
            searchable
            options={[{ value: "", label: "All departments" }, ...departments.map((d) => ({ value: String(d.id), label: d.name, group: d.division.name }))]}
          />
        </div>
      )}
      {show && (
        <div className="w-[calc(50%-4px)] sm:w-44">
          <label htmlFor="show" className="label">
            Show
          </label>
          <Select
            id="show"
            name="show"
            defaultValue={f.show ?? ""}
            options={[
              { value: "", label: "All staff" },
              { value: "trained", label: "With training" },
              { value: "untrained", label: "No training yet" },
            ]}
          />
        </div>
      )}
      {/* Shown filled in, so it's plain which period the figures are for. */}
      <DateRangeFilter from={period.from} to={period.to} />
      <button type="submit" className="btn">
        Apply
      </button>
      {/* A full page load, so every field resets: back to this year, every department. */}
      <a href={withBasePath(clearHref ?? `/reports/${report}`)} className="btn">
        Clear
      </a>
    </form>
  );
}
