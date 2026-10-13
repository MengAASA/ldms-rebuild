"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, fieldProps, FormMessage, SubmitButton, useFormAction } from "@/components/ui/forms";
import { DateField } from "@/components/ui/DateField";
import { Select } from "@/components/ui/Select";
import type { ActionState } from "@/lib/action-state";
import { DESIGNATION_LABELS, GENDER_LABELS, GENDERS, JOB_GRADES } from "@/lib/validation/staff";

type Department = { id: number; name: string; division: { name: string }; sections: { id: number; name: string }[] };

export type StaffFormValues = {
  staffNo: string;
  name: string;
  email: string;
  position: string;
  designation: string;
  gender: string;
  plant: string;
  departmentId: number | "";
  sectionId: number | "";
  dateJoined: string;
  jobGrade: number | "";
  fillsOwnTna: boolean;
};

export function StaffForm({
  action,
  initial,
  departments,
  plants,
  designations,
  submitLabel,
  cancelHref,
  canSetTna,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial: StaffFormValues;
  departments: Department[];
  /** The plants already on staff records, offered as suggestions. */
  plants: string[];
  designations: string[];
  submitLabel: string;
  cancelHref: string;
  /** L&D decide who fills in their own TNA; clerks see the field's value but can't change it. */
  canSetTna: boolean;
}) {
  const { state, onSubmit, pending } = useFormAction(action);
  const [departmentId, setDepartmentId] = useState<number | "">(initial.departmentId);
  const [designation, setDesignation] = useState(initial.designation);
  const alwaysOwnTna = designation === "EXECUTIVE" || designation === "MANAGER";
  const sections = departments.find((d) => d.id === departmentId)?.sections ?? [];

  return (
    <form onSubmit={onSubmit} noValidate className="card flex max-w-[760px] flex-col gap-7 p-5 sm:p-7">
      <FormMessage state={state} />
      <p className="-mb-3 text-xs text-ink-3">
        Fields marked <span className="text-bad">*</span> are required.
      </p>

      <fieldset className="flex flex-col gap-4">
        <legend className="ruled-heading mb-4 w-full">Identity</legend>
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <Field label="Staff no." name="staffNo" required state={state} hint="As printed on the staff pass.">
            <input
              {...fieldProps("staffNo", state)}
              defaultValue={initial.staffNo}
              className="input num uppercase"
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Full name" name="name" required state={state} hint="As in the IC or passport.">
            <input {...fieldProps("name", state)} defaultValue={initial.name} className="input" maxLength={160} autoComplete="off" />
          </Field>
        </div>
        <Field
          label="Company email"
          name="email"
          state={state}
          hint="Needed for PME and attendance reminders. Leave blank if the staff member has no company account."
        >
          <input
            {...fieldProps("email", state)}
            defaultValue={initial.email}
            type="email"
            className="input sm:max-w-[360px]"
            maxLength={160}
            autoComplete="off"
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="ruled-heading mb-4 w-full">Employment</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Designation"
            name="designation"
            required
            state={state}
            hint={designations.length === 1 ? "You can add contract staff only." : "Decides PME eligibility and headcount."}
          >
            <Select
              {...fieldProps("designation", state)}
              value={designation}
              onChange={setDesignation}
              options={designations.map((d) => ({ value: d, label: DESIGNATION_LABELS[d as keyof typeof DESIGNATION_LABELS] }))}
            />
          </Field>
          <Field label="Position" name="position" state={state} hint="Job title, e.g. Senior Technician.">
            <input {...fieldProps("position", state)} defaultValue={initial.position} className="input" maxLength={120} />
          </Field>
          <Field label="Department" name="departmentId" required state={state}>
            <Select
              {...fieldProps("departmentId", state)}
              value={departmentId === "" ? "" : String(departmentId)}
              onChange={(v) => setDepartmentId(v ? Number(v) : "")}
              options={departments.map((d) => ({ value: String(d.id), label: d.name, group: d.division.name }))}
            />
          </Field>
          <Field
            label="Section"
            name="sectionId"
            state={state}
            hint={departmentId === "" ? "Choose a department first." : sections.length === 0 ? "This department has no sections." : undefined}
          >
            <Select
              key={departmentId}
              {...fieldProps("sectionId", state)}
              defaultValue={departmentId === initial.departmentId ? String(initial.sectionId) : ""}
              placeholder="None"
              disabled={sections.length === 0}
              options={[{ value: "", label: "None" }, ...sections.map((s) => ({ value: String(s.id), label: s.name }))]}
            />
          </Field>
          <Field label="Gender" name="gender" state={state}>
            <Select
              {...fieldProps("gender", state)}
              defaultValue={initial.gender}
              placeholder="Not recorded"
              options={[{ value: "", label: "Not recorded" }, ...GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))]}
            />
          </Field>
          <Field label="Plant" name="plant" state={state} hint="Where they work, e.g. PEGOH PLANT. Pick one from the list or type a new one.">
            <input {...fieldProps("plant", state)} defaultValue={initial.plant} className="input" maxLength={60} list="staff-plants" autoComplete="off" />
            <datalist id="staff-plants">
              {plants.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label="Date joined" name="dateJoined" state={state}>
            <DateField {...fieldProps("dateJoined", state)} defaultValue={initial.dateJoined} />
          </Field>
          <Field label="Job grade" name="jobGrade" state={state} hint="1 to 5. Staff who don't fill in their own TNA are covered by their grade's.">
            <Select
              {...fieldProps("jobGrade", state)}
              defaultValue={initial.jobGrade === "" ? "" : String(initial.jobGrade)}
              placeholder="None"
              options={[{ value: "", label: "None" }, ...JOB_GRADES.map((g) => ({ value: String(g), label: `Grade ${g}` }))]}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="ruled-heading mb-4 w-full">Training needs (TNA)</legend>
        {alwaysOwnTna ? (
          <p className="text-[13px] text-ink-2">Executives and managers fill in their own TNA each year, for their HOD to approve.</p>
        ) : (
          <>
            <label className="flex items-start gap-2.5 text-[13.5px]">
              <input
                type="checkbox"
                name="fillsOwnTna"
                defaultChecked={initial.fillsOwnTna}
                disabled={!canSetTna}
                className="mt-0.5 accent-primary"
                aria-describedby="fillsOwnTna-hint"
              />
              <span>
                Fills in their own TNA
                <span id="fillsOwnTna-hint" className="hint mt-0.5 block">
                  For office staff who aren&apos;t executives. Left unticked, they are covered by the TNA for their job grade.
                  {!canSetTna && " Only the L&D unit can change this."}
                </span>
              </span>
            </label>
          </>
        )}
      </fieldset>

      <div className="flex items-center gap-2 border-t border-rule pt-4">
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
