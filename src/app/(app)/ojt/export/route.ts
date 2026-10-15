import type ExcelJS from "exceljs";
import { answerCells, CURRENT_FORM, questionsOf } from "@/lib/forms/feedback";
import { formatTime } from "@/lib/format";
import { GENDER_LABELS } from "@/lib/validation/staff";
import { OJT_METHOD_LABELS, OJT_TRAINER_LABELS, ojtTrainerOf } from "@/lib/validation/training";
import { refusedExport, streamingWorkbook } from "@/server/excel";
import { can } from "@/server/permissions";
import { listOjtForExport } from "@/server/services/ojt";
import { getCurrentUser } from "@/server/session";
import { ojtStatus, parseOjtFilters, SOURCE_LABELS } from "../filters";

/**
 * The OJT list as Excel: every row the page's filters match, with the OJT's
 * full details and, as on the old system's OJT audit report, the person's
 * gender and their three answers.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  if (user.mustChangePassword) return new Response("Change your password first", { status: 403 });
  if (!can(user, "ojt.manage")) return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const rows = await listOjtForExport(user, parseOjtFilters(Object.fromEntries(url.searchParams))).catch(refusedExport);
  if (rows instanceof Response) return rows;

  const questions = questionsOf(CURRENT_FORM.OJT);
  // A year holds about 100,000 rows: the workbook is written out as it is built.
  const { wb, file } = streamingWorkbook();
  const ws = wb.addWorksheet("OJT", { views: [{ state: "frozen", ySplit: 1 }] });
  const columns: Partial<ExcelJS.Column>[] = [
    { header: "No", key: "no", width: 6 },
    { header: "Training Code", key: "code", width: 19 },
    { header: "Staff No", key: "staffNo", width: 11 },
    { header: "Name", key: "name", width: 32 },
    { header: "Gender", key: "gender", width: 9 },
    { header: "Department", key: "department", width: 28 },
    { header: "Section", key: "section", width: 18 },
    { header: "OJT Title", key: "title", width: 40 },
    { header: "Training Type", key: "method", width: 18 },
    { header: "Venue", key: "venue", width: 22 },
    { header: "Start Date", key: "startDate", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "End Date", key: "endDate", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Start Time", key: "startTime", width: 11 },
    { header: "End Time", key: "endTime", width: 11 },
    { header: "Trainer Type", key: "trainerType", width: 13 },
    { header: "Trainer Name", key: "trainerName", width: 26 },
    { header: "Hours", key: "hours", width: 8, style: { numFmt: "0.##" } },
    { header: "Status", key: "status", width: 13 },
    { header: "Answers Given", key: "answered", width: 14, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Recorded By", key: "source", width: 14 },
    // The questions as the form asks them, one column each.
    ...questions.map((q) => ({ header: q.text, key: q.id, width: 40 })),
  ];
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  rows.forEach((r, i) => {
    const t = r.training;
    const trainer = ojtTrainerOf(t.program);
    ws.addRow({
      no: i + 1,
      code: t.trainingCode,
      staffNo: r.staff.staffNo,
      name: r.staff.name,
      gender: r.gender ? GENDER_LABELS[r.gender] : "",
      department: r.staff.department.name,
      section: r.staff.section?.name ?? "",
      title: t.title,
      // Imported OJT has no training type (the template has no column for it).
      method: t.ojtMethod ? OJT_METHOD_LABELS[t.ojtMethod] : "",
      venue: t.venue ?? "",
      startDate: t.startDate,
      endDate: t.endDate,
      startTime: t.sessions.length ? "" : formatTime(t.startTime),
      endTime: t.sessions.length ? "" : formatTime(t.endTime),
      trainerType: trainer ? OJT_TRAINER_LABELS[trainer] : "",
      trainerName: t.trainerName ?? "",
      hours: r.hours,
      status: ojtStatus(r).label,
      answered: r.submittedAt,
      source: SOURCE_LABELS[r.source],
      ...Object.fromEntries(answerCells("OJT", r.feedbackVersion, r.feedback).map((cell, n) => [questions[n].id, cell])),
    }).commit();
  });
  ws.commit();

  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const buffer = await file();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="LDMS OJT ${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
