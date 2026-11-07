import type { ReactNode } from "react";
import Icon from "./Icon";

/** An inline message: error (red), notice (green: something worked), warn (orange) or info (grey). */
export default function Message({ kind, children }: { kind: "error" | "notice" | "warn" | "info"; children: ReactNode }) {
  const cls = kind === "warn" ? "warn-box" : kind === "info" ? "info-box" : kind;
  const icon = kind === "notice" ? "check" : kind === "info" ? "info" : "alert";
  return (
    <div className={cls} role={kind === "error" ? "alert" : "status"}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}
