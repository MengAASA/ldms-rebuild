// Columns split into series (e.g. hours by training type), drawn in HTML like
// ColumnChart: thin columns, recessive gridlines, the tallest labelled, every
// value on hover or keyboard focus, a legend, and the same numbers in a table
// for screen readers. Periods that haven't happened yet show as empty slots.

import { niceMax } from "./ColumnChart";

export type StackSeries = {
  label: string;
  /** The segment's colour, as a background class, e.g. "bg-accent". */
  color: string;
};

export type StackPoint = {
  /** Axis label, e.g. "Jan". */
  label: string;
  /** One-letter label for narrow screens and long periods, e.g. "J". */
  short: string;
  /** Full name for the tooltip and table, e.g. "January 2026". */
  title: string;
  /** One value per series, in the series' order. */
  values: number[];
  /** Shown under the first column of each group when the chart covers several (e.g. the year). */
  group?: string;
  /** A period still to come: no column, a muted label. */
  future?: boolean;
};

const sum = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100;

export function StackedColumnChart({
  series,
  data,
  caption,
  format,
  height = 220,
  whole = false,
}: {
  series: StackSeries[];
  data: StackPoint[];
  /** What the chart shows, for screen readers and the table. */
  caption: string;
  format: (n: number) => string;
  height?: number;
  /** The values are counts: the axis stops at whole numbers (4, 2, 0), never 2.5. */
  whole?: boolean;
}) {
  const totals = data.map((d) => sum(d.values));
  const max = Math.max(0, ...totals);
  const nice = niceMax(max);
  // For counts, the top and its half must both be whole: the next even number up.
  const top = whole && (nice % 2 !== 0 || !Number.isInteger(nice)) ? Math.max(2, Math.ceil(nice / 2) * 2) : nice;
  const ticks = [top, top / 2, 0];
  const peak = max > 0 ? totals.indexOf(max) : -1;
  // More than a year of months: one letter each, or the labels run together.
  const crowded = data.length > 12;
  const groups = new Set(data.map((d) => d.group)).size > 1;

  return (
    <figure className="m-0">
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-2" aria-hidden>
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-[3px] ${s.color}`} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {/* Y axis */}
        <div className="relative w-10 shrink-0 text-right text-[11px] text-ink-3" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(1 - t / top) * 100}%` }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height }} aria-hidden>
            {ticks.map((t) => (
              <div
                key={t}
                className={`absolute inset-x-0 border-t ${t === 0 ? "border-rule-strong" : "border-rule"}`}
                style={{ top: `${(1 - t / top) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end">
              {data.map((d, i) => {
                const pct = (totals[i] / top) * 100;
                // The tooltip is wide: it opens inward from the outer thirds, so it never leaves the chart.
                const align = i < data.length / 3 ? "left-0" : i >= (data.length * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2";
                // The topmost segment with a value carries the rounded end.
                const last = d.values.findLastIndex((v) => v > 0);
                return (
                  <div
                    key={d.title}
                    tabIndex={d.future ? -1 : 0}
                    className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                  >
                    {!d.future && (
                      <>
                        <div
                          className="flex w-[56%] max-w-7 flex-col-reverse gap-px opacity-90 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                          style={{ height: totals[i] > 0 ? `max(${pct}%, 3px)` : 0 }}
                        >
                          {d.values.map((v, s) =>
                            v > 0 ? (
                              <div
                                key={series[s].label}
                                className={`${series[s].color} ${s === last ? "rounded-t-[4px]" : ""}`}
                                style={{ flexGrow: (v / totals[i]) * 100, flexBasis: 0, minHeight: 2 }}
                              />
                            ) : null,
                          )}
                        </div>
                        {totals[i] > 0 && (
                          // Every column carries its number; the tallest in stronger ink. With many columns the others drop out on a phone, where they would run together.
                          <span
                            className={`num absolute text-[11px] whitespace-nowrap ${i === peak ? "font-semibold text-ink-2" : `font-medium text-ink-3 ${data.length > 12 ? "hidden sm:inline" : ""}`}`}
                            style={{ bottom: `calc(${pct}% + 4px)` }}
                          >
                            {format(totals[i])}
                          </span>
                        )}
                        <span
                          role="tooltip"
                          className={`pointer-events-none absolute z-10 rounded-md bg-ink px-2.5 py-2 text-xs whitespace-nowrap text-white opacity-0 shadow-[var(--shadow-float)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${align}`}
                          style={{ bottom: `min(calc(${pct}% + 22px), calc(100% - 96px))` }}
                        >
                          <span className="block text-white/70">{d.title}</span>
                          {series.map((s, si) => (
                            <span key={s.label} className="mt-1 flex items-center justify-between gap-4">
                              <span className="flex items-center gap-1.5">
                                <span className={`size-2 rounded-[2px] ${s.color}`} />
                                {s.label}
                              </span>
                              <span className="num">{format(d.values[si])}</span>
                            </span>
                          ))}
                          <span className="mt-1 flex justify-between gap-4 border-t border-white/20 pt-1 font-semibold">
                            <span>Total</span>
                            <span className="num">{format(totals[i])}</span>
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* X axis */}
          <div className="mt-2 flex text-[11px] text-ink-3" aria-hidden>
            {data.map((d) => (
              <span key={d.title} className={`flex-1 text-center ${d.future ? "text-ink-3/50" : ""}`}>
                {crowded ? (
                  d.short
                ) : (
                  <>
                    <span className="hidden sm:inline">{d.label}</span>
                    <span className="sm:hidden">{d.short}</span>
                  </>
                )}
              </span>
            ))}
          </div>
          {groups && (
            <div className="mt-0.5 flex text-[11px] font-medium text-ink-2" aria-hidden>
              {data.map((d, i) => (
                <span key={d.title} className="num w-0 flex-1 whitespace-nowrap">
                  {i === 0 || data[i - 1].group !== d.group ? d.group : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* A table grows to fit its content whatever its width, so the wrapper is what is hidden. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              {series.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) =>
              d.future ? null : (
                <tr key={d.title}>
                  <th scope="row">{d.title}</th>
                  {d.values.map((v, s) => (
                    <td key={series[s].label}>{format(v)}</td>
                  ))}
                  <td>{format(totals[i])}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
