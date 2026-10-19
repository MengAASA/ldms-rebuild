import { describe, expect, it } from "vitest";
import { parseSkillContent, skillContentProblems, type SkillContent } from "@/lib/forms/skill";
import type { SessionUser } from "@/server/permissions";
import {
  fillsInSkillMatrices,
  parseQuarter,
  quarterLabel,
  quarterMonths,
  quarterParam,
  seesSkillMatrices,
  skillActionBlock,
  skillEvaluatorDepartments,
  skillLevel,
  skillMatrixScores,
  skillOpenQuarter,
  skillQuarterBlock,
  skillQuarterCloses,
  skillStaffScope,
  skillStage,
  skillStartBlock,
  skillSubjectBlock,
  skillTopicKey,
  skillTopicScore,
  skillViewer,
  type SkillState,
  type SkillSubject,
  type SkillViewer,
} from "@/server/rules/skill";

/** "Today" as the services pass it: Malaysia time shifted into UTC, any hour of the day. */
const today = (iso: string) => new Date(`${iso}T15:30:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const Q2 = { year: 2026, quarter: 2 };
const Q3 = { year: 2026, quarter: 3 };
const Q4 = { year: 2026, quarter: 4 };
const NOW = today("2026-10-06"); // Q3 2026 is open

describe("the open quarter", () => {
  it("is the one that has just ended", () => {
    expect(skillOpenQuarter(today("2026-10-06"))).toEqual(Q3);
    expect(skillOpenQuarter(today("2026-12-31"))).toEqual(Q3);
    expect(skillOpenQuarter(today("2027-01-01"))).toEqual(Q4);
  });
  it("changes on the first day of each quarter", () => {
    expect(skillOpenQuarter(today("2026-03-31"))).toEqual({ year: 2025, quarter: 4 });
    expect(skillOpenQuarter(today("2026-04-01"))).toEqual({ year: 2026, quarter: 1 });
    expect(skillOpenQuarter(today("2026-06-30"))).toEqual({ year: 2026, quarter: 1 });
    expect(skillOpenQuarter(today("2026-07-01"))).toEqual(Q2);
    expect(skillOpenQuarter(today("2026-09-30"))).toEqual(Q2);
    expect(skillOpenQuarter(today("2026-10-01"))).toEqual(Q3);
  });
  it("closes on the last day of the quarter after it", () => {
    expect(iso(skillQuarterCloses(Q3))).toBe("2026-12-31");
    expect(iso(skillQuarterCloses(Q4))).toBe("2027-03-31");
    expect(iso(skillQuarterCloses({ year: 2026, quarter: 1 }))).toBe("2026-06-30");
  });
  it("is the only quarter that can be changed", () => {
    expect(skillQuarterBlock(Q3, NOW)).toBeNull();
    expect(skillQuarterBlock(Q2, NOW)).toMatch(/Q2 2026 closed on 30 Sep 2026.*Duplicate one to carry it into Q3 2026/);
    expect(skillQuarterBlock(Q4, NOW)).toMatch(/Q4 2026 hasn't ended yet.*from 01 Jan 2027/);
    // The day the next quarter opens, the earlier one is closed.
    expect(skillQuarterBlock(Q3, today("2027-01-01"))).toMatch(/Q3 2026 closed on 31 Dec 2026/);
  });
  it("reads and writes quarters for the URL", () => {
    expect(parseQuarter("2026-3")).toEqual(Q3);
    expect(parseQuarter(quarterParam(Q4))).toEqual(Q4);
    for (const bad of ["2026-5", "2026-0", "26-3", "2026", "", undefined]) expect(parseQuarter(bad)).toBeNull();
    expect(quarterLabel(Q3)).toBe("Q3 2026");
    expect(quarterMonths(Q3)).toBe("Jul to Sep 2026");
    expect(quarterMonths({ year: 2026, quarter: 1 })).toBe("Jan to Mar 2026");
  });
});

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 1,
  staffNo: "10001",
  name: "Someone",
  departmentId: 5,
  departmentName: "Stamping",
  divisionId: 1,
  designation: "NON_EXECUTIVE",
  roles: [],
  hodOfDepartmentIds: [],
  headOfDivisionIds: [],
  mustChangePassword: false,
  ...over,
});
const operator = (over: Partial<SkillSubject> = {}): SkillSubject => ({
  id: 50,
  name: "Aung",
  status: "ACTIVE",
  designation: "CONTRACT",
  departmentId: 5,
  ...over,
});

describe("who fills in skill matrices", () => {
  it("is a manager, the main clerk or a named evaluator, for their own department", () => {
    expect(skillEvaluatorDepartments(user({ designation: "MANAGER" }))).toEqual([5]);
    expect(skillEvaluatorDepartments(user({ roles: ["MAIN_CLERK"] }))).toEqual([5]);
    expect(skillEvaluatorDepartments(user({ roles: ["SKILL_EVALUATOR"], designation: "CONTRACT" }))).toEqual([5]);
  });
  it("is L&D, for every department", () => {
    expect(skillEvaluatorDepartments(user({ roles: ["LD_ADMIN"] }))).toBe("ALL");
  });
  it("is not a clerk, an executive or plain staff", () => {
    for (const u of [user({ roles: ["CLERK"] }), user({ designation: "EXECUTIVE" }), user()]) {
      expect(skillEvaluatorDepartments(u)).toEqual([]);
      expect(fillsInSkillMatrices(u)).toBe(false);
      expect(seesSkillMatrices(u)).toBe(false);
      expect(skillStaffScope(u)).toBeNull();
    }
  });
  it("is not the department's HOD, who approves instead, even with the evaluator role", () => {
    const hod = user({ designation: "MANAGER", roles: ["SKILL_EVALUATOR"], hodOfDepartmentIds: [5] });
    expect(skillEvaluatorDepartments(hod)).toEqual([]);
    expect(skillViewer(hod, operator())).toEqual({ canEvaluate: false, isApprover: true });
    expect(skillStaffScope(hod)).toEqual({ OR: [{ departmentId: { in: [5] } }] });
  });
  it("still lets a manager who heads another department fill in for their own", () => {
    const m = user({ designation: "MANAGER", hodOfDepartmentIds: [9] });
    expect(skillEvaluatorDepartments(m)).toEqual([5]);
    expect(skillViewer(m, operator())).toEqual({ canEvaluate: true, isApprover: false });
    expect(skillViewer(m, operator({ departmentId: 9 }))).toEqual({ canEvaluate: false, isApprover: true });
  });
  it("covers only their own department, and never themselves", () => {
    const evaluator = user({ id: 7, roles: ["SKILL_EVALUATOR"], designation: "CONTRACT" });
    expect(skillViewer(evaluator, operator()).canEvaluate).toBe(true);
    expect(skillViewer(evaluator, operator({ departmentId: 6 })).canEvaluate).toBe(false);
    expect(skillViewer(evaluator, operator({ id: 7 })).canEvaluate).toBe(false);
  });
  it("lets a division head look, without filling in or approving", () => {
    const head = user({ designation: "MANAGER", departmentId: 5, headOfDivisionIds: [2] });
    expect(skillStaffScope(head)).toEqual({ OR: [{ departmentId: { in: [5] } }, { department: { divisionId: { in: [2] } } }] });
    expect(skillViewer(head, operator({ departmentId: 8 }))).toEqual({ canEvaluate: false, isApprover: false });
  });
});

describe("who gets a skill matrix", () => {
  it("is active non-executive and contract staff", () => {
    expect(skillSubjectBlock(operator())).toBeNull();
    expect(skillSubjectBlock(operator({ designation: "NON_EXECUTIVE" }))).toBeNull();
    for (const designation of ["EXECUTIVE", "MANAGER", "TRAINEE"] as const)
      expect(skillSubjectBlock(operator({ designation }))).toMatch(/non-executive and contract staff/);
    expect(skillSubjectBlock(operator({ status: "RESIGNED" }))).toMatch(/resigned/);
  });
  const can: SkillViewer = { canEvaluate: true, isApprover: false };
  it("is one per person per quarter, in the open quarter only", () => {
    expect(skillStartBlock(operator(), can, false, Q3, NOW)).toBeNull();
    expect(skillStartBlock(operator(), can, true, Q3, NOW)).toMatch(/already has a matrix for Q3 2026/);
    expect(skillStartBlock(operator(), can, false, Q2, NOW)).toMatch(/Q2 2026 closed/);
    expect(skillStartBlock(operator(), can, false, Q4, NOW)).toMatch(/hasn't ended yet/);
    expect(skillStartBlock(operator(), { canEvaluate: false, isApprover: true }, false, Q3, NOW)).toMatch(/You don't fill in skill matrices for Aung/);
    expect(skillStartBlock(operator({ designation: "EXECUTIVE" }), can, false, Q3, NOW)).toMatch(/non-executive and contract/);
  });
});

describe("skillActionBlock", () => {
  const m = (status: SkillState["status"], q = Q3): SkillState => ({ ...q, status, staff: { name: "Aung" } });
  const evaluator: SkillViewer = { canEvaluate: true, isApprover: false };
  const hod: SkillViewer = { canEvaluate: false, isApprover: true };
  const onlooker: SkillViewer = { canEvaluate: false, isApprover: false };

  it("lets the evaluator edit, submit and delete a draft in the open quarter", () => {
    for (const action of ["EDIT", "SUBMIT", "DELETE"] as const) {
      expect(skillActionBlock(action, m("DRAFT"), evaluator, NOW)).toBeNull();
      expect(skillActionBlock(action, m("DRAFT"), hod, NOW)).toMatch(/You don't fill in skill matrices for Aung/);
      expect(skillActionBlock(action, m("DRAFT"), onlooker, NOW)).toMatch(/You don't fill in/);
    }
  });
  it("locks it for the evaluator once it is with the HOD, and for good once approved", () => {
    expect(skillActionBlock("EDIT", m("SUBMITTED"), evaluator, NOW)).toMatch(/changed only if they send it back/);
    expect(skillActionBlock("DELETE", m("SUBMITTED"), evaluator, NOW)).toMatch(/stays on record/);
    for (const action of ["EDIT", "SUBMIT", "DELETE"] as const) expect(skillActionBlock(action, m("APPROVED"), evaluator, NOW)).toMatch(/approved this matrix/);
  });
  it("lets the HOD approve or send back a submitted matrix", () => {
    expect(skillActionBlock("APPROVE", m("SUBMITTED"), hod, NOW)).toBeNull();
    expect(skillActionBlock("SEND_BACK", m("SUBMITTED"), hod, NOW)).toBeNull();
    expect(skillActionBlock("APPROVE", m("SUBMITTED"), evaluator, NOW)).toMatch(/Only Aung's HOD can approve/);
    expect(skillActionBlock("SEND_BACK", m("SUBMITTED"), evaluator, NOW)).toMatch(/Only Aung's HOD/);
    expect(skillActionBlock("APPROVE", m("DRAFT"), hod, NOW)).toMatch(/hasn't been sent for approval/);
    expect(skillActionBlock("APPROVE", m("APPROVED"), hod, NOW)).toMatch(/already approved/);
    expect(skillActionBlock("SEND_BACK", m("APPROVED"), hod, NOW)).toMatch(/already approved/);
  });
  it("refuses an edit, a submit and a delete in a closed quarter", () => {
    for (const action of ["EDIT", "SUBMIT", "DELETE"] as const)
      expect(skillActionBlock(action, m("DRAFT", Q2), evaluator, NOW)).toMatch(/Q2 2026 closed on 30 Sep 2026/);
  });
  it("keeps a closed quarter's submitted matrix with the HOD: approve yes, send back no", () => {
    expect(skillActionBlock("APPROVE", m("SUBMITTED", Q2), hod, NOW)).toBeNull();
    expect(skillActionBlock("SEND_BACK", m("SUBMITTED", Q2), hod, NOW)).toMatch(/can no longer change this matrix. You can still approve it/);
    // The same matrix, the day its quarter closes.
    expect(skillActionBlock("SEND_BACK", m("SUBMITTED"), hod, today("2026-12-31"))).toBeNull();
    expect(skillActionBlock("SEND_BACK", m("SUBMITTED"), hod, today("2027-01-01"))).toMatch(/Q3 2026 closed on 31 Dec 2026/);
    expect(skillActionBlock("APPROVE", m("SUBMITTED"), hod, today("2027-06-01"))).toBeNull();
  });
});

describe("skillStage", () => {
  it("tells a draft the HOD sent back from one never sent", () => {
    expect(skillStage(null)).toBe("NOT_STARTED");
    expect(skillStage({ status: "DRAFT", returnReason: null })).toBe("DRAFT");
    expect(skillStage({ status: "DRAFT", returnReason: "Add welding" })).toBe("RETURNED");
    expect(skillStage({ status: "SUBMITTED", returnReason: null })).toBe("SUBMITTED");
    expect(skillStage({ status: "APPROVED", returnReason: null })).toBe("APPROVED");
  });
});

describe("scores and levels", () => {
  const rated = (...ratings: (number | null)[]) => ratings.map((rating) => ({ rating }));
  it("scores a topic as its ratings over the most they could be", () => {
    expect(skillTopicScore(rated(5, 5))).toBe(100);
    expect(skillTopicScore(rated(3))).toBe(60);
    expect(skillTopicScore(rated(4, 3, 5))).toBe(80);
    expect(skillTopicScore(rated(1, 2))).toBe(30);
    expect(skillTopicScore(rated(1))).toBe(20);
  });
  it("leaves unrated lines out, and has no score with nothing rated", () => {
    expect(skillTopicScore(rated(4, null))).toBe(80);
    expect(skillTopicScore(rated(null))).toBeNull();
    expect(skillTopicScore([])).toBeNull();
  });
  it("matches a topic on the chart by section and name, whatever its case and spacing", () => {
    expect(skillTopicKey("SKILL", "  Press   Operation ")).toBe(skillTopicKey("SKILL", "press operation"));
    expect(skillTopicKey("SKILL", "Press operation")).not.toBe(skillTopicKey("ABILITY", "Press operation"));
  });
  it("pools the lines of a topic named twice in one matrix, as the old chart did", () => {
    const scores = skillMatrixScores([
      { section: "SKILL", name: "Press operation", items: rated(5, 5) },
      { section: "SKILL", name: "press operation", items: rated(1, 2, 2) },
      { section: "ABILITY", name: "Press operation", items: rated(3) },
      { section: "KNOWLEDGE", name: "Not rated yet", items: rated(null) },
    ]);
    expect(scores.get(skillTopicKey("SKILL", "Press operation"))).toBe(60); // 15 of 25, not the 100 and 33 of each part
    expect(scores.get(skillTopicKey("ABILITY", "Press operation"))).toBe(60);
    expect(scores.size).toBe(2);
  });
  it("puts a score in one of five levels", () => {
    expect(skillLevel(100)).toBe(100);
    expect(skillLevel(99)).toBe(75);
    expect(skillLevel(75)).toBe(75);
    expect(skillLevel(74)).toBe(50);
    expect(skillLevel(50)).toBe(50);
    expect(skillLevel(49)).toBe(25);
    expect(skillLevel(25)).toBe(25);
    expect(skillLevel(24)).toBe(0);
    expect(skillLevel(20)).toBe(0);
  });
});

// ---------- The form ----------

const line = (text: string, rating: number | null = 3) => ({ text, rating });
const complete: SkillContent = [
  { section: "KNOWLEDGE", name: "Die setting", items: [line("Knows the die change steps", 4)] },
  { section: "SKILL", name: "Press operation", items: [line("Runs the 200T press", 5), line("Clears a misfeed", 3)] },
  { section: "ABILITY", name: "Teamwork", items: [line("Hands over cleanly", 4)] },
];
const messages = (content: SkillContent, mode: "draft" | "submit") => skillContentProblems(content, mode).map((p) => p.message);

describe("the skill matrix form", () => {
  it("accepts a complete matrix", () => {
    expect(skillContentProblems(complete, "submit")).toEqual([]);
    expect(skillContentProblems(complete, "draft")).toEqual([]);
  });
  it("needs a topic in every section to submit, but not for a draft", () => {
    const noAbility = complete.slice(0, 2);
    expect(skillContentProblems(noAbility, "draft")).toEqual([]);
    expect(skillContentProblems(noAbility, "submit")).toEqual([{ at: { section: "ABILITY" }, message: "Add at least one ability topic." }]);
  });
  it("needs a line in every topic and a rating on every line to submit", () => {
    const draft: SkillContent = [
      { section: "KNOWLEDGE", name: "Die setting", items: [] },
      { ...complete[1], items: [line("Runs the press", null)] },
      complete[2],
    ];
    expect(skillContentProblems(draft, "draft")).toEqual([]);
    expect(skillContentProblems(draft, "submit")).toEqual([
      { at: { topic: 0 }, message: "Add at least one line to this topic." },
      { at: { topic: 1 }, message: "Rate every line." },
    ]);
  });
  it("needs every topic to have a name, even in a draft", () => {
    const unnamed: SkillContent = [{ section: "SKILL", name: "", items: [line("Runs the press")] }];
    expect(skillContentProblems(unnamed, "draft")).toEqual([{ at: { topic: 0 }, message: "Give this topic a name." }]);
  });
  it("refuses a rating with nothing written, and an empty matrix", () => {
    expect(messages([{ section: "SKILL", name: "Press", items: [line("", 4)] }], "draft")).toEqual(["A line has a rating but nothing written."]);
    expect(messages([], "draft")).toEqual(["Add at least one topic before saving."]);
  });
  it("holds at most five lines in a topic and twenty topics in a section", () => {
    const six = Array.from({ length: 6 }, (_, i) => line(`Line ${i + 1}`));
    expect(messages([{ section: "SKILL", name: "Press", items: six }], "draft")).toEqual(["At most 5 lines in a topic."]);
    const many: SkillContent = Array.from({ length: 21 }, (_, i) => ({ section: "SKILL" as const, name: `Topic ${i + 1}`, items: [line("x")] }));
    expect(messages(many, "draft")).toEqual(["At most 20 topics in a section."]);
  });
  it("tidies what the form sends: trims, drops blanks, puts sections in order", () => {
    const json = JSON.stringify([
      {
        section: "ABILITY",
        name: " Teamwork ",
        items: [
          { text: " Hands over cleanly ", rating: 4 },
          { text: "  ", rating: null },
        ],
      },
      { section: "KNOWLEDGE", name: "", items: [{ text: "", rating: null }] },
      { section: "KNOWLEDGE", name: "Die setting", items: [] },
    ]);
    expect(parseSkillContent(json)).toEqual([
      { section: "KNOWLEDGE", name: "Die setting", items: [] },
      { section: "ABILITY", name: "Teamwork", items: [{ text: "Hands over cleanly", rating: 4 }] },
    ]);
  });
  it("refuses anything that isn't the form's shape", () => {
    for (const bad of [
      "",
      "{}",
      "[1]",
      '[{"section":"OTHER","name":"x","items":[]}]',
      '[{"section":"SKILL","name":"x","items":[{"text":"a","rating":6}]}]',
      '[{"section":"SKILL","name":"x","items":[{"text":"a","rating":2.5}]}]',
    ])
      expect(parseSkillContent(bad)).toBeNull();
  });
});
