import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, DivisionMark } from "@/components/brand";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { Status } from "@/components/ui/Status";
import { plural } from "@/lib/format";
import { divisionTone } from "@/lib/tones";
import { db } from "@/server/db";
import { can } from "@/server/permissions";
import { departmentOptions, getDepartmentDetail, headCandidates } from "@/server/services/org";
import { requirePermission } from "@/server/session";
import {
  createSectionAction,
  deleteDepartmentAction,
  deleteSectionAction,
  renameSectionAction,
  setHodAction,
  transferAction,
  updateDepartmentAction,
} from "../../actions";
import { AddSectionForm, ConfirmDialog, HeadDialog, NameDialog, StaffTransferTable } from "../../OrgForms";

export const metadata: Metadata = { title: "Department" };

export default async function DepartmentPage({ params }: PageProps<"/organization/departments/[id]">) {
  const user = await requirePermission("org.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const dept = await getDepartmentDetail(id);
  if (!dept) notFound();

  const manage = can(user, "org.manage");
  const [candidates, departments, divisions] = manage
    ? await Promise.all([headCandidates(), departmentOptions(), db.division.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })])
    : [[], [], []];
  const tone = divisionTone(dept.divisionId);
  const hodActive = dept.hod?.status === "ACTIVE";
  const others = dept.staff.filter((s) => s.id !== dept.hodId).length;

  return (
    <div>
      <PageHeader
        module="organization"
        context={{ href: "/organization", label: "Organization" }}
        title={
          <>
            {dept.name}
            {dept.shortName && <span className="num ml-2.5 text-base font-normal text-ink-3">{dept.shortName}</span>}
          </>
        }
        meta={
          <>
            <Link href={`/organization#division-${dept.divisionId}`} className="inline-flex items-center gap-1.5 hover:text-accent">
              <DivisionMark tone={tone} />
              {dept.division.name} division
            </Link>
            <span>{plural(dept.staff.length, "active staff member", "active staff")}</span>
            <span>{plural(dept.sections.length, "section")}</span>
          </>
        }
        actions={
          manage && (
            <>
              <NameDialog
                label="Edit details"
                title={`Edit ${dept.name}`}
                description="Change the name or short name, or move the department to another division. Its staff move with it."
                action={updateDepartmentAction.bind(null, id)}
                initial={dept}
                divisions={divisions}
                submit="Save changes"
              />
              <ConfirmDialog
                label="Delete department"
                title={`Delete ${dept.name}?`}
                description={
                  dept.staff.length
                    ? `You can't delete ${dept.name} yet: it has ${plural(dept.staff.length, "active staff member", "active staff")}. Transfer them to another department first (tick them in the staff list below). Resigned staff records also have to be moved.`
                    : "Its sections are deleted with it. This can't be undone. If resigned staff records still belong to it, the delete will be refused."
                }
                action={deleteDepartmentAction.bind(null, id, dept.divisionId)}
                confirm="Delete department"
              />
            </>
          )
        }
      />

      <section
        aria-labelledby="hod-title"
        className={`rounded-lg border px-5 py-4 ${dept.hod && hodActive ? "border-rule bg-surface" : "border-wait/40 bg-wait-soft/60"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            {dept.hod && hodActive ? (
              <Avatar name={dept.hod.name} tone={tone} size={46} />
            ) : (
              <span aria-hidden className="flex size-[46px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-wait/60 text-wait">
                ?
              </span>
            )}
            <div className="min-w-0">
              <h2 id="hod-title" className="text-xs font-medium tracking-wide text-ink-3 uppercase">
                Head of department (HOD)
              </h2>
              {dept.hod && hodActive ? (
                <>
                  <div className="mt-0.5 text-[15px]">
                    <Link href={`/staff/${dept.hod.id}`} className="link font-semibold">
                      {dept.hod.name}
                    </Link>
                    <span className="text-ink-3">
                      {" "}
                      · <span className="num">{dept.hod.staffNo}</span>
                      {dept.hod.position && ` · ${dept.hod.position}`}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-2">
                    Approves PME, TNA and skill-matrix records for the {plural(others, "other staff member", "other staff")} here. The HOD has no approver in LDMS.
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-0.5 text-[15px] font-semibold">{dept.hod ? `${dept.hod.name} has resigned` : "No HOD yet"}</div>
                  <p className="mt-0.5 text-[13px] text-ink-2">Until a HOD is chosen, staff in this department have no one to approve their records.</p>
                </>
              )}
            </div>
          </div>
          {manage && (
            <HeadDialog
              label={dept.hod && hodActive ? "Change HOD" : "Assign HOD"}
              variant={dept.hod && hodActive ? "secondary" : "primary"}
              title={`HOD of ${dept.name}`}
              description="New PME, TNA and skill-matrix records from this department will go to this person for approval."
              action={setHodAction.bind(null, id)}
              currentId={hodActive ? dept.hod!.id : null}
              candidates={candidates}
              preferDepartment={dept.name}
            />
          )}
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel
          flush
          title={`Staff · ${dept.staff.length}`}
          action={
            <Link href={`/staff?departmentId=${id}`} className="link">
              Open in staff list
            </Link>
          }
        >
          {manage ? (
            <StaffTransferTable staff={dept.staff} sections={dept.sections} hodId={dept.hodId} departments={departments} currentDepartmentId={id} action={transferAction} />
          ) : (
            <ul className="px-5 text-[13px]">
              {dept.staff.map((s) => (
                <li key={s.id} className="border-b border-rule py-1.5 last:border-b-0">
                  <span className="num text-ink-3">{s.staffNo}</span> {s.name}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Sections">
          <p className="-mt-1 mb-2 text-xs text-ink-3">Optional teams inside the department, e.g. Press Line A.</p>
          <ul className="text-[13.5px]">
            {dept.sections.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 border-b border-rule py-1.5 last:border-b-0">
                <span className="min-w-0">
                  {s.name}
                  {s.shortName && <span className="text-xs text-ink-3"> ({s.shortName})</span>} <span className="num text-xs text-ink-3">· {s._count.staff}</span>
                </span>
                {manage && (
                  <span className="flex shrink-0">
                    <NameDialog label="Rename" title="Rename section" action={renameSectionAction.bind(null, s.id, id)} initial={{ name: s.name, shortName: null }} submit="Save" size="sm" variant="ghost" />
                    <ConfirmDialog
                      label="Delete"
                      size="sm"
                      title={`Delete section ${s.name}?`}
                      description={
                        s._count.staff
                          ? `You can't delete it yet: ${plural(s._count.staff, "active staff member is", "active staff are")} in this section. Transfer them to another section first.`
                          : "No active staff are in this section."
                      }
                      action={deleteSectionAction.bind(null, s.id)}
                      confirm="Delete section"
                    />
                  </span>
                )}
              </li>
            ))}
            {dept.sections.length === 0 && (
              <li className="py-1 text-[13px] text-ink-3">
                <Status tone="na">No sections</Status>
              </li>
            )}
          </ul>
          {manage && (
            <div className="mt-3 border-t border-rule pt-3">
              <AddSectionForm action={createSectionAction.bind(null, id)} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
