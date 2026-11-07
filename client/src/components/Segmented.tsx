import type { ReactNode } from "react";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  /** Spoken name, needed when the label is only an icon. */
  aria?: string;
}

/** A segmented control: a few mutually exclusive choices side by side. */
export default function Segmented<T extends string>({ options, value, onChange, label, icons }: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  icons?: boolean;
}) {
  return (
    <div className={`segmented${icons ? " icons" : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} aria-label={o.aria} title={o.aria} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
