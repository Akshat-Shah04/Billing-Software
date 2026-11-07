import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, downloadFile, qs } from "../api";
import Icon from "../components/Icon";
import Message from "../components/Message";
import PageHeader from "../components/PageHeader";
import Pager from "../components/Pager";
import Segmented from "../components/Segmented";
import StatusBadge from "../components/StatusBadge";
import { useDebounced, useLoad } from "../hooks";
import { formatDate, formatRupees, fyLabel } from "../money";
import type { BillSummary, BillsTotals, Client, FinancialYear, Page } from "../types";

type Status = "" | "outstanding" | "overdue" | "paid" | "cancelled";
const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "", label: "All" },
  { value: "outstanding", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

/** A bill's items as a short bullet list: name and financial year. Long bills show the first few and "+N more". */
const SHOW_ITEMS = 4;
function ItemBullets({ items }: { items: { description: string; fy_start: number }[] }) {
  if (!items.length) return <span className="muted">–</span>;
  const shown = items.slice(0, SHOW_ITEMS);
  return (
    <ul className="item-bullets">
      {shown.map((i, n) => (
        <li key={n}>
          {i.description}
          <span className="muted"> · {fyLabel(i.fy_start)}</span>
        </li>
      ))}
      {items.length > SHOW_ITEMS && <li className="more muted">+{items.length - SHOW_ITEMS} more</li>}
    </ul>
  );
}

export default function Bills() {
  const navigate = useNavigate();
  // Filters live in the address, so Back returns to the same list and a filtered list can be bookmarked.
  const [params, setParams] = useSearchParams();
  const fy = params.get("fy") ?? "";
  const status = (params.get("status") ?? "") as Status;
  const clientId = params.get("client_id") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);

  function setFilter(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  }

  const years = useLoad(() => api<{ items: FinancialYear[] }>("/bills/financial-years"), "years");
  const totals = useLoad(() => api<BillsTotals>(`/bills/summary${qs({ fy })}`), `sum|${fy}`);
  const client = useLoad(() => (clientId ? api<Client>(`/clients/${clientId}`) : Promise.resolve(null)), `client|${clientId}`);
  const { data, error, loading } = useLoad(
    () => api<Page<BillSummary>>(`/bills${qs({ q, fy, status, client_id: clientId, page })}`),
    `${q}|${fy}|${status}|${clientId}|${page}`,
  );

  async function exportCsv() {
    setExportError("");
    setExporting(true);
    try {
      await downloadFile(`/exports/bills.csv${qs({ q, fy, status, client_id: clientId })}`, "bills.csv");
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const t = totals.data;
  const filtered = Boolean(q || fy || status || clientId);

  return (
    <>
      <PageHeader title="Bills" subtitle={fy ? `Financial year ${fyLabel(Number(fy))}` : "All financial years"}>
        <button onClick={exportCsv} disabled={exporting} title="Download the bills shown below as a spreadsheet (CSV)">
          <Icon name="download" />
          <span className="btn-label-sm">{exporting ? "Preparing…" : "Export"}</span>
        </button>
        <Link to="/bills/new" className="btn primary">
          <Icon name="plus" />
          New bill
        </Link>
      </PageHeader>

      {t && (
        <div className="tiles">
          <div className="tile">
            <div className="tile-label">Billed</div>
            {/* Net of credit notes and discounts, so a bill settled for less counts at what it was settled for. */}
            <div className="tile-value">{formatRupees(t.billed_paise - t.credited_paise - t.discount_paise)}</div>
            <div className="tile-sub">
              {t.credited_paise + t.discount_paise > 0
                ? `${formatRupees(t.billed_paise)} before ${formatRupees(t.credited_paise + t.discount_paise)} of credit notes and discounts`
                : "Cancelled bills not included"}
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">Received</div>
            <div className="tile-value">{formatRupees(t.collected_paise)}</div>
            <div className="tile-sub">Payments recorded</div>
          </div>
          <button type="button" className="tile" onClick={() => setFilter({ status: "outstanding" })} aria-label={`Unpaid: ${formatRupees(t.outstanding_paise)} on ${t.outstanding_count} bills. Show them.`}>
            <div className="tile-label">To collect</div>
            <div className="tile-value">{formatRupees(t.outstanding_paise)}</div>
            <div className="tile-sub">
              {t.outstanding_count} {t.outstanding_count === 1 ? "bill" : "bills"} unpaid
            </div>
          </button>
          <button type="button" className={`tile${t.overdue_count > 0 ? " alert" : ""}`} onClick={() => setFilter({ status: "overdue" })} aria-label={`Overdue: ${formatRupees(t.overdue_paise)} on ${t.overdue_count} bills. Show them.`}>
            <div className="tile-label">
              {t.overdue_count > 0 && <span className="badge danger">Overdue</span>}
              {t.overdue_count === 0 && "Overdue"}
            </div>
            <div className="tile-value">{formatRupees(t.overdue_paise)}</div>
            <div className="tile-sub">
              {t.overdue_count === 0 ? "Nothing past its due date" : `${t.overdue_count} ${t.overdue_count === 1 ? "bill" : "bills"} past due date`}
            </div>
          </button>
        </div>
      )}

      {exportError && <Message kind="error">{exportError}</Message>}
      {clientId && (
        <Message kind="info">
          <span>
            Showing bills for <strong>{client.data?.name ?? "this client"}</strong>.{" "}
            <button className="link" onClick={() => setFilter({ client_id: "" })}>
              Show all clients
            </button>
          </span>
        </Message>
      )}

      <div className="card flush">
        <div className="filters">
          <div className="search">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search bills"
              placeholder="Search client or bill number"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setFilter({ q: e.target.value });
              }}
            />
          </div>
          <Segmented label="Show bills" options={STATUS_OPTIONS} value={status} onChange={(v) => setFilter({ status: v })} />
          <select aria-label="Financial year" value={fy} onChange={(e) => setFilter({ fy: e.target.value })}>
            <option value="">All years</option>
            {years.data?.items.map((y) => (
              <option key={y.fy_start} value={y.fy_start}>
                FY {y.label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <div className="card-pad">
            <Message kind="error">{error}</Message>
          </div>
        )}
        <div className="table-wrap">
          <table className="table-bills">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Client</th>
                <th>Items</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((b) => (
                <tr key={b.id} className={`clickable${b.state === "cancelled" ? " dim" : ""}`} onClick={() => navigate(`/bills/${b.id}`)}>
                  <td className="c-bill nowrap">
                    <div className="bill-id">
                      <Link to={`/bills/${b.id}`} onClick={(e) => e.stopPropagation()}>
                        {b.bill_no}
                      </Link>
                    </div>
                    <div className="muted tiny">
                      {formatDate(b.bill_date)} · FY {fyLabel(b.fy_start)}
                    </div>
                  </td>
                  <td className="c-client">
                    {b.client_name} {b.client_deleted && <span className="badge plain">deleted client</span>}
                    <div className="muted tiny">{[b.client_phone, b.client_city].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="c-items">
                    <ItemBullets items={b.items} />
                  </td>
                  <td className="c-status nowrap">
                    <StatusBadge bill={b} />
                    {b.due_date && b.state === "open" && <div className="muted tiny">Due {formatDate(b.due_date)}</div>}
                  </td>
                  <td className="c-total num">
                    {formatRupees(b.total_paise - b.credited_paise - b.discount_paise)}
                    {b.credited_paise + b.discount_paise > 0 && b.state !== "cancelled" && (
                      <div className="muted tiny" title="Reduced by a credit note or discount">
                        of {formatRupees(b.total_paise)}
                      </div>
                    )}
                  </td>
                  <td className="c-balance num">{b.state === "open" ? formatRupees(b.balance_paise) : <span className="muted">–</span>}</td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    {loading ? (
                      "Loading…"
                    ) : filtered ? (
                      <div className="empty">
                        <strong>No matching bills</strong>
                        Try another search, status or year.
                      </div>
                    ) : (
                      <div className="empty">
                        <strong>No bills yet</strong>
                        <Link to="/bills/new">Create the first bill</Link>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={(p) => setFilter({ page: String(p) })} />}
      </div>
    </>
  );
}
