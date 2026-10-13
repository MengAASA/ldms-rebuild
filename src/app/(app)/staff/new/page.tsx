import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { isAdmin, manageableDesignations } from "@/server/permissions";
import { departmentOptions } from "@/server/services/org";
import { plantOptions } from "@/server/services/staff";
import { requirePermission } from "@/server/session";
import { createStaffAction } from "../actions";
import { StaffForm } from "../StaffForm";

export const metadata: Metadata = { title: "Add staff" };

export default async function NewStaffPage() {
  const user = await requirePermission("staff.manage");
  const designations = manageableDesignations(user);
  const departments = await departmentOptions();

  return (
    <div>
      <PageHeader module="staff" context={{ href: "/staff", label: "Staff" }} title="Add staff" />
      <div className="mt-5">
        <StaffForm
          action={createStaffAction}
          departments={departments}
          plants={await plantOptions()}
          designations={designations}
          submitLabel="Add staff"
          cancelHref="/staff"
          canSetTna={isAdmin(user)}
          initial={{
            staffNo: "",
            name: "",
            email: "",
            position: "",
            designation: designations.length === 1 ? designations[0] : "",
            gender: "",
            plant: "",
            departmentId: "",
            sectionId: "",
            dateJoined: "",
            jobGrade: "",
            fillsOwnTna: false,
          }}
        />
        <p className="mt-6 max-w-[720px] text-xs text-ink-3">
          New staff have no password. Reset it from their record to give them a temporary password for their first sign-in.
        </p>
      </div>
    </div>
  );
}
