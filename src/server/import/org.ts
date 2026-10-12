import { cleanShortName, cleanText, isDeletedDepartment } from "../rules/import";
import type { ImportRun } from "./run";

// The org chart: `divisions`, `departments` and `sections` as they are. Who
// heads each division and department is set with the staff (the next part),
// since it points at a staff record.

type OldDivision = { id: number; name: string | null; shortname: string | null };
type OldDepartment = OldDivision & { division_id: number | null };
type OldSection = OldDivision & { department_id: number | null };

const NAME_MAX = 120;

export async function importOrg(run: ImportRun) {
  const [divisions, departments, sections] = await Promise.all([
    run.read<OldDivision>("SELECT id, name, shortname FROM divisions ORDER BY id"),
    run.read<OldDepartment>("SELECT id, division_id, name, shortname FROM departments ORDER BY id"),
    run.read<OldSection>("SELECT id, department_id, name, shortname FROM sections ORDER BY id"),
  ]);

  /** The name and short name as v2 stores them; null (and listed) when the row has no name. */
  const named = (table: string, row: OldDivision) => {
    const name = cleanText(row.name, NAME_MAX);
    const shortName = cleanShortName(row.shortname);
    if (!name.value) {
      run.issue("org", "No name", table, row.id);
      return null;
    }
    if (name.cut) run.issue("org", `Name cut to ${NAME_MAX} characters`, table, row.id);
    if (shortName.cut) run.issue("org", "Short name cut to 20 characters", table, row.id);
    return { name: name.value, shortName: shortName.value, legacyId: row.id };
  };

  const divisionRows = divisions.flatMap((d) => named("divisions", d) ?? []);
  const divisionIds = new Set(divisionRows.map((d) => d.legacyId));
  const deleted = new Set(departments.filter((d) => isDeletedDepartment(d.name)).map((d) => d.id));
  const DELETED = "Department marked (DELETED) in the old system: not imported";
  const departmentRows = departments.flatMap((d) => {
    if (deleted.has(d.id)) {
      run.issue("org", DELETED, "departments", d.id, "Its staff go to the holding department");
      return [];
    }
    const row = named("departments", d);
    if (!row) return [];
    if (d.division_id === null || !divisionIds.has(d.division_id)) {
      run.issue("org", "Its division is not in the old database", "departments", d.id, `division_id ${d.division_id}`);
      return [];
    }
    return { ...row, oldDivisionId: d.division_id };
  });
  const departmentIds = new Set(departmentRows.map((d) => d.legacyId));
  const sectionRows = sections.flatMap((s) => {
    if (s.department_id !== null && deleted.has(s.department_id)) {
      run.issue("org", "Section of a department marked (DELETED): not imported", "sections", s.id, `department_id ${s.department_id}`);
      return [];
    }
    const row = named("sections", s);
    if (!row) return [];
    if (s.department_id === null || !departmentIds.has(s.department_id)) {
      run.issue("org", "Its department is not in the old database", "sections", s.id, `department_id ${s.department_id}`);
      return [];
    }
    return { ...row, oldDepartmentId: s.department_id };
  });

  if (!run.checkOnly) {
    const db = run.target;
    await db.division.createMany({ data: divisionRows });
    const newDivision = new Map((await db.division.findMany({ select: { id: true, legacyId: true } })).map((d) => [d.legacyId, d.id]));
    await db.department.createMany({
      data: departmentRows.map(({ oldDivisionId, ...d }) => ({ ...d, divisionId: newDivision.get(oldDivisionId)! })),
    });
    const newDepartment = new Map((await db.department.findMany({ select: { id: true, legacyId: true } })).map((d) => [d.legacyId, d.id]));
    await db.section.createMany({
      data: sectionRows.map(({ oldDepartmentId, ...s }) => ({ ...s, departmentId: newDepartment.get(oldDepartmentId)! })),
    });
  }

  // Counted from the database that was filled, not from what was sent to it.
  const [d, p, s, deptPerDivision] = run.checkOnly
    ? [divisionRows.length, departmentRows.length, sectionRows.length, null]
    : await Promise.all([
        run.target.division.count(),
        run.target.department.count(),
        run.target.section.count(),
        run.target.division.findMany({ select: { legacyId: true, _count: { select: { departments: true } } } }),
      ]);
  run.count("org", "Divisions", divisions.length, d);
  run.count("org", "Departments", departments.length, p, deleted.size ? `${deleted.size} marked (DELETED) left out` : "");
  run.count("org", "Sections", sections.length, s, deleted.size ? "those of the (DELETED) department left out" : "");

  // The same departments under the same divisions: a count that only matches if none moved.
  if (deptPerDivision) {
    const oldPer = new Map<number, number>();
    for (const dept of departments)
      if (dept.division_id !== null && !deleted.has(dept.id)) oldPer.set(dept.division_id, (oldPer.get(dept.division_id) ?? 0) + 1);
    const agree = deptPerDivision.filter((x) => x.legacyId !== null && (oldPer.get(x.legacyId) ?? 0) === x._count.departments).length;
    run.count("org", "Divisions with the same departments", divisions.length, agree);
  }
}
