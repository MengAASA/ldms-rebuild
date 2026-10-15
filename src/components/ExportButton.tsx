import { FileDown } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { exportBlock } from "@/lib/export";

/**
 * "Export to Excel" for a list as filtered. Given how many rows the export
 * would hold, it turns itself off with the reason when that is more than one
 * file can take (EXPORT_ROW_LIMIT).
 */
export function ExportButton({ href, rows }: { href: string; rows?: number }) {
  const block = rows === undefined ? null : exportBlock(rows);
  if (block)
    return (
      <span className="btn" aria-disabled="true" title={block}>
        <FileDown size={15} aria-hidden /> Too many rows to export
      </span>
    );
  return (
    <a href={withBasePath(href)} className="btn">
      <FileDown size={15} aria-hidden /> Export to Excel
    </a>
  );
}
