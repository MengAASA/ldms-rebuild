import type { Prisma, RoleCode } from "@prisma/client";
import {
  HOLDING_DEPARTMENT,
  HOLDING_DIVISION,
  cleanDate,
  cleanMd5,
  cleanStaffNo,
  cleanText,
  isDeletedDepartment,
  mapDesignation,
  mapGender,
  mapJobGrade,
  mapOldRoles,
  mapStaffStatus,
  oldPasswordShared,
} from "../rules/import";
import type { ImportRun } from "./run";

// Staff: the old `user` table, with roles, the skill matrix whitelist, and who
// heads each department and division. Everyone comes across, resigned staff
// too, because their training history hangs off them.

type OldUser = {
  id: number;
  password: string | null;
  staffno: string | null;
  staffname: string | null;
  email: string | null;
  gender: string | null;
  designation: string | null;
  department_id: number | null;
  section_id: number | null;
  plant: string | null;
  roletype: string | null;
  usertype: string | null;
  grade: number | null;
  status: string | null;
  date_join: string | null;
};

const P = "staff" as const;
const CHUNK = 1000;
const resigned = (u: OldUser) => (u.status ?? "").trim().toUpperCase() === "RESIGN";

export async function importStaff(run: ImportRun) {
  const [users, oldDepartments, oldDivisions, whitelist] = await Promise.all([
    run.read<OldUser>(
      "SELECT id, password, staffno, staffname, email, gender, designation, department_id, section_id, plant, roletype, usertype, grade, status, CAST(date_join AS CHAR) AS date_join FROM user ORDER BY id",
    ),
    run.read<{ id: number; name: string | null; hod_user_id: number | null }>("SELECT id, name, hod_user_id FROM departments"),
    run.read<{ id: number; head_user_id: number | null }>("SELECT id, head_user_id FROM divisions"),
    run.read<{ staffno: string }>("SELECT staffno FROM skill_matrix_whitelist"),
  ]);
  const oldSections = await run.read<{ id: number; department_id: number | null }>("SELECT id, department_id FROM sections");
  const deletedDepartments = new Set(oldDepartments.filter((d) => isDeletedDepartment(d.name)).map((d) => d.id));
  const keptDepartments = new Set(oldDepartments.filter((d) => !deletedDepartments.has(d.id)).map((d) => d.id));
  const sectionDepartment = new Map(oldSections.map((s) => [s.id, s.department_id]));

  // How many people have each old password: one that is shared must be changed at first sign-in.
  const sharing = new Map<string, number>();
  for (const u of users) {
    const md5 = cleanMd5(u.password);
    if (md5 && !resigned(u)) sharing.set(md5, (sharing.get(md5) ?? 0) + 1);
  }

  type Row = Omit<Prisma.StaffCreateManyInput, "departmentId" | "sectionId"> & {
    legacyId: number;
    oldDepartmentId: number | null;
    oldSectionId: number | null;
  };
  const rows: Row[] = [];
  const roles = new Map<number, Set<RoleCode>>(); // by old user id
  const seenStaffNo = new Set<string>();
  const whitelisted = new Set(whitelist.map((w) => cleanStaffNo(w.staffno).value));

  for (const u of users) {
    const staffNo = cleanStaffNo(u.staffno);
    const name = cleanText(u.staffname, 160);
    const designation = mapDesignation(u.designation);
    const status = mapStaffStatus(u.status);
    // Without these four there is no staff record to make. None is expected; each is listed if it happens.
    if (!staffNo.value) run.issue(P, "Not imported: no staff number, or one longer than 20 characters", "user", u.id);
    else if (seenStaffNo.has(staffNo.value)) run.issue(P, "Not imported: another record has the same staff number", "user", u.id);
    else if (!name.value) run.issue(P, "Not imported: no name", "user", u.id);
    else if (!designation) run.issue(P, "Not imported: a designation v2 doesn't have", "user", u.id, String(u.designation));
    else if (!status) run.issue(P, "Not imported: a status v2 doesn't have", "user", u.id, String(u.status));
    if (!staffNo.value || seenStaffNo.has(staffNo.value) || !name.value || !designation || !status) continue;
    seenStaffNo.add(staffNo.value);

    const active = status.status === "ACTIVE";
    if (staffNo.unusual)
      run.issue(P, "Staff number has a space, a symbol or under 3 characters (imported as it is)", "user", u.id, active ? "active" : "resigned");
    if (status.blank) run.issue(P, "Status blank in the old system: imported as active. HR to confirm they still work here", "user", u.id);

    // The department: their own, or the holding department when it was blank or is marked (DELETED).
    let oldDepartmentId: number | null = null;
    if (u.department_id !== null && keptDepartments.has(u.department_id)) oldDepartmentId = u.department_id;
    else {
      const why =
        u.department_id === null
          ? "No department in the old system"
          : deletedDepartments.has(u.department_id)
            ? "Department marked (DELETED) in the old system"
            : "Department not in the old database";
      run.issue(P, `${why}: put in "${HOLDING_DEPARTMENT}"`, "user", u.id, active ? "ACTIVE: needs a real department" : "resigned");
    }
    let oldSectionId: number | null = null;
    if (u.section_id !== null && oldDepartmentId !== null) {
      if (sectionDepartment.get(u.section_id) === oldDepartmentId) oldSectionId = u.section_id;
      else run.issue(P, "Section belongs to another department: section left blank", "user", u.id);
    }

    const old = mapOldRoles(u.roletype, u.usertype);
    for (const word of old.unknown) run.issue(P, "A role word v2 doesn't know: no role given for it", "user", u.id, word);
    const mine = new Set<RoleCode>(old.roles);
    if (whitelisted.has(staffNo.value)) mine.add("SKILL_EVALUATOR");
    if (mine.size && !active) run.issue(P, "Roles not carried: the person has resigned", "user", u.id, [...mine].join(", "));
    else if (mine.size) roles.set(u.id, mine);

    const md5 = active ? cleanMd5(u.password) : null; // resigned staff can't sign in: their old password is left behind
    rows.push({
      legacyId: u.id,
      staffNo: staffNo.value,
      name: name.value,
      email: cleanText(u.email, 160).value?.toLowerCase() ?? null,
      designation,
      gender: mapGender(u.gender),
      plant: cleanText(u.plant, 60).value?.toUpperCase() ?? null,
      status: status.status,
      dateJoined: cleanDate(u.date_join),
      jobGrade: mapJobGrade(u.grade),
      // "Office" marks a non-executive who fills in their own TNA; executives and managers always do.
      fillsOwnTna: old.fillsOwnTna && designation === "NON_EXECUTIVE",
      legacyMd5: md5,
      oldDepartmentId,
      oldSectionId,
    });
  }

  const byOldId = new Map(rows.map((r) => [r.legacyId, r]));
  // HODs and division heads: set only for someone who came across and is still working.
  const heads = (table: string, list: { id: number; who: number | null }[]) =>
    list.flatMap((x) => {
      if (x.who === null) return [];
      const person = byOldId.get(x.who);
      if (person?.status === "ACTIVE") return [{ oldId: x.id, who: x.who }];
      run.issue(P, person ? "Head has resigned: left without one" : "Head is not a staff record: left without one", table, x.id);
      return [];
    });
  const hods = heads(
    "departments",
    oldDepartments.filter((d) => keptDepartments.has(d.id)).map((d) => ({ id: d.id, who: d.hod_user_id })),
  );
  const divisionHeads = heads(
    "divisions",
    oldDivisions.map((d) => ({ id: d.id, who: d.head_user_id })),
  );
  const hodIds = new Set(oldDepartments.flatMap((d) => (d.hod_user_id === null ? [] : [d.hod_user_id])));
  for (const u of users)
    if (mapOldRoles(u.roletype, u.usertype).markedHod && !hodIds.has(u.id) && byOldId.has(u.id))
      run.issue(P, "Marked HOD in the old system but heads no department: not a HOD in v2", "user", u.id, resigned(u) ? "resigned" : "active");

  // Everyone keeps their old password, shared or not. Where someone can approve or change others' records,
  // L&D may want to ask them to choose their own.
  const headOf = new Map<number, string[]>();
  for (const h of hods) headOf.set(h.who, [...(headOf.get(h.who) ?? []), "HOD"]);
  for (const h of divisionHeads) headOf.set(h.who, [...(headOf.get(h.who) ?? []), "division head"]);
  for (const r of rows) {
    const what = [...(roles.get(r.legacyId) ?? []), ...(headOf.get(r.legacyId) ?? [])];
    if (what.length && r.legacyMd5 && oldPasswordShared(sharing.get(r.legacyMd5) ?? 0))
      run.issue(
        P,
        "Has a role or heads a department, and keeps the shared old password: anyone who knows it can sign in as them",
        "user",
        r.legacyId,
        [...new Set(what)].join(", "),
      );
  }

  const db = run.target;
  const holdingCount = rows.filter((r) => r.oldDepartmentId === null).length;
  if (!run.checkOnly) {
    const departmentOf = new Map(
      (await db.department.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((d) => [d.legacyId!, d.id]),
    );
    const sectionOf = new Map(
      (await db.section.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((s) => [s.legacyId!, s.id]),
    );
    let holdingId = 0;
    if (holdingCount) {
      const division = await db.division.create({ data: { name: HOLDING_DIVISION } });
      holdingId = (await db.department.create({ data: { name: HOLDING_DEPARTMENT, divisionId: division.id } })).id;
    }
    const data = rows.map(({ oldDepartmentId, oldSectionId, ...r }) => ({
      ...r,
      departmentId: oldDepartmentId === null ? holdingId : departmentOf.get(oldDepartmentId)!,
      sectionId: oldSectionId === null ? null : (sectionOf.get(oldSectionId) ?? null),
    }));
    for (let i = 0; i < data.length; i += CHUNK) await db.staff.createMany({ data: data.slice(i, i + CHUNK) });

    const staffOf = new Map(
      (await db.staff.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } })).map((s) => [s.legacyId!, s.id]),
    );
    await db.staffRole.createMany({ data: [...roles].flatMap(([oldId, set]) => [...set].map((role) => ({ staffId: staffOf.get(oldId)!, role }))) });
    for (const h of hods) await db.department.update({ where: { legacyId: h.oldId }, data: { hodId: staffOf.get(h.who)! } });
    for (const h of divisionHeads) await db.division.update({ where: { legacyId: h.oldId }, data: { headId: staffOf.get(h.who)! } });
  }

  // ---- old against v2. The old side is counted from the old rows by the old system's own test
  // ("not resigned"); the v2 side from the database that was filled.
  const notResigned = users.filter((u) => !resigned(u));
  const n = (list: OldUser[], test: (u: OldUser) => boolean) => list.filter(test).length;
  const v2 = async (where: Prisma.StaffWhereInput, planned: (r: Row) => boolean) => (run.checkOnly ? rows.filter(planned).length : db.staff.count({ where }));
  const roleCount = async (role: RoleCode) => (run.checkOnly ? [...roles.values()].filter((s) => s.has(role)).length : db.staffRole.count({ where: { role } }));

  run.count(P, "Staff", users.length, await v2({}, () => true));
  run.count(
    P,
    "Active",
    notResigned.length,
    await v2({ status: "ACTIVE" }, (r) => r.status === "ACTIVE"),
    "blank status counts as active, as in the old system",
  );
  run.count(P, "Resigned", users.length - notResigned.length, await v2({ status: "RESIGNED" }, (r) => r.status === "RESIGNED"));
  for (const [label, old, designation] of [
    ["Active non-executives", "NON EXECUTIVE", "NON_EXECUTIVE"],
    ["Active executives", "EXECUTIVE", "EXECUTIVE"],
    ["Active managers", "MANAGER (AM/HOS & ABOVE)", "MANAGER"],
    ["Active contract staff", "CONTRACT", "CONTRACT"],
    ["Active trainees", "TRAINEE", "TRAINEE"],
  ] as const)
    run.count(
      P,
      label,
      n(notResigned, (u) => u.designation === old),
      await v2({ status: "ACTIVE", designation }, (r) => r.status === "ACTIVE" && r.designation === designation),
    );

  run.count(
    P,
    "With an email address",
    n(users, (u) => !!u.email?.trim()),
    await v2({ email: { not: null } }, (r) => !!r.email),
  );
  run.count(
    P,
    "With a gender",
    n(users, (u) => ["MALE", "FEMALE"].includes((u.gender ?? "").toUpperCase())),
    await v2({ gender: { not: null } }, (r) => !!r.gender),
  );
  run.count(
    P,
    "With a plant",
    n(users, (u) => !!u.plant?.trim()),
    await v2({ plant: { not: null } }, (r) => !!r.plant),
  );
  run.count(
    P,
    "With a join date",
    n(users, (u) => !!u.date_join),
    await v2({ dateJoined: { not: null } }, (r) => !!r.dateJoined),
  );
  run.count(
    P,
    "With a job grade",
    n(users, (u) => (u.grade ?? 0) >= 1 && (u.grade ?? 0) <= 5),
    await v2({ jobGrade: { not: null } }, (r) => !!r.jobGrade),
  );
  run.count(
    P,
    "Fill in their own TNA (office)",
    n(users, (u) => (u.usertype ?? "").toUpperCase() === "OFFICE" && u.designation === "NON EXECUTIVE"),
    await v2({ fillsOwnTna: true }, (r) => !!r.fillsOwnTna),
    "non-executives; executives and managers always do",
  );

  const activeIds = new Set(notResigned.map((u) => u.id));
  run.count(
    P,
    "L&D admins",
    n(notResigned, (u) => (u.roletype ?? "").toUpperCase() === "ADMIN"),
    await roleCount("LD_ADMIN"),
    "active staff only",
  );
  run.count(
    P,
    "Main clerks",
    n(notResigned, (u) => (u.roletype ?? "").toUpperCase() === "CLERK"),
    await roleCount("MAIN_CLERK"),
    "active staff only; every old clerk is marked MAIN",
  );
  run.count(
    P,
    "Skill matrix evaluators",
    n(notResigned, (u) => whitelisted.has(cleanStaffNo(u.staffno).value)),
    await roleCount("SKILL_EVALUATOR"),
    "the whitelist, active staff only",
  );
  run.count(
    P,
    "Departments with a HOD",
    oldDepartments.filter((d) => keptDepartments.has(d.id) && d.hod_user_id !== null && activeIds.has(d.hod_user_id)).length,
    run.checkOnly ? hods.length : await db.department.count({ where: { hodId: { not: null } } }),
  );
  run.count(
    P,
    "Divisions with a head",
    oldDivisions.filter((d) => d.head_user_id !== null && activeIds.has(d.head_user_id)).length,
    run.checkOnly ? divisionHeads.length : await db.division.count({ where: { headId: { not: null } } }),
  );
  run.count(
    P,
    "Old passwords carried",
    notResigned.length,
    await v2({ legacyMd5: { not: null } }, (r) => !!r.legacyMd5),
    "active staff only; the same password, stored the modern way at first sign-in",
  );
  const shared = [...sharing].filter(([, c]) => oldPasswordShared(c)).map(([md5]) => md5);
  run.count(
    P,
    "Old password shared with others",
    [...sharing.values()].filter(oldPasswordShared).reduce((a, b) => a + b, 0),
    await v2({ legacyMd5: { in: shared } }, (r) => !!r.legacyMd5 && shared.includes(r.legacyMd5)),
    "they keep it (decided 15 Oct 2026): anyone who knows it can sign in as them",
  );
  run.count(
    P,
    `In "${HOLDING_DEPARTMENT}"`,
    n(users, (u) => u.department_id === null || !keptDepartments.has(u.department_id)),
    run.checkOnly ? holdingCount : await db.staff.count({ where: { department: { name: HOLDING_DEPARTMENT } } }),
    "no department, or one marked (DELETED)",
  );

  // The same number of staff in every department: only matches if nobody moved.
  if (!run.checkOnly) {
    const oldPer = new Map<number, number>();
    for (const u of users)
      if (u.department_id !== null && keptDepartments.has(u.department_id)) oldPer.set(u.department_id, (oldPer.get(u.department_id) ?? 0) + 1);
    const now = await db.department.findMany({ where: { legacyId: { not: null } }, select: { legacyId: true, _count: { select: { staff: true } } } });
    run.count(P, "Departments with the same staff count", keptDepartments.size, now.filter((d) => (oldPer.get(d.legacyId!) ?? 0) === d._count.staff).length);
  }
}
