import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { toDateInput } from "@/lib/format";
import { canManageStaffRecord, isAdmin, manageableDesignations } from "@/server/permissions";
import { departmentOptions } from "@/server/services/org";
import { getStaffRecord, plantOptions } from "@/server/services/staff";
import { requirePermission } from "@/server/session";
import { updateStaffAction } from "../../actions";
import { StaffForm } from "../../StaffForm";

export const metadata: Metadata = { title: "Edit staff" };

export default async function EditStaffPage({ params }: PageProps<"/staff/[id]/edit">) {
  const user = await requirePermission("staff.manage");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const staff = await getStaffRecord(user, id);
  if (!staff) notFound();
  if (!canManageStaffRecord(user, staff)) forbidden();

  return (
    <div>
      <PageHeader module="staff" context={{ href: `/staff/${id}`, label: staff.name }} title="Edit staff record" />
      {staff.hodOf.length > 0 && (
        <div className="notice notice-wait mt-4 max-w-[720px]">
          {staff.name} is HOD of {staff.hodOf.map((d) => d.name).join(", ")}. Moving them to another department removes them as HOD there.
        </div>
      )}
      <div className="mt-5">
        <StaffForm
          action={updateStaffAction.bind(null, id)}
          departments={await departmentOptions()}
          plants={await plantOptions()}
          designations={manageableDesignations(user)}
          submitLabel="Save changes"
          cancelHref={`/staff/${id}`}
          canSetTna={isAdmin(user)}
          initial={{
            staffNo: staff.staffNo,
            name: staff.name,
            email: staff.email ?? "",
            position: staff.position ?? "",
            designation: staff.designation,
            gender: staff.gender ?? "",
            plant: staff.plant ?? "",
            departmentId: staff.departmentId,
            sectionId: staff.sectionId ?? "",
            dateJoined: toDateInput(staff.dateJoined),
            jobGrade: staff.jobGrade ?? "",
            fillsOwnTna: staff.fillsOwnTna,
          }}
        />
      </div>
    </div>
  );
}
