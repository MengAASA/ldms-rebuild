import ExcelJS from "exceljs";
import { answerCells, CURRENT_FORM, questionsOf } from "@/lib/forms/feedback";
import { formatDateRange, formatTime, nowInMalaysia } from "@/lib/format";
import { ATTENDANCE_LABELS } from "@/lib/validation/participant";
import { DESIGNATION_LABELS, GENDER_LABELS } from "@/lib/validation/staff";
import { TRAINING_PROGRAM_LABELS, TRAINING_TYPE_LABELS } from "@/lib/validation/training";
import { DATE, HOURS, refusedExport, sheet, streamingWorkbook } from "@/server/excel";
import { can } from "@/server/permissions";
import { PME_STAGE_LABELS } from "@/server/rules/pme";
import { TRAINING_PHASE_LABELS } from "@/server/rules/training";
import { auditReportForExport, departmentHoursReport, staffHoursReport, trainingAttendanceDetail, trainingAttendanceReport } from "@/server/services/report";
import { getCurrentUser } from "@/server/session";
import { parseReportFilters } from "../filters";

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const periodLine = (p: { from: string; to: string }) => `Trainings that started ${formatDateRange(day(p.from), day(p.to))}`;

/**
 * The Excel file of a report, as filtered on screen: ?report=staff-hours |
 * department-hours | attendance | audit, plus the page's filters. With
 * ?training=ID, the attendance report gives that training's participants.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  if (user.mustChangePassword) return new Response("Change your password first", { status: 403 });
  if (!can(user, "report.view")) return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const report = url.searchParams.get("report");
  const f = parseReportFilters(Object.fromEntries(url.searchParams));
  const today = nowInMalaysia();
  // The audit report can run to 100,000 lines with the OJTs: its workbook is written out as it is built.
  const streamed = report === "audit" ? streamingWorkbook() : null;
  const wb = streamed?.wb ?? new ExcelJS.Workbook();
  wb.creator = "LDMS";
  let name: string;

  if (report === "staff-hours") {
    const { period, rows, total } = await staffHoursReport(user, f, today);
    name = "staff hours";
    sheet(
      wb,
      "Staff hours",
      "Staff hours",
      periodLine(period),
      [
        { header: "No", key: "no", width: 6 },
        { header: "Staff No", key: "staffNo", width: 11 },
        { header: "Name", key: "name", width: 34 },
        { header: "Designation", key: "designation", width: 15 },
        { header: "Status", key: "status", width: 10 },
        { header: "Division", key: "division", width: 24 },
        { header: "Department", key: "department", width: 28 },
        { header: "Section", key: "section", width: 20 },
        { header: "Trainings Completed", key: "completed", width: 19 },
        { header: "Total Hours", key: "hours", width: 12, numFmt: HOURS },
      ],
      rows.map((r) => ({
        staffNo: r.staffNo,
        name: r.name,
        designation: DESIGNATION_LABELS[r.designation],
        status: r.status === "ACTIVE" ? "Active" : "Resigned",
        division: r.department.division.name,
        department: r.department.name,
        section: r.section?.name ?? "",
        completed: r.completed,
        hours: r.hours,
      })),
      { name: "Total", completed: total.completed, hours: total.hours },
    );
  } else if (report === "department-hours") {
    const { period, rows, total } = await departmentHoursReport(user, f, today);
    name = "department hours";
    sheet(
      wb,
      "Department hours",
      "Department hours",
      `${periodLine(period)}. Headcount: active staff, not counting trainees. Average: total hours ÷ headcount.`,
      [
        { header: "No", key: "no", width: 6 },
        { header: "Division", key: "division", width: 24 },
        { header: "Department", key: "department", width: 30 },
        { header: "Head of Department", key: "hod", width: 30 },
        { header: "Headcount", key: "headcount", width: 11 },
        { header: "Staff Trained", key: "trained", width: 13 },
        { header: "Trainings Completed", key: "completed", width: 19 },
        { header: "Total Hours", key: "hours", width: 12, numFmt: HOURS },
        { header: "Average Per Head", key: "average", width: 16, numFmt: HOURS },
      ],
      rows.map((r) => ({
        division: r.division.name,
        department: r.name,
        hod: r.hod?.name ?? "",
        headcount: r.headcount,
        trained: r.trained,
        completed: r.completed,
        hours: r.hours,
        average: r.average,
      })),
      { department: "Total", headcount: total.headcount, trained: total.trained, completed: total.completed, hours: total.hours, average: total.average },
    );
  } else if (report === "attendance" && url.searchParams.has("training")) {
    const id = Number(url.searchParams.get("training"));
    const data = Number.isInteger(id) ? await trainingAttendanceDetail(user, id, today) : null;
    if (!data) return new Response("Not found", { status: 404 });
    const { training: t, rows, total } = data;
    name = `attendance ${t.trainingCode}`;
    sheet(
      wb,
      "Participants",
      `${t.title} (${t.trainingCode})`,
      `${formatDateRange(t.startDate, t.endDate)} · ${TRAINING_PHASE_LABELS[t.phase]} · Certificate: ${t.hasCertificate ? "Yes" : "No"}`,
      [
        { header: "No", key: "no", width: 6 },
        { header: "Staff No", key: "staffNo", width: 11 },
        { header: "Name", key: "name", width: 34 },
        { header: "Designation", key: "designation", width: 15 },
        { header: "Department", key: "department", width: 28 },
        { header: "Section", key: "section", width: 20 },
        { header: "Attendance", key: "attendance", width: 12 },
        { header: "Reason", key: "reason", width: 34 },
        { header: "Feedback Given", key: "feedback", width: 15, numFmt: DATE },
        { header: "Hours", key: "hours", width: 8, numFmt: HOURS },
        { header: "PME", key: "pme", width: 22 },
      ],
      rows.map((r) => ({
        pme: r.pme ? PME_STAGE_LABELS[r.pme.stage] : "",
        staffNo: r.staff.staffNo,
        name: r.staff.name,
        designation: DESIGNATION_LABELS[r.staff.designation],
        department: r.staff.department.name,
        section: r.staff.section?.name ?? "",
        attendance: ATTENDANCE_LABELS[r.attendance],
        reason: r.attendanceReason ?? "",
        feedback: r.submittedAt,
        hours: r.hours,
      })),
      { name: "Total", attendance: `${total.completed} of ${total.total} completed`, hours: total.hours },
    );
  } else if (report === "attendance") {
    const { period, rows, total } = await trainingAttendanceReport(user, f, today);
    name = "training attendance";
    sheet(
      wb,
      "Training attendance",
      "Training attendance",
      periodLine(period),
      [
        { header: "No", key: "no", width: 6 },
        { header: "Training Code", key: "code", width: 19 },
        { header: "Title", key: "title", width: 44 },
        { header: "Type", key: "type", width: 18 },
        { header: "Start Date", key: "startDate", width: 12, numFmt: DATE },
        { header: "End Date", key: "endDate", width: 12, numFmt: DATE },
        { header: "Hours", key: "hours", width: 8, numFmt: HOURS },
        { header: "Participants", key: "total", width: 13 },
        { header: "Completed", key: "completed", width: 11 },
        { header: "Pending", key: "pending", width: 9 },
        { header: "Absent", key: "absent", width: 9 },
        { header: "Total Man Hours", key: "manHours", width: 16, numFmt: HOURS },
        { header: "Certificate", key: "certificate", width: 12 },
        { header: "Status", key: "status", width: 12 },
      ],
      rows.map((t) => ({
        code: t.trainingCode,
        title: t.title,
        type: TRAINING_TYPE_LABELS[t.type],
        startDate: t.startDate,
        endDate: t.endDate,
        hours: t.hours,
        total: t.total,
        completed: t.completed,
        pending: t.pending,
        absent: t.absent,
        manHours: t.manHours,
        certificate: t.hasCertificate ? "Yes" : "No",
        status: TRAINING_PHASE_LABELS[t.phase],
      })),
      { title: "Total", total: total.total, completed: total.completed, pending: total.pending, absent: total.absent, manHours: total.manHours },
    );
  } else if (report === "audit") {
    const data = await auditReportForExport(user, f, today).catch(refusedExport);
    if (data instanceof Response) return data;
    const { period, rows } = data;
    const feedbackQuestions = questionsOf(CURRENT_FORM.FEEDBACK);
    name = "audit report";
    sheet(
      wb,
      "Audit report",
      "Training audit report",
      `${periodLine(period)}. One line per person per training. Hours: the training's hours when completed (none if cancelled). The last 16 columns are the course feedback answers (OJT has its own three, in the OJT export).`,
      [
        { header: "No", key: "no", width: 6 },
        { header: "Training Code", key: "code", width: 19 },
        { header: "Title", key: "title", width: 44 },
        { header: "Type", key: "type", width: 18 },
        { header: "Start Date", key: "startDate", width: 12, numFmt: DATE },
        { header: "End Date", key: "endDate", width: 12, numFmt: DATE },
        { header: "Start Time", key: "startTime", width: 11 },
        { header: "End Time", key: "endTime", width: 11 },
        { header: "Venue", key: "venue", width: 24 },
        { header: "Program", key: "program", width: 34 },
        { header: "Trainer", key: "trainer", width: 28 },
        { header: "Training Status", key: "status", width: 15 },
        { header: "Staff No", key: "staffNo", width: 11 },
        { header: "Name", key: "name", width: 34 },
        { header: "Gender", key: "gender", width: 9 },
        { header: "Designation", key: "designation", width: 15 },
        { header: "Department", key: "department", width: 28 },
        { header: "Attendance", key: "attendance", width: 12 },
        { header: "Reason", key: "reason", width: 34 },
        { header: "Feedback Given", key: "feedback", width: 15, numFmt: DATE },
        { header: "Hours", key: "hours", width: 8, numFmt: HOURS },
        { header: "Certificate", key: "certificate", width: 12 },
        // The course feedback questions as the form asks them, one column each, as the old audit report had.
        ...feedbackQuestions.map((q) => ({ header: q.text, key: q.id, width: 40 })),
      ],
      rows.map((r) => ({
        code: r.training.trainingCode,
        title: r.training.title,
        type: TRAINING_TYPE_LABELS[r.training.type],
        startDate: r.training.startDate,
        endDate: r.training.endDate,
        startTime: r.training.sessions.length ? "" : formatTime(r.training.startTime),
        endTime: r.training.sessions.length ? "" : formatTime(r.training.endTime),
        venue: r.training.venue ?? "",
        program: r.training.program ? TRAINING_PROGRAM_LABELS[r.training.program] : "",
        trainer: r.training.trainerName ?? "",
        status: TRAINING_PHASE_LABELS[r.training.phase],
        staffNo: r.staff.staffNo,
        name: r.staff.name,
        gender: r.staff.gender ? GENDER_LABELS[r.staff.gender] : "",
        designation: DESIGNATION_LABELS[r.staff.designation],
        department: r.staff.department.name,
        attendance: ATTENDANCE_LABELS[r.attendance],
        reason: r.attendanceReason ?? "",
        feedback: r.submittedAt,
        hours: r.hours,
        certificate: r.certificate ? "Yes" : "No",
        // An OJT's answers are to a different form: they are in the OJT export.
        ...(r.training.type === "OJT"
          ? {}
          : Object.fromEntries(answerCells("FEEDBACK", r.feedbackVersion, r.feedback).map((cell, n) => [feedbackQuestions[n].id, cell]))),
      })),
    );
  } else {
    return new Response("Not found", { status: 404 });
  }

  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const buffer = streamed ? await streamed.file() : await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="LDMS ${name} ${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
