import ExcelJS from "exceljs";
import { DESIGNATION_LABELS, GENDER_LABELS } from "@/lib/validation/staff";
import { can } from "@/server/permissions";
import { listStaffForExport } from "@/server/services/staff";
import { getCurrentUser } from "@/server/session";
import { parseStaffFilters } from "../filters";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  if (user.mustChangePassword) return new Response("Change your password first", { status: 403 });
  if (!can(user, "staff.view")) return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const filters = parseStaffFilters(Object.fromEntries(url.searchParams));
  const rows = await listStaffForExport(user, filters);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LDMS";
  const ws = wb.addWorksheet("Staff", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Staff No", key: "staffNo", width: 12 },
    { header: "Name", key: "name", width: 36 },
    { header: "Email", key: "email", width: 32 },
    { header: "Position", key: "position", width: 30 },
    { header: "Designation", key: "designation", width: 16 },
    { header: "Gender", key: "gender", width: 10 },
    { header: "Plant", key: "plant", width: 24 },
    { header: "Job Grade", key: "jobGrade", width: 10 },
    { header: "Fills Own TNA", key: "fillsOwnTna", width: 14 },
    { header: "Division", key: "division", width: 22 },
    { header: "Department", key: "department", width: 34 },
    { header: "Section", key: "section", width: 22 },
    { header: "Date Joined", key: "dateJoined", width: 13, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Status", key: "status", width: 11 },
    { header: "Date Resigned", key: "dateResigned", width: 14, style: { numFmt: "dd/mm/yyyy" } },
  ];
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: "A1", to: "O1" };
  for (const s of rows) {
    ws.addRow({
      staffNo: s.staffNo,
      name: s.name,
      email: s.email ?? "",
      position: s.position ?? "",
      designation: DESIGNATION_LABELS[s.designation],
      gender: s.gender ? GENDER_LABELS[s.gender] : "",
      plant: s.plant ?? "",
      jobGrade: s.jobGrade,
      fillsOwnTna: s.fillsOwnTna ? "Yes" : "No",
      division: s.department.division.name,
      department: s.department.name,
      section: s.section?.name ?? "",
      dateJoined: s.dateJoined ?? null,
      status: s.status === "ACTIVE" ? "Active" : "Resigned",
      dateResigned: s.dateResigned ?? null,
    });
  }

  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="LDMS staff ${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
