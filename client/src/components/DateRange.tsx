import { fyLabel, fyStartOf, todayISO } from "../money";

export interface Range {
  from: string;
  to: string;
}

type Preset = "this-fy" | "last-fy" | "this-month" | "last-month" | "custom";

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/** The date range a preset stands for, as of today. */
export function presetRange(p: Exclude<Preset, "custom">): Range {
  const today = todayISO();
  const fy = fyStartOf(today)!;
  const [y, m] = today.split("-").map(Number);
  switch (p) {
    case "this-fy":
      return { from: `${fy}-04-01`, to: today };
    case "last-fy":
      return { from: `${fy - 1}-04-01`, to: `${fy}-03-31` };
    case "this-month":
      return { from: `${y}-${pad(m)}-01`, to: today };
    case "last-month": {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDay(ly, lm))}` };
    }
  }
}

function presetOf(r: Range): Preset {
  for (const p of ["this-fy", "last-fy", "this-month", "last-month"] as const) {
    const x = presetRange(p);
    if (x.from === r.from && x.to === r.to) return p;
  }
  return "custom";
}

/** A period picker: quick choices (this or last financial year or month) plus exact From and To dates. */
export default function DateRange({ value, onChange, idPrefix = "range" }: { value: Range; onChange: (r: Range) => void; idPrefix?: string }) {
  const fy = fyStartOf(todayISO())!;
  const preset = presetOf(value);
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))" }}>
      <div className="field">
        <label htmlFor={`${idPrefix}-preset`}>Period</label>
        <select id={`${idPrefix}-preset`} value={preset} onChange={(e) => e.target.value !== "custom" && onChange(presetRange(e.target.value as Exclude<Preset, "custom">))}>
          <option value="this-fy">This financial year ({fyLabel(fy)})</option>
          <option value="last-fy">Last financial year ({fyLabel(fy - 1)})</option>
          <option value="this-month">This month</option>
          <option value="last-month">Last month</option>
          <option value="custom">Custom dates</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-from`}>From</label>
        <input id={`${idPrefix}-from`} type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-to`}>To</label>
        <input id={`${idPrefix}-to`} type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
      </div>
    </div>
  );
}
