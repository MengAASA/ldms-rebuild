import ExcelJS from "exceljs";
import { PME_V1, pmeBand } from "@/lib/forms/pme";
import { nowInMalaysia } from "@/lib/format";
import { can } from "@/server/permissions";
import { PME_STAGE_LABELS } from "@/server/rules/pme";
import { pmesForExport } from "@/server/services/pme";
import { getCurrentUser } from "@/server/session";
import { parsePmeFilters } from "../filters";

/** The PME list as filtered, one row per PME, with each question's rating, percentage and remarks. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  if (user.mustChangePassword) return new Response("Change your password first", { status: 403 });
  if (!can(user, "pme.view")) return new Response("Forbidden", { status: 403 });

  const today = nowInMalaysia();
  const f = parsePmeFilters(Object.fromEntries(new URL(request.url).searchParams));
  const rows = await pmesForExport(user, f, today);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LDMS";
  const ws = wb.addWorksheet("PME", { views: [{ state: "frozen", ySplit: 1 }] });
  const date = { numFmt: "dd/mm/yyyy" };
  ws.columns = [
    { header: "Staff No", key: "staffNo", width: 11 },
    { header: "Name", key: "name", width: 32 },
    { header: "Department", key: "department", width: 28 },
    { header: "Training Code", key: "code", width: 19 },
    { header: "Training", key: "training", width: 40 },
    { header: "Training Start", key: "start", width: 14, style: date },
    { header: "Training End", key: "end", width: 14, style: date },
    { header: "Hours", key: "hours", width: 8, style: { numFmt: "0.##" } },
    { header: "Period Start", key: "periodStart", width: 13, style: date },
    { header: "Period End", key: "periodEnd", width: 13, style: date },
    { header: "Status", key: "status", width: 22 },
    { header: "HOD", key: "hod", width: 28 },
    ...PME_V1.questions.flatMap((q, i) => [
      { header: `Q${i + 1} Rating`, key: `${q.id}_rating`, width: 13 },
      { header: `Q${i + 1} %`, key: `${q.id}_percent`, width: 7 },
      { header: `Q${i + 1} Remarks`, key: `${q.id}_remarks`, width: 30 },
    ]),
    { header: "OJT Conducted", key: "ojt", width: 14 },
    { header: "Total", key: "total", width: 8 },
    { header: "Average Mark", key: "average", width: 13, style: { numFmt: "0.##" } },
    { header: "Evaluated", key: "evaluated", width: 13, style: date },
    { header: "Evaluated By", key: "evaluatedBy", width: 28 },
    { header: "Acknowledged", key: "acknowledged", width: 13, style: date },
    { header: "Staff Comment", key: "comment", width: 30 },
    { header: "Verified", key: "verified", width: 13, style: date },
    { header: "Verified By", key: "verifiedBy", width: 28 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  for (const r of rows) {
    // An evaluation L&D sent back is being redone, so its answers aren't reported until it is.
    const a = r.status === "PENDING" ? null : r.answers;
    ws.addRow({
      staffNo: r.staff.staffNo,
      name: r.staff.name,
      department: r.staff.department,
      code: r.training.trainingCode,
      training: r.training.title,
      start: r.training.startDate,
      end: r.training.endDate,
      hours: r.training.hours,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      status: PME_STAGE_LABELS[r.stage],
      hod: r.evaluator?.name ?? "",
      ...Object.fromEntries(
        PME_V1.questions.flatMap((q) => [
          [`${q.id}_rating`, a ? pmeBand(a[q.id].rating).label : ""],
          [`${q.id}_percent`, a ? a[q.id].percent : null],
          [`${q.id}_remarks`, a?.[q.id].remarks ?? ""],
        ]),
      ),
      ojt: a && a.ojtConducted !== null ? (a.ojtConducted ? "Yes" : "No") : "",
      total: a && r.mark ? r.mark.total : null,
      average: a && r.mark ? r.mark.average : null,
      evaluated: a ? r.evaluatedAt : null,
      evaluatedBy: a ? (r.evaluatedBy?.name ?? "") : "",
      acknowledged: r.acknowledgedAt,
      comment: r.staffComment ?? "",
      verified: r.verifiedAt,
      verifiedBy: r.verifiedBy?.name ?? "",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="LDMS PME ${today.toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
