import type { ReactNode } from "react";

/** Large title on the left, the view's actions (toolbar) on the right. */
export default function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </div>
  );
}
