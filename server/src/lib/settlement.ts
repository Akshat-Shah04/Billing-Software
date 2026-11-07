import { todayISO } from "./fy.js";

/**
 * How much of a bill is still owed. Everything is integer paise.
 *
 *   balance = total - credit notes - payments - discounts (voided payments and discounts do not count)
 *
 * A discount is recorded only when a client pays less and the firm agrees to settle; the bill itself keeps its
 * full amount. A cancelled bill owes nothing.
 */
export type BillState = "open" | "paid" | "credited" | "written_off" | "cancelled";

export interface Settlement {
  paid_paise: number;
  credited_paise: number;
  /** Given up when the client paid less by agreement (haggling). */
  discount_paise: number;
  balance_paise: number;
  /**
   * open = still owes money; paid = settled with at least one payment (perhaps with a discount);
   * credited = settled by credit notes; written_off = settled by a discount alone; cancelled
   */
  state: BillState;
  part_paid: boolean;
  overdue: boolean;
}

export function settle(
  bill: { total_paise: number; status: string; due_date: string | null },
  paid_paise: number,
  credited_paise: number,
  discount_paise = 0,
  today: string = todayISO(),
): Settlement {
  const cancelled = bill.status === "cancelled";
  const balance = cancelled ? 0 : bill.total_paise - credited_paise - paid_paise - discount_paise;
  const state: BillState = cancelled
    ? "cancelled"
    : balance > 0
      ? "open"
      : paid_paise > 0
        ? "paid"
        : credited_paise > 0
          ? "credited"
          : discount_paise > 0
            ? "written_off"
            : "paid";
  return {
    paid_paise,
    credited_paise,
    discount_paise,
    balance_paise: balance,
    state,
    part_paid: state === "open" && paid_paise > 0,
    overdue: state === "open" && bill.due_date !== null && bill.due_date < today,
  };
}
