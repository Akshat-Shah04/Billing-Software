import { useState } from "react";
import { api, downloadFile, openPdf, qs } from "../api";
import { useDebounced, useLoad } from "../hooks";
import { formatDate, formatRupees } from "../money";
import DateRange, { presetRange, type Range } from "./DateRange";
import Icon from "./Icon";
import Message from "./Message";
import Sheet from "./Sheet";

export interface LedgerTarget {
  kind: "client" | "group";
  id: number;
  name: string;
}

interface LedgerData {
  name: string;
  members: string[];
  from: string;
  to: string;
  opening_paise: number;
  closing_paise: number;
  entries: { date: string; type: string; number: string; client_name: string; details: string; particulars: string; ref: string; debit_paise: number; credit_paise: number; balance_paise: number }[];
  pending: { bill_no: string; client_name: string; billed_paise: number; received_paise: number; pending_paise: number }[];
  totals: { billed_paise: number; received_paise: number; credited_paise: number; discount_paise: number };
}

/** "₹1,000.00 Dr" when the client owes, "Cr" when they have paid more than billed. */
const drCr = (p: number) => (p === 0 ? formatRupees(0) : `${formatRupees(Math.abs(p))} ${p > 0 ? "Dr" : "Cr"}`);

/**
 * A client's or a group's ledger account for a period: a short preview, then the PDF to download or open (to send to
 * the client on WhatsApp or email).
 */
export default function LedgerSheet({ target, onClose }: { target: LedgerTarget | null; onClose: () => void }) {
  const [range, setRange] = useState<Range>(presetRange("this-fy"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const r = useDebounced(range, 250);
  const param = target ? (target.kind === "client" ? { client_id: target.id } : { group_id: target.id }) : {};
  const query = qs({ ...param, from: r.from, to: r.to });
  const ledger = useLoad(() => (target ? api<LedgerData>(`/reports/ledger${query}`) : Promise.resolve(null)), `${target?.kind}|${target?.id}|${query}`);

  async function download() {
    setBusy(true);
    setError("");
    try {
      await downloadFile(`/reports/ledger.pdf${query}`, `Ledger - ${target?.name}.pdf`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const l = ledger.data;
  return (
    <Sheet
      open={target !== null}
      wide
      title={target ? `Statement of account: ${target.name}` : "Statement of account"}
      subtitle={target?.kind === "group" ? "All members of the group together, with the client shown on each line." : "Every bill, payment, credit note and discount, with a running balance."}
      onClose={onClose}
      onSubmit={download}
      submitLabel="Download PDF"
      busy={busy}
      submitDisabled={!l}
    >
      {(error || ledger.error) && <Message kind="error">{error || ledger.error}</Message>}
      <DateRange value={range} onChange={setRange} idPrefix="ledger" />

      {l && (
        <>
          {target?.kind === "group" && (
            <p className="small muted" style={{ margin: "0.85rem 0 0" }}>
              Members: {l.members.length ? l.members.join(", ") : "none yet"}
            </p>
          )}
          <dl className="facts" style={{ margin: "1rem 0" }}>
            <dt>Opening balance on {formatDate(l.from)}</dt>
            <dd>{drCr(l.opening_paise)}</dd>
            <dt>Billed in the period</dt>
            <dd>{formatRupees(l.totals.billed_paise)}</dd>
            <dt>Received</dt>
            <dd>{formatRupees(l.totals.received_paise)}</dd>
            {l.totals.credited_paise + l.totals.discount_paise > 0 && (
              <>
                <dt>Credit notes and discounts</dt>
                <dd>{formatRupees(l.totals.credited_paise + l.totals.discount_paise)}</dd>
              </>
            )}
            <hr />
            <dt className="total">Closing balance on {formatDate(l.to)}</dt>
            <dd className="total">{drCr(l.closing_paise)}</dd>
          </dl>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th>Bill / Ref</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {l.entries.map((e, n) => (
                  <tr key={n}>
                    <td className="nowrap">{formatDate(e.date)}</td>
                    <td>
                      {e.particulars}
                      {e.type === "Bill" && e.details && <div className="muted tiny">{e.details}</div>}
                    </td>
                    <td className="nowrap">{e.ref}</td>
                    <td className="num">{e.debit_paise ? formatRupees(e.debit_paise) : ""}</td>
                    <td className="num">{e.credit_paise ? formatRupees(e.credit_paise) : ""}</td>
                    <td className="num">{drCr(e.balance_paise)}</td>
                  </tr>
                ))}
                {!l.entries.length && (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      No transactions in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {l.pending.length > 0 && (
            <>
              <h3 style={{ margin: "1rem 0 0.4rem" }}>Bills pending (receipts applied oldest bill first)</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Bill No.</th>
                      <th>Party</th>
                      <th className="num">Billed</th>
                      <th className="num">Received</th>
                      <th className="num">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.pending.map((p) => (
                      <tr key={p.bill_no}>
                        <td className="nowrap">{p.bill_no}</td>
                        <td>{p.client_name}</td>
                        <td className="num">{formatRupees(p.billed_paise)}</td>
                        <td className="num">{formatRupees(p.received_paise)}</td>
                        <td className="num">{formatRupees(p.pending_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <button
            type="button"
            style={{ marginTop: "0.75rem" }}
            onClick={() => openPdf(`/reports/ledger.pdf${query}${query ? "&" : "?"}inline=1`).catch((e: Error) => setError(e.message))}
          >
            <Icon name="pdf" />
            Open PDF to view or print
          </button>
        </>
      )}
      {!l && ledger.loading && <p className="muted">Loading…</p>}
    </Sheet>
  );
}
