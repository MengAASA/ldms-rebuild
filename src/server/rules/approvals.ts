// The Approvals page's filters. Pure functions: the page keeps the records
// that match and leaves the rest out, the bulk approve buttons included.

export const APPROVAL_KINDS = ["PME_EVALUATE", "SKILL", "TNA", "PME_VERIFY"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  PME_EVALUATE: "PMEs to evaluate",
  SKILL: "Skill matrices to approve",
  TNA: "TNAs to approve",
  PME_VERIFY: "PMEs to verify",
};

export type ApprovalFilters = {
  /** Words to find, each somewhere in the record's name, staff no., training, evaluator and so on. */
  q?: string;
  kind?: ApprovalKind;
  /** A department's name. */
  department?: string;
};

/** What a waiting record is searched by. */
export type ApprovalRecord = { kind: ApprovalKind; department: string | null | undefined; text: (string | null | undefined)[] };

const tidy = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The filters from the page's URL: unknown values are ignored, the search is kept short. */
export function parseApprovalFilters(sp: { q?: string; kind?: string; department?: string }): ApprovalFilters {
  const q = (sp.q ?? "").replace(/\s+/g, " ").trim().slice(0, 80); // as typed, so the search box shows it back
  const department = (sp.department ?? "").trim().slice(0, 200);
  return {
    q: q || undefined,
    kind: (APPROVAL_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as ApprovalKind) : undefined,
    department: department || undefined,
  };
}

export const approvalFiltered = (f: ApprovalFilters) => !!(f.q || f.kind || f.department);

/** Whether a record is shown: of the kind and department asked for, with every word of the search in it, ignoring case. */
export function approvalMatches(r: ApprovalRecord, f: ApprovalFilters): boolean {
  if (f.kind && r.kind !== f.kind) return false;
  if (f.department && r.department !== f.department) return false;
  if (!f.q) return true;
  const haystack = tidy(r.text.filter(Boolean).join(" "));
  return tidy(f.q)
    .split(" ")
    .every((word) => haystack.includes(word));
}

/** How many rows a long Approvals table shows at a time (PMEs to verify). */
export const APPROVALS_PAGE_SIZE = 50;

/**
 * The page of a table to show, from the page asked for in the URL: a page
 * past the end shows the last one, anything that isn't a page number the
 * first. `start` and `end` slice the rows (end exclusive).
 */
export function approvalPage(rows: number, asked: string | undefined, size = APPROVALS_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows / size));
  const n = /^\d{1,6}$/.test(asked ?? "") ? Number(asked) : 1;
  const page = Math.min(Math.max(1, n), pages);
  return { page, pages, start: (page - 1) * size, end: Math.min(page * size, rows) };
}
