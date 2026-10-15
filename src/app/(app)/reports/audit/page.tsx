import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ClickableRow } from "@/components/ui/ClickableRow";
import { Status } from "@/components/ui/Status";
import { formatDateRange, formatHours, nowInMalaysia, plural } from "@/lib/format";
import { ATTENDANCE_LABELS } from "@/lib/validation/participant";
import { TRAINING_TYPE_SHORT_LABELS } from "@/lib/validation/training";
import { AUDIT_PAGE_SIZE, auditReport, reportDepartments } from "@/server/services/report";
import { requirePermission } from "@/server/session";
import { ATTENDANCE_TONE, parseReportFilters, reportQuery } from "../filters";
import { ExportLink, PeriodLabel, ReportFilterBar, ReportTabs } from "../ReportParts";

export const metadata: Metadata = { title: "Audit report" };

/** One line per person per training that started in the period: attendance, hours and certificate. */
export default async function AuditReportPage({ searchParams }: PageProps<"/reports/audit">) {
  const user = await requirePermission("report.view");
  const f = parseReportFilters(await searchParams);
  const [{ period, rows, total, trainings, page, pages }, departments] = await Promise.all([auditReport(user, f, nowInMalaysia()), reportDepartments(user)]);
  const detail = (trainingId: number) => `/reports/attendance/${trainingId}`;

  return (
    <div className="page-fit">
      <PageHeader
        module="reports"
        context="Records"
        title="Reports"
        meta={
          <>
            <span>{plural(total, "attendance record")}</span>
            <span>{plural(trainings, "training")}</span>
            <PeriodLabel period={period} />
          </>
        }
        actions={<ExportLink report="audit" f={f} rows={total} />}
      />
      <ReportTabs current="audit" f={f} />
      <ReportFilterBar report="audit" f={f} period={period} departments={departments} search="Training, code, name or staff no." type department />

      <div className="table-scroll card mt-4">
        <table className="table min-w-[960px]" aria-label="Audit report">
          <thead>
            <tr>
              <th className="w-px text-right whitespace-nowrap">No.</th>
              <th className="w-px whitespace-nowrap">Dates</th>
              <th className="hidden w-px whitespace-nowrap lg:table-cell">Training code</th>
              <th>Training</th>
              <th className="hidden md:table-cell">Type</th>
              <th className="w-px whitespace-nowrap">Staff no.</th>
              <th>Name</th>
              <th className="hidden md:table-cell">Department</th>
              <th>Attendance</th>
              <th className="w-px text-right whitespace-nowrap" title="The training's hours when completed; none if cancelled">
                Hours
              </th>
              <th className="w-px whitespace-nowrap" title="The training has a certificate and this person completed it">
                Certificate
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <ClickableRow key={r.id} href={detail(r.training.id)}>
                <td className="num muted text-right">{(page - 1) * AUDIT_PAGE_SIZE + i + 1}</td>
                <td className="num whitespace-nowrap">{formatDateRange(r.training.startDate, r.training.endDate)}</td>
                <td className="num hidden whitespace-nowrap lg:table-cell">{r.training.trainingCode}</td>
                <td>
                  <Link
                    href={detail(r.training.id)}
                    className={`font-medium text-ink hover:text-accent hover:underline ${r.training.status === "CANCELLED" ? "line-through decoration-ink-3" : ""}`}
                  >
                    {r.training.title}
                  </Link>
                  {r.training.status === "CANCELLED" && <div className="mt-0.5 text-xs text-bad">Cancelled</div>}
                </td>
                <td className="hidden md:table-cell">
                  <span className="tag">{TRAINING_TYPE_SHORT_LABELS[r.training.type]}</span>
                </td>
                <td className="num whitespace-nowrap">{r.staff.staffNo}</td>
                <td>{r.staff.name}</td>
                <td className="hidden md:table-cell">{r.staff.department.name}</td>
                <td>
                  <Status tone={ATTENDANCE_TONE[r.attendance]}>{ATTENDANCE_LABELS[r.attendance]}</Status>
                </td>
                <td className={`num text-right ${r.hours ? "font-medium" : "muted"}`}>{formatHours(r.hours)}</td>
                <td>{r.certificate ? "Yes" : <span className="muted">No</span>}</td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-ink-2">No attendance records match these filters.</div>}
      </div>

      {total > AUDIT_PAGE_SIZE && (
        <nav aria-label="Pages" className="mt-3 flex shrink-0 items-center justify-between text-[13px] text-ink-2">
          <span className="num">
            {(page - 1) * AUDIT_PAGE_SIZE + 1}–{Math.min(page * AUDIT_PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link className="btn btn-sm" href={`/reports/audit${reportQuery(f, { page: page - 1 })}`}>
                Previous
              </Link>
            ) : (
              <span className="btn btn-sm" aria-disabled="true">
                Previous
              </span>
            )}
            {page < pages ? (
              <Link className="btn btn-sm" href={`/reports/audit${reportQuery(f, { page: page + 1 })}`}>
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
