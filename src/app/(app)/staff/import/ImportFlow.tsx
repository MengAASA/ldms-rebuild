"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Status } from "@/components/ui/Status";
import type { ImportPreview, ImportRow } from "@/server/services/staffImport";
import { commitImportAction, previewImportAction } from "./actions";
import { withBasePath } from "@/lib/base-path";

type Step = { kind: "choose" } | { kind: "preview"; preview: ImportPreview } | { kind: "done"; created: number; updated: number; skipped: number };

const STEPS = ["Choose file", "Check rows", "Import"];

export function ImportFlow({ contractOnly }: { contractOnly: boolean }) {
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [skipErrors, setSkipErrors] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const current = step.kind === "choose" ? 0 : step.kind === "preview" ? 1 : 2;

  function check() {
    if (!file) return setError("Choose an Excel file first.");
    const fd = new FormData();
    fd.set("file", file);
    setError(null);
    start(async () => {
      const r = await previewImportAction(fd);
      if (r.ok) {
        setStep({ kind: "preview", preview: r.data });
        setOnlyErrors(r.data.counts.error > 0);
        setSkipErrors(false);
      } else setError(r.message);
    });
  }

  function commit() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    if (skipErrors) fd.set("skipErrors", "on");
    setError(null);
    start(async () => {
      const r = await commitImportAction(fd);
      if (r.ok) setStep({ kind: "done", ...r.data });
      else setError(r.message);
    });
  }

  function restart() {
    setStep({ kind: "choose" });
    setFile(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]" aria-label="Import steps">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === current ? "step" : undefined} className={i === current ? "font-medium text-ink" : i < current ? "text-ink-2" : "text-ink-3"}>
            <span className="num mr-1.5">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error && (
        <div role="alert" className="notice notice-bad">
          {error}
        </div>
      )}

      {step.kind === "choose" && (
        <div className="flex max-w-[640px] flex-col gap-4">
          <div className="rounded-md border border-dashed border-rule-strong bg-surface p-5">
            <label htmlFor="file" className="label">
              Excel file (.xlsx)
            </label>
            <input
              ref={input}
              id="file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-[13px] file:mr-3 file:h-8 file:cursor-pointer file:rounded file:border file:border-rule-strong file:bg-surface file:px-3 file:text-[13px] file:font-medium hover:file:bg-sunken"
            />
            <p className="hint mt-2">
              First sheet, headings in row 1: Staff No, Name, Email, Position, Designation, Department, Section, Date Joined, Job Grade, Fills Own TNA, Gender, Plant.{" "}
              <a href={withBasePath("/staff/import/template")} className="link" download>
                Download the template
              </a>
              , which also lists every department and section.
            </p>
          </div>
          <ul className="list-disc pl-5 text-[13px] text-ink-2">
            <li>A staff no. that already exists updates that record. New staff no.s are added.</li>
            <li>Nothing is saved until you have checked the rows and confirmed.</li>
            {contractOnly && <li>You can import contract staff only. Other designations are rejected.</li>}
          </ul>
          <div>
            <button type="button" className="btn btn-primary" onClick={check} disabled={pending || !file}>
              {pending ? "Checking…" : "Check file"}
            </button>
          </div>
        </div>
      )}

      {step.kind === "preview" && (
        <Preview
          preview={step.preview}
          onlyErrors={onlyErrors}
          setOnlyErrors={setOnlyErrors}
          skipErrors={skipErrors}
          setSkipErrors={setSkipErrors}
          pending={pending}
          onCommit={commit}
          onRestart={restart}
        />
      )}

      {step.kind === "done" && (
        <div className="flex max-w-[640px] flex-col gap-4">
          <div role="status" className="notice notice-ok">
            Import finished: {step.created} added, {step.updated} updated{step.skipped ? `, ${step.skipped} rows with errors skipped` : ""}.
          </div>
          <div className="flex gap-2">
            <Link href="/staff?sort=staffNo" className="btn btn-primary">
              View staff list
            </Link>
            <button type="button" className="btn" onClick={restart}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Preview({
  preview,
  onlyErrors,
  setOnlyErrors,
  skipErrors,
  setSkipErrors,
  pending,
  onCommit,
  onRestart,
}: {
  preview: ImportPreview;
  onlyErrors: boolean;
  setOnlyErrors: (v: boolean) => void;
  skipErrors: boolean;
  setSkipErrors: (v: boolean) => void;
  pending: boolean;
  onCommit: () => void;
  onRestart: () => void;
}) {
  const { counts } = preview;
  const toSave = counts.create + counts.update;
  const rows = onlyErrors ? preview.rows.filter((r) => r.action === "error") : preview.rows;
  const blocked = counts.error > 0 && !skipErrors;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
        <span className="font-medium">{preview.fileName}</span>
        <span className="num">{preview.rows.length} rows</span>
        <span>
          <span className="num">{counts.create}</span> new
        </span>
        <span>
          <span className="num">{counts.update}</span> to update
        </span>
        <span className="text-ink-3">
          <span className="num">{counts.unchanged}</span> unchanged
        </span>
        <span className={counts.error ? "text-bad" : "text-ink-3"}>
          <span className="num">{counts.error}</span> with errors
        </span>
      </div>

      {counts.error > 0 && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} className="accent-primary" />
          Show only rows with errors
        </label>
      )}

      <div className="max-h-[calc(60vh/var(--app-zoom))] overflow-auto rounded-md border border-rule bg-surface">
        <table className="table">
          <thead>
            <tr>
              <th className="w-px text-right whitespace-nowrap">No.</th>
              <th className="w-px whitespace-nowrap" title="The row in your Excel file">Excel row</th>
              <th className="w-28">Staff no.</th>
              <th>Name</th>
              <th className="hidden md:table-cell">Department</th>
              <th className="w-[38%]">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.row}>
                <td className="num muted text-right">{i + 1}</td>
                <td className="num muted">{r.row}</td>
                <td className="num">{r.staffNo}</td>
                <td>{r.name}</td>
                <td className="hidden md:table-cell">{r.department}</td>
                <td>
                  <RowResult row={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 border-t border-rule pt-4">
        {counts.error > 0 && (
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} className="mt-0.5 accent-primary" />
            <span>
              Skip the {counts.error} {counts.error === 1 ? "row" : "rows"} with errors and import the rest
              <span className="block text-xs text-ink-3">Or fix them in Excel, save, and choose the file again.</span>
            </span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={onCommit} disabled={pending || blocked || toSave === 0}>
            {pending ? "Importing…" : toSave === 0 ? "Nothing to import" : `Import ${toSave} ${toSave === 1 ? "row" : "rows"}`}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onRestart} disabled={pending}>
            Choose a different file
          </button>
        </div>
      </div>
    </div>
  );
}

function RowResult({ row }: { row: ImportRow }) {
  switch (row.action) {
    case "create":
      return <Status tone="ok">New</Status>;
    case "unchanged":
      return <span className="text-ink-3">No change</span>;
    case "update":
      return <span>Update: {row.changes.join(", ")}</span>;
    case "error":
      return (
        <div>
          <Status tone="bad">Error</Status>
          <ul className="mt-0.5 text-xs text-bad">
            {row.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      );
  }
}
