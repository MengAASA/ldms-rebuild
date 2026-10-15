import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { Select } from "@/components/ui/Select";
import { ClickableRow } from "@/components/ui/ClickableRow";
import { Status } from "@/components/ui/Status";
import { ExportButton } from "@/components/ExportButton";
import { withBasePath } from "@/lib/base-path";
import { formatDate, formatHours, plural } from "@/lib/format";
import { isAdmin } from "@/server/permissions";
import { listOjt, OJT_PAGE_SIZE, ojtDepartments } from "@/server/services/ojt";
import { requirePermission } from "@/server/session";
import { ojtFiltersToQuery, ojtStatus, parseOjtFilters, SOURCE_LABELS } from "./filters";

export const metadata: Metadata = { title: "OJT" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: Search[string]) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function OjtPage({ searchParams }: PageProps<"/ojt">) {
  const user = await requirePermission("ojt.manage");
  const sp = await searchParams;
  const f = parseOjtFilters(sp);
  const [{ rows, total, page, pages }, departments] = await Promise.all([listOjt(user, f), ojtDepartments(user)]);
  const filtered = !!(f.q || f.departmentId || f.from || f.to);
  const recorded = Number(one(sp.recorded));

  return (
    <div className="page-fit">
      <PageHeader
        module="ojt"
        context="Training"
        title="OJT"
        meta={
          <span>
            {plural(total, "OJT record")}
            {filtered && " matching"}
            {!isAdmin(user) && " · contract staff"}
          </span>
        }
        actions={
          <>
            <ExportButton href={`/ojt/export${ojtFiltersToQuery(f)}`} rows={total} />
            <Link href="/ojt/import" className="btn">
              <FileUp size={15} aria-hidden /> Import from Excel
            </Link>
            <Link href="/ojt/new" className="btn btn-primary">
              <Plus size={15} aria-hidden /> Record OJT
            </Link>
          </>
        }
      />

      {recorded > 0 && (
        <div role="status" className="notice notice-ok mb-3">
          OJT recorded for {plural(recorded, "staff member")}.{" "}
          {one(sp.completed) === "1" ? "It counts as completed for everyone." : "Each person gives their answers on My training, which completes it for them."}
        </div>
      )}
      {(one(sp.updated) === "1" || one(sp.deleted) === "1") && (
        <div role="status" className="notice notice-ok mb-3">
          {one(sp.deleted) === "1" ? "OJT deleted." : "OJT updated."}
        </div>
      )}

      <form method="get" className="card flex flex-wrap items-end gap-2 p-3" role="search" aria-label="Filter OJT records">
        <div className="w-full sm:w-64">
          <label htmlFor="q" className="label">
            Search
          </label>
          <input id="q" name="q" defaultValue={f.q} className="input" placeholder="Title, code, staff no. or name" type="search" />
        </div>
        <div className="w-full sm:w-56">
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
        <DateRangeFilter from={f.from} to={f.to} />
        <button type="submit" className="btn">
          Apply
        </button>
        {/* A full page load, so every field resets, including ones typed in but not applied yet. */}
        <a href={withBasePath("/ojt")} className="btn">
          Clear
        </a>
      </form>

      <div className="table-scroll card mt-4">
        <table className="table min-w-[960px]" aria-label="OJT records">
          <thead>
            <tr>
              <th className="w-px text-right whitespace-nowrap">No.</th>
              <th className="w-px whitespace-nowrap">Training code</th>
              <th className="w-px whitespace-nowrap">Staff no.</th>
              <th>Name</th>
              <th>Department</th>
              <th className="min-w-[200px]">OJT</th>
              <th className="w-px whitespace-nowrap">Start date</th>
              <th className="w-px whitespace-nowrap">End date</th>
              <th className="w-px text-right whitespace-nowrap">Hours</th>
              <th className="w-px whitespace-nowrap">Status</th>
              <th className="w-px whitespace-nowrap">Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const s = ojtStatus(r);
              return (
                // The whole row opens the record; the title is the link keyboard users follow.
                <ClickableRow key={r.id} href={`/ojt/${r.id}`}>
                  <td className="num muted text-right">{(page - 1) * OJT_PAGE_SIZE + i + 1}</td>
                  <td className="num whitespace-nowrap">{r.training.trainingCode}</td>
                  <td className="num whitespace-nowrap">{r.staff.staffNo}</td>
                  <td>{r.staff.name}</td>
                  <td>{r.staff.department.name}</td>
                  <td>
                    <Link href={`/ojt/${r.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                      {r.training.title}
                    </Link>
                  </td>
                  <td className="num whitespace-nowrap">{formatDate(r.training.startDate)}</td>
                  <td className="num whitespace-nowrap">{formatDate(r.training.endDate)}</td>
                  <td className={`num text-right whitespace-nowrap ${r.counts ? "" : "muted"}`}>{formatHours(r.hours)}</td>
                  <td className="whitespace-nowrap">
                    <Status tone={s.tone}>{s.label}</Status>
                  </td>
                  <td className="whitespace-nowrap text-ink-2">{SOURCE_LABELS[r.source]}</td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-ink-2">
            {filtered ? (
              <>
                No OJT records match these filters.{" "}
                <a href={withBasePath("/ojt")} className="link">
                  Clear filters
                </a>
              </>
            ) : (
              "No OJT recorded yet. Use Record OJT, or import the Excel template."
            )}
          </div>
        )}
      </div>

      {total > OJT_PAGE_SIZE && (
        <nav aria-label="Pages" className="mt-3 flex shrink-0 items-center justify-between text-[13px] text-ink-2">
          <span className="num">
            {(page - 1) * OJT_PAGE_SIZE + 1}–{Math.min(page * OJT_PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link className="btn btn-sm" href={`/ojt${ojtFiltersToQuery(f, page - 1)}`}>
                Previous
              </Link>
            ) : (
              <span className="btn btn-sm" aria-disabled="true">
                Previous
              </span>
            )}
            {page < pages ? (
              <Link className="btn btn-sm" href={`/ojt${ojtFiltersToQuery(f, page + 1)}`}>
                Next
              </Link>
            ) : (
              <span className="btn btn-sm" aria-disabled="true">
                Next
              </span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
