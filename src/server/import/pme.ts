import type { Prisma } from "@prisma/client";
import { cleanDate, keptPme, mapPmeAnswers, mapPmeStatus, pmeStatusForTraining, type NewPmeStatus } from "../rules/import";
import { pmeMark, pmePeriod } from "../rules/pme";
import { trainingHours } from "../rules/training";
import type { ImportRun } from "./run";

// PME: the old `pme` and `pme_archive` tables, each attached to the attendance
// the trainings part brought across. Everything comes across as the old system
// left it, pending ones too (decided 19 Oct 2026), whatever the person's
// designation, except on a training of 4 hours or less: there a pending PME,
// or one the old daily job completed without an evaluation, is Not required,
// as v2 treats a short training (pmeStatusForTraining). Only a PME whose
// attendance is gone has nowhere to go.

type OldPme = {
  id: number;
  participationid: number | null;
  userid: number | null;
  trainingid: number | null;
  hodid: number | null;
  ojt: string | null;
  r1: string | null;
  p1: string | null;
  m1: string | null;
  r2: string | null;
  p2: string | null;
  m2: string | null;
  r3: string | null;
  p3: string | null;
  m3: string | null;
  r4: string | null;
  p4: string | null;
  m4: string | null;
  from_date: string | null;
  to_date: string | null;
  average_mark: unknown;
  status: string | null;
  pme_created: Date | null;
  verified_by: number | null;
  designation: string | null;
  table: string;
};

const P = "pme" as const;
const CHUNK = 1000;
const COLUMNS =
  "id, participationid, userid, trainingid, hodid, ojt, level_rating AS r1, level_percent AS p1, level_remark AS m1, level_rating2 AS r2, " +
  "level_percent2 AS p2, level_remark2 AS m2, behavioral_rating AS r3, behavioral_percent AS p3, behavioral_remark AS m3, result_rating AS r4, " +
  "result_percent AS p4, result_remark AS m4, CAST(from_date AS CHAR) AS from_date, CAST(to_date AS CHAR) AS to_date, average_mark, status, " +
  "pme_created, verified_by, designation";
const STATUSES: [NewPmeStatus, string][] = [
  ["PENDING", "Pending"],
  ["EVALUATED", "Evaluated (approved)"],
  ["ACKNOWLEDGED", "Acknowledged (completed)"],
  ["VERIFIED", "Verified"],
  ["NOT_REQUIRED", "Not required (not applicable)"],
];
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function importPmes(run: ImportRun) {
  const [live, archive, users] = await Promise.all([
    run.read<OldPme>(`SELECT ${COLUMNS}, 'pme' AS \`table\` FROM pme ORDER BY id`),
    run.read<OldPme>(`SELECT ${COLUMNS}, 'pme_archive' AS \`table\` FROM pme_archive ORDER BY id`),
    run.read<{ id: number }>("SELECT id FROM user"),
  ]);
  const old = [...archive, ...live];
  const db = run.target;

  // The attendance the trainings part brought across (checking only: what the last real run left there).
  const participants = await db.participant.findMany({
    where: { training: { legacySource: "training" } },
    select: {
      id: true,
      legacyId: true,
      training: { select: { legacyId: true, startDate: true, endDate: true, startTime: true, endTime: true } },
      staff: { select: { legacyId: true, designation: true } },
    },
  });
  const byOldRow = new Map(participants.map((p) => [p.legacyId, p]));
  // The same person on the same training: where the old row was a duplicate the trainings part left out.
  const byPerson = new Map(participants.map((p) => [`${p.training.legacyId}:${p.staff.legacyId}`, p]));
  const staffOf = new Map(
    (await db.staff.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((s) => [s.legacyId!, s.id]),
  );
  const oldUsers = new Set(users.map((u) => u.id));

  type Planned = { old: OldPme; status: NewPmeStatus; participant: (typeof participants)[number] };
  const onParticipant = new Map<number, Planned[]>();
  for (const o of old) {
    const status = mapPmeStatus(o.status);
    if (!status) {
      run.issue(P, "Not imported: a status v2 doesn't have", o.table, o.id, String(o.status));
      continue;
    }
    let participant = o.participationid === null ? undefined : byOldRow.get(o.participationid);
    if (!participant) {
      participant = byPerson.get(`${o.trainingid}:${o.userid}`);
      if (participant)
        run.issue(
          P,
          "Its attendance row was left out: attached to the same person's row on the same training",
          o.table,
          o.id,
          `attendance ${o.participationid}`,
        );
    }
    if (!participant) {
      run.issue(
        P,
        "Not imported: its attendance is not in v2",
        o.table,
        o.id,
        o.userid !== null && !oldUsers.has(o.userid) ? "the staff member is gone" : `attendance ${o.participationid} is gone`,
      );
      continue;
    }
    if (o.trainingid !== null && participant.training.legacyId !== o.trainingid)
      run.issue(P, "Names a different training from its attendance row's: attached to the attendance row", o.table, o.id, `training ${o.trainingid}`);
    onParticipant.set(participant.id, [...(onParticipant.get(participant.id) ?? []), { old: o, status, participant }]);
  }

  // One PME per attendance: the one furthest on is kept.
  const rows: Prisma.PmeCreateManyInput[] = [];
  let pendingNonExec = 0;
  const shortened = new Map<NewPmeStatus, number>(); // old status → how many short-training PMEs became Not required
  let withAnswers = 0;
  let finishedWithout = 0;
  for (const group of onParticipant.values()) {
    const kept = group.length > 1 ? group.find((g) => g.old.id === keptPme(group.map((x) => ({ id: x.old.id, status: x.status }))).id)! : group[0];
    for (const other of group)
      if (other !== kept)
        run.issue(P, "Not imported: another PME for the same attendance was kept", other.old.table, other.old.id, `kept ${kept.old.table} ${kept.old.id}`);

    const o = kept.old;
    const mapped = mapPmeAnswers({
      ojt: o.ojt,
      ratings: [o.r1, o.r2, o.r3, o.r4],
      percents: [o.p1, o.p2, o.p3, o.p4],
      remarks: [o.m1, o.m2, o.m3, o.m4],
    });
    if (mapped.odd.length) run.issue(P, "An answer that doesn't fit the PME form", o.table, o.id, mapped.odd.join("; "));
    if (mapped.answers) withAnswers++;
    // A short training's PME needs no evaluation: what the old daily job did, v2 does from the start.
    const status = pmeStatusForTraining(kept.status, trainingHours(kept.participant.training), mapped.answers !== null);
    if (status !== kept.status) {
      shortened.set(kept.status, (shortened.get(kept.status) ?? 0) + 1);
      run.issue(P, "Training of 4 hours or less: imported as Not required, as v2 treats a short training", o.table, o.id, `old status ${o.status}`);
    }
    const designation = kept.participant.staff.designation;
    if (status === "PENDING" && designation !== "EXECUTIVE" && designation !== "MANAGER") pendingNonExec++;
    const finished = status === "EVALUATED" || status === "ACKNOWLEDGED" || status === "VERIFIED";
    if (finished && !mapped.answers) finishedWithout++;
    if (mapped.answers && status === "PENDING") run.issue(P, "Pending, but the HOD's answers are there: kept for when they evaluate", o.table, o.id);

    // The mark: the old one where it has one; otherwise worked out as v2 does when L&D verify.
    const oldMark = Number(o.average_mark ?? 0) > 0 ? round2(Number(o.average_mark)) : null;
    const mark = mapped.answers ? pmeMark(mapped.answers).average : null;
    if (oldMark !== null && mark !== null && Math.abs(oldMark - mark) >= 0.01)
      run.issue(P, "The old average mark differs from its four percentages: the old mark kept", o.table, o.id, `old ${oldMark}, from the percentages ${mark}`);

    const start = cleanDate(o.from_date);
    const end = cleanDate(o.to_date);
    const period = start && end && end >= start ? { periodStart: start, periodEnd: end } : pmePeriod(kept.participant.training);
    if (!start || !end || end < start)
      run.issue(P, "No evaluation period in the old system: worked out from the training", o.table, o.id, `${o.from_date} to ${o.to_date}`);

    const evaluator = finished && o.hodid ? (staffOf.get(o.hodid) ?? null) : null;
    rows.push({
      participantId: kept.participant.id,
      status,
      ...period,
      ...(mapped.answers ? { answers: mapped.answers, answersVersion: 1, ojtConducted: mapped.answers.ojtConducted } : {}),
      averageMark: status === "VERIFIED" ? (oldMark ?? mark) : null,
      evaluatedById: evaluator,
      verifiedById: status === "VERIFIED" && o.verified_by ? (staffOf.get(o.verified_by) ?? null) : null,
      legacyId: o.id,
      // The old system kept when a PME was made, not when it was evaluated, acknowledged or verified: those stay blank.
      ...(o.pme_created ? { createdAt: o.pme_created } : {}),
    });
  }
  if (!run.checkOnly) for (let i = 0; i < rows.length; i += CHUNK) await db.pme.createMany({ data: rows.slice(i, i + CHUNK) });

  // ---- old against v2
  const count = async (where: Prisma.PmeWhereInput, planned: (r: Prisma.PmeCreateManyInput) => boolean) =>
    run.checkOnly ? rows.filter(planned).length : db.pme.count({ where });
  const notIn = old.length - rows.length;
  run.count(P, "PMEs", old.length, await count({}, () => true), notIn ? `${notIn} not imported, each listed with its reason` : "");
  for (const [status, label] of STATUSES) {
    const word =
      status === "EVALUATED" ? "approved" : status === "ACKNOWLEDGED" ? "completed" : status === "NOT_REQUIRED" ? "not_applicable" : status.toLowerCase();
    const moved = status === "NOT_REQUIRED" ? [...shortened.values()].reduce((a, b) => a + b, 0) : (shortened.get(status) ?? 0);
    const note = !moved ? "" : status === "NOT_REQUIRED" ? `${moved} short-training PMEs added` : `${moved} on a short training now Not required`;
    run.count(P, label, old.filter((o) => (o.status ?? "").toLowerCase() === word).length, await count({ status }, (r) => r.status === status), note);
  }
  run.count(P, "With the HOD's evaluation", withAnswers, await count({ answersVersion: { not: null } }, (r) => r.answersVersion != null));
  run.count(
    P,
    "Finished with no evaluation on record",
    finishedWithout,
    await count(
      { status: { in: ["EVALUATED", "ACKNOWLEDGED", "VERIFIED"] }, answersVersion: null },
      (r) => r.status !== "PENDING" && r.status !== "NOT_REQUIRED" && r.answersVersion == null,
    ),
    "the old system marked them done without the HOD's answers",
  );
  run.count(
    P,
    "Pending, for non-executives",
    pendingNonExec,
    run.checkOnly
      ? pendingNonExec
      : await db.pme.count({ where: { status: "PENDING", participant: { staff: { designation: { notIn: ["EXECUTIVE", "MANAGER"] } } } } }),
    "by their designation now; v2 itself asks only for executives and managers, but these came across all the same (decided 19 Oct 2026)",
  );
}
