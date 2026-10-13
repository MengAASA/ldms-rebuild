"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RoleCode } from "@prisma/client";
import type { ActionState } from "@/lib/action-state";
import { passwordResetSchema, resignSchema, staffSchema } from "@/lib/validation/staff";
import { parseForm, toErrorState } from "@/server/errors";
import { ROLE_LABELS } from "@/server/permissions";
import { requireUser } from "@/server/session";
import { createStaff, reinstateStaff, resetPassword, resignStaff, setRoles, updateStaff } from "@/server/services/staff";

const fields = (fd: FormData) => ({
  staffNo: fd.get("staffNo"),
  name: fd.get("name"),
  email: fd.get("email") ?? "",
  position: fd.get("position") ?? "",
  designation: fd.get("designation") ?? "",
  gender: fd.get("gender") ?? "",
  plant: fd.get("plant") ?? "",
  departmentId: fd.get("departmentId") ?? "",
  sectionId: fd.get("sectionId") ?? "",
  dateJoined: fd.get("dateJoined") ?? "",
  jobGrade: fd.get("jobGrade") ?? "",
  fillsOwnTna: fd.get("fillsOwnTna") === "on",
});

export async function createStaffAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  let id: number;
  try {
    const staff = await createStaff(user, parseForm(staffSchema, fields(fd)));
    id = staff.id;
  } catch (e) {
    return toErrorState(e);
  }
  revalidatePath("/staff");
  redirect(`/staff/${id}?saved=created`);
}

export async function updateStaffAction(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await updateStaff(user, id, parseForm(staffSchema, fields(fd)));
  } catch (e) {
    return toErrorState(e);
  }
  revalidatePath("/staff");
  redirect(`/staff/${id}?saved=updated`);
}

export async function resignAction(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const { dateResigned } = parseForm(resignSchema, { dateResigned: fd.get("dateResigned") });
    const { cleared } = await resignStaff(user, id, dateResigned);
    revalidatePath(`/staff/${id}`);
    return { status: "ok", message: cleared.length ? `Marked as resigned. Also removed as ${cleared.join(", ")}.` : "Marked as resigned." };
  } catch (e) {
    return toErrorState(e);
  }
}

export async function reinstateAction(id: number, _prev: ActionState): Promise<ActionState> {
  const user = await requireUser();
  try {
    await reinstateStaff(user, id);
    revalidatePath(`/staff/${id}`);
    return { status: "ok", message: "Reinstated as active." };
  } catch (e) {
    return toErrorState(e);
  }
}

export async function resetPasswordAction(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const { password } = parseForm(passwordResetSchema, { password: fd.get("password") });
    await resetPassword(user, id, password);
    revalidatePath(`/staff/${id}`);
    return { status: "ok", message: "Password reset and signed out everywhere. Give the temporary password to the staff member; they must change it when they sign in." };
  } catch (e) {
    return toErrorState(e);
  }
}

// Every role there is: the same list the Access panel offers.
const ROLE_CODES = Object.keys(ROLE_LABELS) as RoleCode[];

export async function setRolesAction(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const roles = fd.getAll("roles").filter((r): r is RoleCode => ROLE_CODES.includes(r as RoleCode));
    await setRoles(user, id, roles);
    revalidatePath(`/staff/${id}`);
    return { status: "ok", message: "Access updated." };
  } catch (e) {
    return toErrorState(e);
  }
}
