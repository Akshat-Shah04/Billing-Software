import { formatDate } from "../money";
import type { Settlement } from "../types";

type Tone = "ok" | "warn" | "danger" | "info" | "neutral";

/** A bill's state in words. The badge adds a shape too, so it never depends on colour alone. */
export function statusOf(b: Settlement): { text: string; tone: Tone } {
  if (b.state === "cancelled") return { text: "Cancelled", tone: "neutral" };
  if (b.state === "paid") return { text: "Paid", tone: "ok" };
  if (b.state === "credited") return { text: "Credited", tone: "ok" };
  if (b.state === "written_off") return { text: "Written off", tone: "neutral" };
  if (b.overdue) return { text: "Overdue", tone: "danger" };
  if (b.part_paid) return { text: "Part paid", tone: "warn" };
  return { text: "Unpaid", tone: "info" };
}

export default function StatusBadge({ bill }: { bill: Settlement & { due_date?: string | null } }) {
  const s = statusOf(bill);
  const title = s.text === "Overdue" && bill.due_date ? `Was due on ${formatDate(bill.due_date)}` : undefined;
  return (
    <span className={`badge ${s.tone}`} title={title}>
      {s.text}
    </span>
  );
}
