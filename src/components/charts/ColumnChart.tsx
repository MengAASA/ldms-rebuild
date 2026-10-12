// A single-series column chart drawn in HTML: one hue, thin columns with a
// rounded data end, recessive gridlines, its value above every column, the
// full value on hover or keyboard focus, and the same numbers in a table for
// screen readers. Periods that haven't happened yet show as empty slots.

export type ColumnPoint = {
  /** Axis label, e.g. "Jan". */
  label: string;
  /** One-letter label for narrow screens, e.g. "J". */
  short: string;
  /** Full name for the tooltip and table, e.g. "January 2026". */
  title: string;
  value: number;
  /** A period still to come: no column, a muted label. */
  future?: boolean;
};

/** A round axis maximum just above the data: 1, 2, 2.5, 5 × 10^n. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= max) return step * pow;
  return 10 * pow;
}

export function ColumnChart({
  data,
  caption,
  format,
  axisFormat = format,
  labelFormat = format,
  color,
  height = 180,
}: {
  data: ColumnPoint[];
  /** What the chart shows, for screen readers and the table. */
  caption: string;
  format: (n: number) => string;
  /** A shorter form for the axis, when the full one doesn't fit beside it. */
  axisFormat?: (n: number) => string;
  /** A shorter form for the number above each column, when the full one is wider than a column. */
  labelFormat?: (n: number) => string;
  /** The columns' colour as a background class, e.g. "bg-cobalt". Left out, the accent. */
  color?: string;
  height?: number;
}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const top = niceMax(max);
  const ticks = [top, top / 2, 0];
  const peak = max > 0 ? data.findIndex((d) => d.value === max) : -1;

  return (
    <figure className="m-0">
      <div className="flex gap-2">
        {/* Y axis */}
        <div className="relative w-9 shrink-0 text-right text-[11px] text-ink-3" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / top) * 100}%` }}>
              {axisFormat(t)}
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
                const pct = (d.value / top) * 100;
                // The tooltip opens inward from the outer thirds, so with many narrow columns it never leaves the chart.
                const align = i < data.length / 3 ? "left-0" : i >= (data.length * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2";
                return (
                  <div
                    key={d.title}
                    tabIndex={d.future ? -1 : 0}
                    className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                  >
                    {!d.future && (
                      <>
                        {/* The column: at most 24px wide, rounded at the data end only. */}
                        <div
                          className={`w-[56%] max-w-6 rounded-t-[4px] ${color ? `${color} opacity-90 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100` : "bg-accent transition-colors group-hover:bg-accent-deep group-focus-visible:bg-accent-deep"}`}
                          style={{ height: d.value > 0 ? `max(${pct}%, 3px)` : 0 }}
                        />
                        {d.value > 0 && (
                          // Every column carries its number; the tallest in stronger ink. With many columns the others drop out on a phone, where they would run together.
                          <span
                            className={`num absolute text-[11px] whitespace-nowrap ${i === peak ? "font-semibold text-ink-2" : `font-medium text-ink-3 ${data.length > 12 ? "hidden sm:inline" : ""}`}`}
                            style={{ bottom: `calc(${pct}% + 4px)` }}
                          >
                            {labelFormat(d.value)}
                          </span>
                        )}
                        <span
                          role="tooltip"
                          className={`pointer-events-none absolute z-10 rounded-md bg-ink px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 shadow-[var(--shadow-float)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${align}`}
                          style={{ bottom: `calc(${pct}% + 22px)` }}
                        >
                          <strong className="num font-semibold">{format(d.value)}</strong> <span className="text-white/70">{d.title}</span>
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
                <span className="hidden sm:inline">{d.label}</span>
                <span className="sm:hidden">{d.short}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      {/* A table grows to fit its content whatever its width, so the wrapper is what is hidden. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {data
              .filter((d) => !d.future)
              .map((d) => (
                <tr key={d.title}>
                  <th scope="row">{d.title}</th>
                  <td>{format(d.value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
