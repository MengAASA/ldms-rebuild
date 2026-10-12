import ExcelJS from "exceljs";
import { formatDateRange, nowInMalaysia } from "@/lib/format";
import { TRAINING_TYPE_LABELS, TRAINING_TYPES } from "@/lib/validation/training";
import { DATE, HOURS, MONEY, sheet, type Row } from "@/server/excel";
import { can } from "@/server/permissions";
import { perHead } from "@/server/rules/dashboard";
import { PME_STAGE_LABELS } from "@/server/rules/pme";
import { round2 } from "@/server/rules/report";
import { quarterLabel, SKILL_STAGE_LABELS, SKILL_STAGES } from "@/server/rules/skill";
import { TNA_STAGE_LABELS, TNA_STAGES } from "@/server/rules/tna";
import { PROGRESS_PME_STAGES, progressDashboard, trainingDashboard } from "@/server/services/dashboard";
import { getCurrentUser } from "@/server/session";
import { parseReportFilters } from "../../reports/filters";

const day = (d: string) => new Date(`${d}T00:00:00Z`);

/** The Excel file of the Dashboard's charts, as filtered on screen: one sheet per chart, the same numbers. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  if (user.mustChangePassword) return new Response("Change your password first", { status: 403 });
  if (!can(user, "report.view")) return new Response("Forbidden", { status: 403 });

  const params = new URL(request.url).searchParams;
  // Only the period, as on the screen; the cost sheet follows the cost chart's year when one is chosen.
  const { from, to } = parseReportFilters(Object.fromEntries(params));
  const costYear = /^\d{4}$/.test(params.get("costYear") ?? "") ? Number(params.get("costYear")) : undefined;
  const data = await trainingDashboard(user, { from, to }, nowInMalaysia(), costYear);
  const covers = `Trainings that started ${formatDateRange(day(data.period.from), day(data.period.to))}`;
  const period = data.unit === "month" ? "Month" : "Year";
  const wb = new ExcelJS.Workbook();
  wb.creator = "LDMS";

  const { overview } = data;
  sheet(
    wb,
    "Training overview",
    "Training overview",
    `${covers}, cancelled ones not counted.`,
    [
      { header: "No", key: "no", width: 6 },
      { header: "Figure", key: "figure", width: 36 },
      { header: "Value", key: "value", width: 14, numFmt: HOURS },
      { header: "What It Counts", key: "counts", width: 60 },
    ],
    [
      { figure: "Total trainings", value: overview.trainings, counts: "Trainings that started in the period" },
      { figure: "Total participant attend training", value: overview.attended, counts: "Staff who completed at least one" },
      { figure: "Total manpower", value: overview.manpower, counts: "Active staff, not counting trainees" },
      { figure: "Total training days", value: overview.days, counts: "Each training's days × the people who completed it" },
      { figure: "Total hours", value: overview.hours, counts: "Each training's hours × the people who completed it" },
      ...TRAINING_TYPES.map((t) => ({ figure: `Total ${TRAINING_TYPE_LABELS[t]} hours`, value: overview.hoursByType[t], counts: "" })),
      { figure: "Average total hours", value: perHead(overview.hours, overview.manpower), counts: "Total hours ÷ total manpower" },
      ...TRAINING_TYPES.map((t) => ({
        figure: `Average ${TRAINING_TYPE_LABELS[t]} hours`,
        value: perHead(overview.hoursByType[t], overview.manpower),
        counts: "Its total hours ÷ total manpower",
      })),
    ],
  );

  // Hours by training type: a column per type, then the total and the average per person.
  const typeTotals = TRAINING_TYPES.map((_, s) => round2(data.byType.reduce((a, values) => a + values[s], 0)));
  sheet(
    wb,
    "Hours by training type",
    "Hours by training type",
    `${covers}. Average: total hours ÷ headcount of ${data.total.headcount} (active staff, not counting trainees).`,
    [
      { header: "No", key: "no", width: 6 },
      { header: period, key: "period", width: 18 },
      ...TRAINING_TYPES.map((t) => ({ header: TRAINING_TYPE_LABELS[t], key: t, width: 18, numFmt: HOURS })),
      { header: "Total Hours", key: "hours", width: 12, numFmt: HOURS },
      { header: "Average Per Person", key: "average", width: 18, numFmt: HOURS },
    ],
    data.buckets.map((b, i) => {
      const hours = round2(data.byType[i].reduce((a, h) => a + h, 0));
      return {
        period: b.title,
        ...Object.fromEntries(TRAINING_TYPES.map((t, s) => [t, data.byType[i][s]])),
        hours,
        average: perHead(hours, data.total.headcount),
      } as Row;
    }),
    { period: "Total", ...Object.fromEntries(TRAINING_TYPES.map((t, s) => [t, typeTotals[s]])), hours: data.total.hours, average: data.total.average },
  );

  sheet(
    wb,
    "Hours by department",
    "Hours by department",
    `${covers}. Headcount: active staff, not counting trainees. Average: total hours ÷ headcount.`,
    [
      { header: "No", key: "no", width: 6 },
      { header: "Division", key: "division", width: 24 },
      { header: "Department", key: "department", width: 30 },
      { header: "Headcount", key: "headcount", width: 11 },
      { header: "Staff Trained", key: "trained", width: 13 },
      { header: "Trainings Completed", key: "completed", width: 19 },
      { header: "Total Hours", key: "hours", width: 12, numFmt: HOURS },
      { header: "Average Per Head", key: "average", width: 16, numFmt: HOURS },
    ],
    data.departments.map((d) => ({
      division: d.division.name,
      department: d.name,
      headcount: d.headcount,
      trained: d.trained,
      completed: d.completed,
      hours: d.hours,
      average: d.average,
    })),
    {
      department: "Total",
      headcount: data.total.headcount,
      trained: data.total.trained,
      completed: data.total.completed,
      hours: data.total.hours,
      average: data.total.average,
    },
  );

  sheet(
    wb,
    "Top 5 most hours",
    "Top 5 most hours",
    `${covers}. The staff with the most completed hours.`,
    [
      { header: "No", key: "no", width: 6 },
      { header: "Staff No", key: "staffNo", width: 11 },
      { header: "Name", key: "name", width: 34 },
      { header: "Department", key: "department", width: 28 },
      { header: "Trainings Completed", key: "completed", width: 19 },
      { header: "Total Hours", key: "hours", width: 12, numFmt: HOURS },
    ],
    data.top.map((s) => ({ staffNo: s.staffNo, name: s.name, department: s.department.name, completed: s.completed, hours: s.hours })),
  );

  sheet(
    wb,
    "Top 5 in-house trainers",
    "Top 5 in-house trainers",
    `${covers}, cancelled ones not counted. Hours: each training's own hours, however many attended.`,
    [
      { header: "No", key: "no", width: 6 },
      { header: "Staff No", key: "staffNo", width: 11 },
      { header: "Name", key: "name", width: 34 },
      { header: "Department", key: "department", width: 28 },
      { header: "Trainings Given", key: "trainings", width: 16 },
      { header: "Total Hours", key: "hours", width: 12, numFmt: HOURS },
    ],
    data.topTrainers.map((s) => ({ staffNo: s.staffNo, name: s.name, department: s.department.name, trainings: s.completed, hours: s.hours })),
  );

  sheet(
    wb,
    "Top 5 trainings",
    "Top 5 trainings (total man hour)",
    `${covers}. Man hours: the training's hours × the people who completed it.`,
    [
      { header: "No", key: "no", width: 6 },
      { header: "Training Code", key: "code", width: 19 },
      { header: "Title", key: "title", width: 44 },
      { header: "Type", key: "type", width: 18 },
      { header: "Completed", key: "completed", width: 11 },
      { header: "Total Man Hours", key: "manHours", width: 16, numFmt: HOURS },
    ],
    data.topTrainings.map((t) => ({ code: t.trainingCode, title: t.title, type: TRAINING_TYPE_LABELS[t.type], completed: t.completed, manHours: t.manHours })),
  );

  if (data.cost) {
    sheet(
      wb,
      "Monthly total cost",
      "Monthly total cost (RM)",
      `${data.cost.year ? `Trainings that started in ${data.cost.year}` : covers}, cancelled ones not counted. ${data.cost.withoutCost} with no cost entered (OJT not counted), ${data.cost.withCost} with one.`,
      [
        { header: "No", key: "no", width: 6 },
        { header: data.cost.unit === "month" ? "Month" : "Year", key: "period", width: 18 },
        { header: "Cost (RM)", key: "cost", width: 14, numFmt: MONEY },
      ],
      data.cost.buckets.map((b, i) => ({ period: b.title, cost: data.cost!.byBucket[i] })),
      { period: "Total", cost: data.cost.total },
    );
  }

  // ---------- Progress: one sheet for each of PME, skill matrix, TNA and TNI ----------
  const progress = await progressDashboard(user, { from, to }, nowInMalaysia());
  const stageSheet = <S extends string>(
    name: string,
    title: string,
    what: string,
    stages: readonly S[],
    labels: Record<S, string>,
    counted: { rows: { department: { name: string; division: { name: string } }; counts: Record<S, number> }[]; total: Record<S, number> },
  ) => {
    const all = (counts: Record<S, number>) => stages.reduce((a, s) => a + counts[s], 0);
    sheet(
      wb,
      name,
      title,
      what,
      [
        { header: "No", key: "no", width: 6 },
        { header: "Division", key: "division", width: 24 },
        { header: "Department", key: "department", width: 30 },
        ...stages.map((s) => ({ header: labels[s], key: s, width: 18 })),
        { header: "Total", key: "all", width: 9 },
      ],
      counted.rows.map((r) => ({ division: r.department.division.name, department: r.department.name, ...r.counts, all: all(r.counts) }) as Row),
      { department: "Total", ...counted.total, all: all(counted.total) } as Row,
    );
  };
  stageSheet(
    "PME progress",
    "PME by department",
    `PMEs of ${covers.charAt(0).toLowerCase()}${covers.slice(1)}, by where each stands. One in its evaluation period isn't due yet.`,
    PROGRESS_PME_STAGES,
    PME_STAGE_LABELS,
    progress.pme,
  );
  stageSheet(
    "Skill matrix progress",
    `Skill matrix by department, ${quarterLabel(progress.quarter)}`,
    "Non-executive and contract staff, by where each one's matrix stands for the quarter being filled in.",
    SKILL_STAGES,
    SKILL_STAGE_LABELS,
    progress.skill,
  );
  stageSheet(
    "TNA progress",
    `TNA by department, ${progress.year}`,
    "Each person who fills in their own TNA, and each job grade's TNA, by where it stands for the year being filled in.",
    TNA_STAGES,
    TNA_STAGE_LABELS,
    progress.tna,
  );
  sheet(
    wb,
    "TNI progress",
    `TNI by department, ${progress.year}`,
    "Whether each department has saved its training needs identification for the year.",
    [
      { header: "No", key: "no", width: 6 },
      { header: "Division", key: "division", width: 24 },
      { header: "Department", key: "department", width: 30 },
      { header: "Saved", key: "saved", width: 8 },
      { header: "Last Saved", key: "updatedAt", width: 12, numFmt: DATE },
      { header: "Saved By", key: "updatedBy", width: 30 },
      { header: "Rows", key: "rows", width: 7 },
    ],
    progress.tni.map(({ department, tni }) => ({
      division: department.division.name,
      department: department.name,
      saved: tni ? "Yes" : "No",
      updatedAt: tni?.updatedAt ?? null,
      updatedBy: tni?.updatedBy?.name ?? "",
      rows: tni?._count.items ?? 0,
    })),
  );

  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="LDMS dashboard ${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
