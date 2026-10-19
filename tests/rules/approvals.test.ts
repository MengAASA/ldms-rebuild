import { describe, expect, it } from "vitest";
import { approvalFiltered, approvalMatches, approvalPage, parseApprovalFilters, type ApprovalRecord } from "@/server/rules/approvals";

const matrix: ApprovalRecord = { kind: "SKILL", department: "Stamping", text: ["Low Kai Xuan", "10235", "Operator", "Ooi Boon Kiat", "Q3 2026"] };
const pme: ApprovalRecord = { kind: "PME_EVALUATE", department: "Quality Control", text: ["Tan Wei Liang", "10236", null, "Hydraulic Press Basics"] };
const grade: ApprovalRecord = { kind: "TNA", department: "Stamping", text: [null, undefined, "Job grade 3", "Mohd Azrul bin Othman", "2026"] };

describe("the Approvals filters", () => {
  it("read from the URL, ignoring a kind there isn't and blank values", () => {
    expect(parseApprovalFilters({ q: "  Low   Kai ", kind: "SKILL", department: " Stamping " })).toEqual({
      q: "Low Kai",
      kind: "SKILL",
      department: "Stamping",
    });
    expect(parseApprovalFilters({ q: "", kind: "EVERYTHING", department: "" })).toEqual({ q: undefined, kind: undefined, department: undefined });
    expect(parseApprovalFilters({}).q).toBeUndefined();
    expect(parseApprovalFilters({ q: "x".repeat(200) }).q).toHaveLength(80);
  });
  it("say whether anything is filtered", () => {
    expect(approvalFiltered({})).toBe(false);
    expect(approvalFiltered({ department: "Stamping" })).toBe(true);
  });
  it("show everything with no filter", () => {
    for (const r of [matrix, pme, grade]) expect(approvalMatches(r, {})).toBe(true);
  });
  it("find every word of the search, in any field, ignoring case", () => {
    expect(approvalMatches(matrix, { q: "kai low" })).toBe(true);
    expect(approvalMatches(matrix, { q: "10235" })).toBe(true);
    expect(approvalMatches(matrix, { q: "ooi" })).toBe(true); // the evaluator
    expect(approvalMatches(pme, { q: "hydraulic" })).toBe(true); // the training
    expect(approvalMatches(grade, { q: "grade 3" })).toBe(true);
    expect(approvalMatches(matrix, { q: "low tan" })).toBe(false);
  });
  it("keep to the kind and the department asked for", () => {
    expect(approvalMatches(matrix, { kind: "SKILL" })).toBe(true);
    expect(approvalMatches(pme, { kind: "SKILL" })).toBe(false);
    expect(approvalMatches(grade, { department: "Stamping" })).toBe(true);
    expect(approvalMatches(pme, { department: "Stamping" })).toBe(false);
    expect(approvalMatches({ ...pme, department: null }, { department: "Stamping" })).toBe(false);
    expect(approvalMatches(matrix, { kind: "SKILL", department: "Stamping", q: "low" })).toBe(true);
  });
});

describe("a long Approvals table, a page at a time", () => {
  it("shows 50 rows a page", () => {
    expect(approvalPage(120, "1")).toEqual({ page: 1, pages: 3, start: 0, end: 50 });
    expect(approvalPage(120, "2")).toEqual({ page: 2, pages: 3, start: 50, end: 100 });
    expect(approvalPage(120, "3")).toEqual({ page: 3, pages: 3, start: 100, end: 120 });
  });
  it("has one page for 50 or fewer, and for none", () => {
    expect(approvalPage(50, undefined)).toEqual({ page: 1, pages: 1, start: 0, end: 50 });
    expect(approvalPage(0, undefined)).toEqual({ page: 1, pages: 1, start: 0, end: 0 });
  });
  it("shows the last page for one past the end, and the first for anything that isn't a page", () => {
    expect(approvalPage(120, "9").page).toBe(3);
    for (const asked of ["0", "-1", "two", "1.5", ""]) expect(approvalPage(120, asked).page).toBe(1);
  });
});
