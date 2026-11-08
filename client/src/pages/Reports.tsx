import { useState } from "react";
import { api, downloadFile, qs } from "../api";
import DateRange, { presetRange, type Range } from "../components/DateRange";
import Icon from "../components/Icon";
import Message from "../components/Message";
import PageHeader from "../components/PageHeader";
import { useDebounced, useLoad } from "../hooks";
import { formatDate, formatRupees } from "../money";
import type { ClientGroup } from "../types";

interface FeesReport {
  from: string;
  to: string;
  group_name: string | null;
  rows: {
    bill_no: string; bill_date: string; client_name: string; group_name: string | null; fees_paise: number; gst_paise: number;
    reimbursement_paise: number; total_paise: number; received_paise: number; last_paid_on: string | null; reduced_paise: number; balance_paise: number; status: string; cancelled: boolean;
  }[];
  receipts: { receipt_no: string; paid_on: string; client_name: string; group_name: string | null; bill_no: string; bill_date: string; method: string; reference: string | null; amount_paise: number }[];
  summary: {
    bills: number; cancelled: number; fees_paise: number; gst_paise: number; reimbursement_paise: number; total_paise: number; received_paise: number;
    reimbursed_paise: number; fees_received_paise: number; credited_paise: number; discount_paise: number; outstanding_paise: number;
    collected_paise: number; receipts: number;
  };
  months: { month: string; bills: number; fees_paise: number; gst_paise: number; reimbursement_paise: number; received_paise: number; collected_paise: number }[];
}

/** The fees report (admins): bills in a period in brief, with a summary, to view here or download as Excel or PDF. */
export default function Reports() {
  const [range, setRange] = useState<Range>(presetRange("this-fy"));
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState<"" | "xlsx" | "pdf">("");
  const [error, setError] = useState("");
  const r = useDebounced(range, 250);
  const query = qs({ from: r.from, to: r.to, group_id: group });
  const groups = useLoad(() => api<{ items: ClientGroup[] }>("/client-groups"), "groups");
  const report = useLoad(() => api<FeesReport>(`/reports/fees${query}`), query);

  async function download(kind: "xlsx" | "pdf") {
    setBusy(kind);
    setError("");
    try {
      await downloadFile(`/reports/fees.${kind}${query}`, `Fees report.${kind}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const d = report.data;
  const s = d?.summary;
  return (
    <>
      <PageHeader title="Fees report" subtitle="Every bill in a period in brief, with a summary. Fees are your income; GST and amounts paid on clients' behalf are shown apart.">
        <button onClick={() => download("pdf")} disabled={busy !== "" || !d}>
          <Icon name="pdf" />
          {busy === "pdf" ? "Preparing…" : "PDF"}
        </button>
        <button className="primary" onClick={() => download("xlsx")} disabled={busy !== "" || !d}>
          <Icon name="download" />
          {busy === "xlsx" ? "Preparing…" : "Excel"}
        </button>
      </PageHeader>
      {(error || report.error) && <Message kind="error">{error || report.error}</Message>}

      <div className="card">
        <div className="grid" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)", alignItems: "end" }}>
          <DateRange value={range} onChange={setRange} idPrefix="report" />
          <div className="field">
            <label htmlFor="report-group">Group</label>
            <select id="report-group" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">All clients</option>
              {groups.data?.items.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {s && (
        <div className="tiles">
          <div className="tile">
            <div className="tile-label">Fees (income)</div>
            <div className="tile-value">{formatRupees(s.fees_paise)}</div>
            <div className="tile-sub">
              {s.bills} {s.bills === 1 ? "bill" : "bills"}
              {s.cancelled ? `, ${s.cancelled} cancelled not counted` : ""}
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">GST charged</div>
            <div className="tile-value">{formatRupees(s.gst_paise)}</div>
            <div className="tile-sub">Not income</div>
          </div>
          <div className="tile">
            <div className="tile-label">Paid on clients’ behalf</div>
            <div className="tile-value">{formatRupees(s.reimbursement_paise)}</div>
            <div className="tile-sub">{formatRupees(s.reimbursed_paise)} paid back so far</div>
          </div>
          <div className="tile">
            <div className="tile-label">Received</div>
            <div className="tile-value">{formatRupees(s.received_paise)}</div>
            <div className="tile-sub">{formatRupees(s.fees_received_paise)} towards fees and GST</div>
          </div>
          <div className="tile">
            <div className="tile-label">Collected in period</div>
            <div className="tile-value">{formatRupees(s.collected_paise)}</div>
            <div className="tile-sub">
              {s.receipts} {s.receipts === 1 ? "receipt" : "receipts"}, by date received
            </div>
          </div>
          <div className={`tile${s.outstanding_paise > 0 ? " alert" : ""}`}>
            <div className="tile-label">Outstanding</div>
            <div className="tile-value">{formatRupees(s.outstanding_paise)}</div>
            <div className="tile-sub">
              {s.credited_paise + s.discount_paise > 0 ? `After ${formatRupees(s.credited_paise + s.discount_paise)} credit notes and discounts` : "Still to collect"}
            </div>
          </div>
        </div>
      )}

      {d && d.months.length > 0 && (
        <div className="card">
          <h2>Month by month</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Bills</th>
                  <th className="num">Fees</th>
                  <th className="num">GST</th>
                  <th className="num">Paid on behalf</th>
                  <th className="num" title="Received so far on the bills dated in this month">Received on these bills</th>
                  <th className="num" title="Money that came in during this month, on any bill">Collected</th>
                </tr>
              </thead>
              <tbody>
                {d.months.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td className="num">{m.bills}</td>
                    <td className="num">{formatRupees(m.fees_paise)}</td>
                    <td className="num">{formatRupees(m.gst_paise)}</td>
                    <td className="num">{formatRupees(m.reimbursement_paise)}</td>
                    <td className="num">{formatRupees(m.received_paise)}</td>
                    <td className="num">{formatRupees(m.collected_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d && (
        <div className="card flush">
          <div className="card-pad">
            <h2 style={{ margin: 0 }}>Bills</h2>
            <div className="muted small">
              {formatDate(d.from)} to {formatDate(d.to)}
              {d.group_name ? ` · ${d.group_name}` : ""}
            </div>
          </div>
          <div className="table-wrap">
            <table className="table-report">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Client</th>
                  <th className="num">Fees</th>
                  <th className="num">GST</th>
                  <th className="num">On behalf</th>
                  <th className="num">Total</th>
                  <th className="num">Received</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((b) => (
                  <tr key={b.bill_no} className={b.cancelled ? "dim" : ""}>
                    <td className="nowrap">
                      <strong style={{ fontWeight: 600 }}>{b.bill_no}</strong>
                      <div className="muted tiny">{formatDate(b.bill_date)}</div>
                    </td>
                    <td>
                      {b.client_name}
                      {b.group_name && <div className="muted tiny">{b.group_name}</div>}
                    </td>
                    <td className="num">{formatRupees(b.fees_paise)}</td>
                    <td className="num">{formatRupees(b.gst_paise)}</td>
                    <td className="num">{b.reimbursement_paise ? formatRupees(b.reimbursement_paise) : "–"}</td>
                    <td className="num">{formatRupees(b.total_paise)}</td>
                    <td className="num">
                      {formatRupees(b.received_paise)}
                      {b.last_paid_on && <div className="muted tiny">last {formatDate(b.last_paid_on)}</div>}
                    </td>
                    <td className="num">{b.cancelled ? "–" : formatRupees(b.balance_paise)}</td>
                    <td className="nowrap">{b.status}</td>
                  </tr>
                ))}
                {!d.rows.length && (
                  <tr>
                    <td colSpan={9} className="empty-cell">
                      No bills in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d && (
        <div className="card flush">
          <div className="card-pad">
            <h2 style={{ margin: 0 }}>Receipts</h2>
            <div className="muted small">Money received from {formatDate(d.from)} to {formatDate(d.to)}, by the date it came in (on any bill)</div>
          </div>
          <div className="table-wrap">
            <table className="table-report">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Client</th>
                  <th>Bill</th>
                  <th>How paid</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.receipts.map((x) => (
                  <tr key={x.receipt_no}>
                    <td className="nowrap">
                      <strong style={{ fontWeight: 600 }}>{x.receipt_no}</strong>
                      <div className="muted tiny">{formatDate(x.paid_on)}</div>
                    </td>
                    <td>
                      {x.client_name}
                      {x.group_name && <div className="muted tiny">{x.group_name}</div>}
                    </td>
                    <td className="nowrap">
                      {x.bill_no}
                      <div className="muted tiny">{formatDate(x.bill_date)}</div>
                    </td>
                    <td>
                      {x.method}
                      {x.reference && <div className="muted tiny">{x.reference}</div>}
                    </td>
                    <td className="num">{formatRupees(x.amount_paise)}</td>
                  </tr>
                ))}
                {!d.receipts.length && (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      No money received in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
