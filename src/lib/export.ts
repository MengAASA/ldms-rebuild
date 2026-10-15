import { plural } from "./format";

// How many rows one Excel export may hold. Above it the file takes too long
// and too much of the server's memory to build, so the export is refused with
// the reason rather than cut short: a short export would look complete.

export const EXPORT_ROW_LIMIT = 150_000;

/** Why an export of this many rows can't be made, or null when it can. */
export function exportBlock(rows: number): string | null {
  return rows > EXPORT_ROW_LIMIT
    ? `That is ${plural(rows, "row")}, more than one export can hold (${EXPORT_ROW_LIMIT.toLocaleString("en-MY")}). Choose a shorter period or narrow the filters.`
    : null;
}
