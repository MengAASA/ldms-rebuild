import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { RoleCode } from "@prisma/client";
import { Pencil } from "lucide-react";
import { Avatar, DivisionMark } from "@/components/brand";
import { PageHeader } from "@/components/PageHeader";
import { HistoryPanel } from "@/components/HistoryPanel";
import { Panel } from "@/components/Panel";
import { Sheet, SheetItem } from "@/components/Sheet";
import { Status, StaffStatus } from "@/components/ui/Status";
import { formatDate, formatDateTime, nowInMalaysia, plural, yearsOfService } from "@/lib/format";
import { divisionTone } from "@/lib/tones";
import { DESIGNATION_LABELS, GENDER_LABELS } from "@/lib/validation/staff";
import { can, canManageStaffRecord, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/server/permissions";
import { approverReasonLabel, hasNoApproverByDesign } from "@/server/rules/approver";
import { tnaKindLabel } from "@/server/rules/tna";
import { approverFor, approvesCount } from "@/server/services/approver";
import { staffTrainingHistory } from "@/server/services/report";
import { staffSkillHistory } from "@/server/services/skill";
import { getStaffRecord, recordHistory } from "@/server/services/staff";
import { requireUser } from "@/server/session";
import { ReinstateDialog, ResetPasswordDialog, ResignDialog, RolesForm } from "./RecordActions";
import { SkillPanel } from "./SkillPanel";
import { TrainingPanel } from "./TrainingPanel";

export const metadata: Metadata = { title: "Staff record" };

const SAVED: Record<string, string> = { created: "Staff record added.", updated: "Changes saved." };

export default async function StaffRecordPage({ params, searchParams }: PageProps<"/staff/[id]">) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const staff = await getStaffRecord(user, id);
  if (!staff) notFound();

  const { saved } = await searchParams;
  const [approver, approves, history, training, skills] = await Promise.all([
    staff.status === "ACTIVE" ? approverFor(id) : Promise.resolve(null),
    staff.status === "ACTIVE" ? approvesCount(id) : Promise.resolve(0),
    can(user, "staff.manage") || can(user, "audit.view") ? recordHistory(id) : Promise.resolve([]),
    staffTrainingHistory(user, id, nowInMalaysia()),
    staffSkillHistory(user, id),
  ]);
  const manage = canManageStaffRecord(user, staff);
  const active = staff.status === "ACTIVE";
  const heads = [...staff.hodOf.map((d) => `HOD of ${d.name}`), ...staff.headOf.map((d) => `head of ${d.name}`)];

  return (
    <div>
      <PageHeader module="staff"
        context={{ href: "/staff", label: "Staff" }}
        title={staff.name}
        leading={<Avatar name={staff.name} tone={divisionTone(staff.department.division.id)} size={46} />}
        meta={
          <>
            <span className="num">{staff.staffNo}</span>
            <span>{DESIGNATION_LABELS[staff.designation]}</span>
            <StaffStatus status={staff.status} />
          </>
        }
        actions={
          manage && (
            <>
              <Link href={`/staff/${id}/edit`} className="btn">
                <Pencil size={14} aria-hidden /> Edit
              </Link>
              <ResetPasswordDialog id={id} name={staff.name} staffNo={staff.staffNo} />
              {/* Both stay mounted so a dialog's result is still shown after the status flips. */}
              {staff.id !== user.id && (
                <ResignDialog
                  id={id}
                  name={staff.name}
                  hidden={!active}
                  hodNote={heads.length ? `${staff.name} is ${heads.join(" and ")}. That assignment will be removed; choose a replacement in Organization afterwards.` : undefined}
                />
              )}
              <ReinstateDialog id={id} name={staff.name} hidden={active} />
            </>
          )
        }
      />

      {typeof saved === "string" && SAVED[saved] && (
        <div role="status" className="notice notice-ok mt-4">
          {SAVED[saved]}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Sheet title="Employment">
            <SheetItem label="Department">
              <DivisionMark tone={divisionTone(staff.department.division.id)} className="mr-2" />
              {can(user, "org.view") ? (
                <Link href={`/organization/departments/${staff.departmentId}`} className="link">
                  {staff.department.name}
                </Link>
              ) : (
                staff.department.name
              )}
              <span className="text-ink-3"> · {staff.department.division.name}</span>
            </SheetItem>
            <SheetItem label="Section">{staff.section?.name ?? <span className="text-ink-3">None</span>}</SheetItem>
            <SheetItem label="Position">{staff.position ?? <span className="text-ink-3">Not recorded</span>}</SheetItem>
            <SheetItem label="Designation">{DESIGNATION_LABELS[staff.designation]}</SheetItem>
            <SheetItem label="Gender">{staff.gender ? GENDER_LABELS[staff.gender] : <span className="text-ink-3">Not recorded</span>}</SheetItem>
            <SheetItem label="Plant">{staff.plant ?? <span className="text-ink-3">Not recorded</span>}</SheetItem>
            <SheetItem label="Job grade">{staff.jobGrade ? <span className="num">{staff.jobGrade}</span> : <span className="text-ink-3">None</span>}</SheetItem>
            <SheetItem label="TNA">
              {tnaKindLabel({ ...staff, isHead: staff.hodOf.length > 0 || staff.headOf.length > 0 })}
            </SheetItem>
            <SheetItem label="Date joined">
              {staff.dateJoined ? (
                <>
                  <span className="num">{formatDate(staff.dateJoined)}</span>
                  <span className="text-ink-3"> · {yearsOfService(staff.dateJoined, staff.dateResigned)}</span>
                </>
              ) : (
                <span className="text-ink-3">Not recorded</span>
              )}
            </SheetItem>
            {staff.dateResigned && (
              <SheetItem label="Last working day">
                <span className="num">{formatDate(staff.dateResigned)}</span>
              </SheetItem>
            )}
            <SheetItem label="Email">{staff.email ? <a href={`mailto:${staff.email}`} className="link">{staff.email}</a> : <span className="text-ink-3">None</span>}</SheetItem>
          </Sheet>

          {active && (
            <Sheet title="Reporting line">
              <SheetItem label="Approver">
                {approver?.approverId && approver.approver ? (
                  <>
                    <Link href={`/staff/${approver.approver.id}`} className="link">
                      {approver.approver.name}
                    </Link>
                    <span className="text-ink-3"> · HOD of the department</span>
                  </>
                ) : approver?.basis === "NONE" ? (
                  <Status tone={hasNoApproverByDesign(approver) ? "na" : "wait"}>{approverReasonLabel[approver.reason]}</Status>
                ) : null}
              </SheetItem>
              {heads.length > 0 && <SheetItem label="Heads">{heads.map((h) => h[0].toUpperCase() + h.slice(1)).join("; ")}</SheetItem>}
              {approves > 0 && <SheetItem label="Approves for">{plural(approves, "active staff member", "active staff")}</SheetItem>}
            </Sheet>
          )}

          {training && <TrainingPanel history={training} openTrainings={can(user, "training.view")} />}

          <SkillPanel history={skills} />

          <HistoryPanel
            entries={history}
            fields={{
              jobGrade: { label: "Job grade" },
              gender: { label: "Gender", format: (v) => (v === "MALE" || v === "FEMALE" ? GENDER_LABELS[v] : "Not recorded") },
              plant: { label: "Plant", format: (v) => (typeof v === "string" && v ? v : "Not recorded") },
              fillsOwnTna: { label: "Fills in own TNA", format: (v) => (v === true || v === "true" ? "Yes" : "No") },
            }}
          />
        </div>

        <aside className="flex flex-col gap-5">
          <Sheet title="Sign-in">
            <div className="py-3 text-[13px]">
              {!active ? (
                <Status tone="na">Cannot sign in (resigned)</Status>
              ) : staff.mustChangePassword ? (
                <Status tone="wait">Temporary password, must change at next sign-in</Status>
              ) : staff.passwordHash ? (
                <Status tone="ok">Has a v2 password</Status>
              ) : staff.legacyMd5 ? (
                <Status tone="na">Migrated password, not signed in to v2 yet</Status>
              ) : (
                <Status tone="bad">No password, cannot sign in</Status>
              )}
              <div className="mt-1 text-xs text-ink-3">
                Last sign-in: {staff.lastSignInAt ? <span className="num">{formatDateTime(staff.lastSignInAt)}</span> : "never"}
              </div>
            </div>
          </Sheet>

          <Panel title="Access">
            <div>
              {can(user, "staff.roles") && active ? (
                <RolesForm
                  id={id}
                  current={staff.roles.map((r) => r.role)}
                  options={(Object.keys(ROLE_LABELS) as RoleCode[]).map((code) => ({ code, label: ROLE_LABELS[code], description: ROLE_DESCRIPTIONS[code] }))}
                />
              ) : (
                <p className="text-[13px]">{staff.roles.length ? staff.roles.map((r) => ROLE_LABELS[r.role]).join(", ") : "Staff (no extra roles)"}</p>
              )}
              <p className="mt-3 text-xs text-ink-3">HOD and division-head access comes from Organization, not from roles.</p>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
