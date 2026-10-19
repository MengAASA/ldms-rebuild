import type { Prisma, RoleCode } from "@prisma/client";
import { nowInMalaysia } from "@/lib/format";
import type { SessionUser } from "../permissions";
import { HOLDING_DEPARTMENT, mapSkillRating, mapSkillSection, mapSkillStatus, type NewSkillStatus } from "../rules/import";
import { SKILL_DESIGNATIONS, quarterLabel, sameQuarter, skillActionBlock, skillOpenQuarter, skillTopicKey, skillViewer } from "../rules/skill";
import type { ImportRun } from "./run";

// Skill matrices: the old `skill_matrix_evaluations` with their topics and
// lines, all from 2026. Each comes across with the quarter the old system
// stores on it (decision 10) and its status, for whoever it is about, resigned
// staff and executives too. The evaluator role came with the staff (module 1).
//
// The old system kept when a matrix was made and when it was approved, not
// when it was sent to the HOD: the day it was made stands in for that, so the
// Approvals page has an order and a "waiting since".

type OldEvaluation = {
  id: number;
  staffid: number;
  eval_year: number;
  eval_quarter: number;
  created_by: number | null;
  approved_by: number | null;
  approval_status: string | null;
  approved_at: Date | null;
  created_at: Date | null;
};
type OldTopic = { id: number; evaluation_id: number; section_type: string; topic_name: string; sort_order: number };
type OldItem = { id: number; topic_id: number; evaluation_text: string; rating: number; sort_order: number };

const P = "skill" as const;
const CHUNK = 2000;
const SECTION_ORDER = { KNOWLEDGE: 0, SKILL: 1, ABILITY: 2 } as const;
const STATUS_ORDER: Record<NewSkillStatus, number> = { DRAFT: 0, SUBMITTED: 1, APPROVED: 2 };
const STATUS_WORD: Record<NewSkillStatus, string> = { DRAFT: "draft", SUBMITTED: "waiting for the HOD", APPROVED: "approved" };
const OLD_STATUS: Record<NewSkillStatus, string | null> = { DRAFT: null, SUBMITTED: "PENDING", APPROVED: "APPROVED" };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A topic's score as a fraction of the most it could be, unrounded: what the old chart showed. */
const rawScore = (ratings: number[]) => (ratings.reduce((a, b) => a + b, 0) / (ratings.length * 5)) * 100;

/** A matrix's average on the chart, unrounded: topics matched by `key`, a topic named twice pooled. Null with nothing rated. */
function chartAverage(topics: { key: string; ratings: number[] }[]): number | null {
  const pooled = new Map<string, number[]>();
  for (const t of topics) pooled.set(t.key, [...(pooled.get(t.key) ?? []), ...t.ratings]);
  const scores = [...pooled.values()].filter((r) => r.length).map(rawScore);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

export async function importSkillMatrices(run: ImportRun) {
  const [evaluations, topics, items, users] = await Promise.all([
    run.read<OldEvaluation>(
      "SELECT id, staffid, eval_year, eval_quarter, created_by, approved_by, approval_status, approved_at, created_at FROM skill_matrix_evaluations ORDER BY id",
    ),
    run.read<OldTopic>("SELECT id, evaluation_id, section_type, topic_name, sort_order FROM skill_matrix_topics ORDER BY id"),
    run.read<OldItem>("SELECT id, topic_id, evaluation_text, rating, sort_order FROM skill_matrix_items ORDER BY id"),
    run.read<{ id: number; hodid: number | null; department_id: number | null }>("SELECT id, hodid, department_id FROM user"),
  ]);
  const db = run.target;
  const oldUser = new Map(users.map((u) => [u.id, u]));

  // v2's staff, with what the skill matrix rules need to know about each.
  const staff = await db.staff.findMany({
    where: { legacyId: { not: null } },
    select: {
      id: true,
      legacyId: true,
      status: true,
      designation: true,
      departmentId: true,
      department: { select: { divisionId: true } },
      roles: { select: { role: true } },
    },
  });
  const departments = await db.department.findMany({ select: { id: true, name: true, legacyId: true, hodId: true } });
  const hodOf = new Map<number, number[]>();
  for (const d of departments) if (d.hodId) hodOf.set(d.hodId, [...(hodOf.get(d.hodId) ?? []), d.id]);
  const byOld = new Map(staff.map((s) => [s.legacyId!, s]));
  const legacyOf = new Map(staff.map((s) => [s.id, s.legacyId!]));
  const departmentOf = new Map(departments.map((d) => [d.id, d]));
  /** Someone as the rules see a signed-in person: only what they ask about. */
  const asUser = (s: (typeof staff)[number]): SessionUser => ({
    id: s.id,
    staffNo: "",
    name: "",
    departmentId: s.departmentId,
    departmentName: "",
    divisionId: s.department.divisionId,
    designation: s.designation,
    roles: s.roles.map((r) => r.role as RoleCode),
    hodOfDepartmentIds: hodOf.get(s.id) ?? [],
    headOfDivisionIds: [],
    mustChangePassword: false,
  });
  const today = nowInMalaysia();
  const open = skillOpenQuarter(today);

  // ---- the matrices: one per person per quarter
  type Planned = { old: OldEvaluation; status: NewSkillStatus; subject: (typeof staff)[number] };
  const onQuarter = new Map<string, Planned[]>();
  for (const o of evaluations) {
    const status = mapSkillStatus(o.approval_status);
    if (!status) {
      run.issue(P, "Not imported: a status v2 doesn't have", "skill_matrix_evaluations", o.id, String(o.approval_status));
      continue;
    }
    if (!(o.eval_quarter >= 1 && o.eval_quarter <= 4)) {
      run.issue(P, "Not imported: a quarter that isn't 1 to 4", "skill_matrix_evaluations", o.id, `${o.eval_year} quarter ${o.eval_quarter}`);
      continue;
    }
    const subject = byOld.get(o.staffid);
    if (!subject) {
      run.issue(P, "Not imported: the staff member is not in v2", "skill_matrix_evaluations", o.id, `staff ${o.staffid}`);
      continue;
    }
    const k = `${subject.id}:${o.eval_year}:${o.eval_quarter}`;
    onQuarter.set(k, [...(onQuarter.get(k) ?? []), { old: o, status, subject }]);
  }

  const topicsOf = new Map<number, OldTopic[]>();
  for (const t of topics) topicsOf.set(t.evaluation_id, [...(topicsOf.get(t.evaluation_id) ?? []), t]);
  const itemsOf = new Map<number, OldItem[]>();
  for (const i of items) itemsOf.set(i.topic_id, [...(itemsOf.get(i.topic_id) ?? []), i]);

  // Ids are given here, so the topics and lines can point at what they belong to without reading anything back.
  const [maxEvaluation, maxTopic, maxItem] = await Promise.all([
    db.skillEvaluation.aggregate({ _max: { id: true } }),
    db.skillTopic.aggregate({ _max: { id: true } }),
    db.skillItem.aggregate({ _max: { id: true } }),
  ]);
  let nextEvaluation = (maxEvaluation._max.id ?? 0) + 1;
  let nextTopic = (maxTopic._max.id ?? 0) + 1;
  let nextItem = (maxItem._max.id ?? 0) + 1;

  const rows: Prisma.SkillEvaluationCreateManyInput[] = [];
  const topicRows: Prisma.SkillTopicCreateManyInput[] = [];
  const itemRows: Prisma.SkillItemCreateManyInput[] = [];
  let ratingTotal = 0;
  for (const group of onQuarter.values()) {
    const kept = group.reduce((best, g) =>
      STATUS_ORDER[g.status] > STATUS_ORDER[best.status] || (g.status === best.status && g.old.id > best.old.id) ? g : best,
    );
    for (const other of group)
      if (other !== kept)
        run.issue(P, "Not imported: another matrix for the same person and quarter was kept", "skill_matrix_evaluations", other.old.id, `kept ${kept.old.id}`);

    const { old: o, status, subject } = kept;
    const quarter = { year: o.eval_year, quarter: o.eval_quarter };
    const evaluator = o.created_by === null ? undefined : byOld.get(o.created_by);
    const approver = o.approved_by === null ? undefined : byOld.get(o.approved_by);
    if (o.created_by !== null && !evaluator)
      run.issue(P, "Filled in by someone not in v2: no evaluator recorded", "skill_matrix_evaluations", o.id, `staff ${o.created_by}`);
    if (status === "APPROVED" && !approver)
      run.issue(P, "Approved by someone not in v2: no approver recorded", "skill_matrix_evaluations", o.id, `staff ${o.approved_by}`);

    // Imported as they are, and listed: what v2 itself wouldn't let happen today.
    if (subject.status !== "ACTIVE") run.issue(P, "For staff who have since resigned", "skill_matrix_evaluations", o.id, STATUS_WORD[status]);
    if (!(SKILL_DESIGNATIONS as readonly string[]).includes(subject.designation))
      run.issue(
        P,
        "For someone v2 has no matrix for (not non-executive or contract): on their staff record and the chart, not the list",
        "skill_matrix_evaluations",
        o.id,
        subject.designation,
      );
    if (evaluator?.id === subject.id) run.issue(P, "Filled in by the staff member themselves", "skill_matrix_evaluations", o.id, STATUS_WORD[status]);
    else if (evaluator && evaluator.departmentId !== subject.departmentId)
      run.issue(P, "Filled in by someone from another department", "skill_matrix_evaluations", o.id, STATUS_WORD[status]);
    if (status !== "APPROVED" && sameQuarter(quarter, open) && evaluator) {
      const blocked = skillActionBlock("EDIT", { ...quarter, status: "DRAFT", staff: { name: "this person" } }, skillViewer(asUser(evaluator), subject), today);
      if (blocked)
        run.issue(
          P,
          `In the open quarter (${quarterLabel(open)}), but its evaluator can't change it in v2`,
          "skill_matrix_evaluations",
          o.id,
          STATUS_WORD[status],
        );
    }
    if (status === "SUBMITTED") {
      const department = departmentOf.get(subject.departmentId);
      if (!department?.hodId)
        run.issue(P, "Waiting for the HOD, but the department has no HOD in v2", "skill_matrix_evaluations", o.id, department?.name ?? "");
      else {
        // The old system asked the evaluator's own HOD; v2 asks the HOD of the person's department.
        const oldHod = o.created_by === null ? null : (oldUser.get(o.created_by)?.hodid ?? null);
        if (oldHod !== null && legacyOf.get(department.hodId) !== oldHod)
          run.issue(P, "Waiting for the HOD: v2 asks the department's HOD, not the evaluator's own", "skill_matrix_evaluations", o.id, department.name);
      }
    }

    const id = nextEvaluation++;
    const lastChanged = (status === "APPROVED" ? o.approved_at : null) ?? o.created_at;
    rows.push({
      id,
      staffId: subject.id,
      year: o.eval_year,
      quarter: o.eval_quarter,
      status,
      createdById: evaluator?.id ?? null,
      submittedAt: status === "DRAFT" ? null : (o.created_at ?? null),
      approvedById: status === "APPROVED" ? (approver?.id ?? null) : null,
      approvedAt: status === "APPROVED" ? (o.approved_at ?? null) : null,
      legacyId: o.id,
      ...(o.created_at ? { createdAt: o.created_at } : {}),
      ...(lastChanged ? { updatedAt: lastChanged } : {}),
    });

    // Topics in v2's order: knowledge, skill, ability, each as the old form had them; lines likewise.
    const mine = (topicsOf.get(o.id) ?? []).flatMap((t) => {
      const section = mapSkillSection(t.section_type);
      if (!section) run.issue(P, "Topic not imported: a section v2 doesn't have", "skill_matrix_topics", t.id, t.section_type);
      return section ? [{ t, section }] : [];
    });
    mine.sort((a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || a.t.sort_order - b.t.sort_order || a.t.id - b.t.id);
    const names = new Set<string>();
    let repeated = false;
    for (const [i, { t, section }] of mine.entries()) {
      const topicId = nextTopic++;
      const k = skillTopicKey(section, t.topic_name);
      if (names.has(k)) repeated = true;
      names.add(k);
      topicRows.push({ id: topicId, evaluationId: id, section, name: t.topic_name.trim(), sortOrder: i });
      const lines = [...(itemsOf.get(t.id) ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      for (const [j, line] of lines.entries()) {
        const rating = mapSkillRating(line.rating);
        if (rating === null) run.issue(P, "A line whose rating isn't 1 to 5: left unrated", "skill_matrix_items", line.id, String(line.rating));
        else ratingTotal += rating;
        itemRows.push({ id: nextItem++, topicId, text: line.evaluation_text.trim(), rating, sortOrder: j });
      }
    }
    if (repeated)
      run.issue(
        P,
        "A topic named twice in one section: the chart pools its lines, as the old chart did",
        "skill_matrix_evaluations",
        o.id,
        STATUS_WORD[status],
      );
  }
  if (!run.checkOnly) {
    for (let i = 0; i < rows.length; i += CHUNK) await db.skillEvaluation.createMany({ data: rows.slice(i, i + CHUNK) });
    for (let i = 0; i < topicRows.length; i += CHUNK) await db.skillTopic.createMany({ data: topicRows.slice(i, i + CHUNK) });
    for (let i = 0; i < itemRows.length; i += CHUNK) await db.skillItem.createMany({ data: itemRows.slice(i, i + CHUNK) });
  }

  // ---- old against v2
  const notIn = evaluations.length - rows.length;
  run.count(
    P,
    "Skill matrices",
    evaluations.length,
    run.checkOnly ? rows.length : await db.skillEvaluation.count(),
    notIn ? `${notIn} not imported, each listed with its reason` : "",
  );
  run.count(P, "Topics", topics.length, run.checkOnly ? topicRows.length : await db.skillTopic.count());
  run.count(P, "Lines", items.length, run.checkOnly ? itemRows.length : await db.skillItem.count());
  const v2Ratings = run.checkOnly ? ratingTotal : ((await db.skillItem.aggregate({ _sum: { rating: true } }))._sum.rating ?? 0);
  run.count(
    P,
    "Ratings added up",
    items.reduce((a, i) => a + Number(i.rating), 0),
    v2Ratings,
  );

  const quarters = [...new Set(evaluations.map((o) => `${o.eval_year}-${o.eval_quarter}`))].sort();
  for (const q of quarters) {
    const [year, quarter] = q.split("-").map(Number);
    for (const status of ["DRAFT", "SUBMITTED", "APPROVED"] as const) {
      const old = evaluations.filter((o) => o.eval_year === year && o.eval_quarter === quarter && o.approval_status === OLD_STATUS[status]).length;
      const v2 = run.checkOnly
        ? rows.filter((r) => r.year === year && r.quarter === quarter && r.status === status).length
        : await db.skillEvaluation.count({ where: { year, quarter, status } });
      if (old || v2) run.count(P, `${quarterLabel({ year, quarter })}: ${STATUS_WORD[status]}`, old, v2);
    }
  }

  // ---- the chart: submitted and approved matrices, each person's average of their topics' scores
  const oldDepartment = new Map(departments.filter((d) => d.legacyId !== null).map((d) => [d.legacyId!, d.name]));
  const oldItemsOf = (topicId: number) => (itemsOf.get(topicId) ?? []).map((i) => Number(i.rating));
  type ChartLine = { quarter: string; department: string; average: number | null };
  const oldChart: ChartLine[] = evaluations
    .filter((o) => o.approval_status === "PENDING" || o.approval_status === "APPROVED")
    .map((o) => {
      const departmentId = oldUser.get(o.staffid)?.department_id ?? null;
      return {
        quarter: `${o.eval_year}-${o.eval_quarter}`,
        department: (departmentId !== null && oldDepartment.get(departmentId)) || HOLDING_DEPARTMENT,
        // The old chart grouped a matrix's topics by section and name exactly as typed.
        average: chartAverage((topicsOf.get(o.id) ?? []).map((t) => ({ key: `${t.section_type}|${t.topic_name}`, ratings: oldItemsOf(t.id) }))),
      };
    });
  const v2Chart: ChartLine[] = run.checkOnly
    ? []
    : (
        await db.skillEvaluation.findMany({
          where: { status: { in: ["SUBMITTED", "APPROVED"] } },
          select: {
            year: true,
            quarter: true,
            staff: { select: { department: { select: { name: true } } } },
            topics: { select: { section: true, name: true, items: { select: { rating: true } } } },
          },
        })
      ).map((m) => ({
        quarter: `${m.year}-${m.quarter}`,
        department: m.staff.department.name,
        average: chartAverage(
          m.topics.map((t) => ({ key: skillTopicKey(t.section, t.name), ratings: t.items.flatMap((i) => (i.rating === null ? [] : [i.rating])) })),
        ),
      }));
  const mean = (lines: ChartLine[]) => {
    const averages = lines.flatMap((l) => (l.average === null ? [] : [l.average]));
    return averages.length ? round2(averages.reduce((a, b) => a + b, 0) / averages.length) : 0;
  };
  for (const q of quarters) {
    const label = quarterLabel({ year: Number(q.split("-")[0]), quarter: Number(q.split("-")[1]) });
    const oldLines = oldChart.filter((l) => l.quarter === q);
    const v2Lines = run.checkOnly ? oldLines : v2Chart.filter((l) => l.quarter === q);
    run.count(P, `Chart, ${label}: people on it`, oldLines.length, v2Lines.length);
    run.count(P, `Chart, ${label}: average score (%)`, mean(oldLines), mean(v2Lines), "before v2 rounds each score to a whole percentage");
    for (const department of [...new Set([...oldLines, ...v2Lines].map((l) => l.department))].sort()) {
      const o = oldLines.filter((l) => l.department === department);
      const n = v2Lines.filter((l) => l.department === department);
      run.detail(P, `Chart, ${label}, ${department}: people on it`, o.length, n.length);
      run.detail(P, `Chart, ${label}, ${department}: average score (%)`, mean(o), mean(n));
    }
  }
}
