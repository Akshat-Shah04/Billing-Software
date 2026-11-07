import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, qs } from "../api";
import Pager from "../components/Pager";
import { useDebounced, useLoad } from "../hooks";
import { formatDate, formatRupees, fyLabel } from "../money";
import type { BillSummary, FinancialYear, Page } from "../types";

export default function Bills() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [fy, setFy] = useState(""); // "" = all financial years, otherwise the start year e.g. "2026"
  const [page, setPage] = useState(1);
  const q = useDebounced(search);

  const years = useLoad(() => api<{ items: FinancialYear[] }>("/bills/financial-years"), "years");
  const { data, error, loading } = useLoad(
    () => api<Page<BillSummary>>(`/bills${qs({ q, fy, page })}`),
    `${q}|${fy}|${page}`,
  );

  return (
    <>
      <div className="row between">
        <h1>Bills</h1>
        <Link to="/bills/new" className="btn primary">
          Create bill
        </Link>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: ".75rem" }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <input
              placeholder="Search by client name or bill number (e.g. INV-000012)"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field" style={{ width: 200 }}>
            <select
              aria-label="Financial year"
              value={fy}
              onChange={(e) => {
                setFy(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All financial years</option>
              {years.data?.items.map((y) => (
                <option key={y.fy_start} value={y.fy_start}>
                  FY {y.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="table-wrap">
          <table className="table-bills">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill no.</th>
                <th>Client</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => navigate(`/bills/${b.id}`)}>
                  <td className="nowrap">
                    <div className="bill-date">{formatDate(b.bill_date)}</div>
                    <div className="muted small">FY {fyLabel(b.fy_start)}</div>
                  </td>
                  <td className="bill-id nowrap">
                    <Link to={`/bills/${b.id}`} onClick={(e) => e.stopPropagation()}>
                      {b.bill_no}
                    </Link>
                  </td>
                  <td>
                    {b.client_name} {b.client_deleted && <span className="badge warn">deleted</span>}
                    <div className="muted small">{[b.client_phone, b.client_city].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="num nowrap">{formatRupees(b.total_paise)}</td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    {loading
                      ? "Loading…"
                      : q || fy
                        ? "No bills match your search."
                        : "No bills yet. Create the first one."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      </div>
    </>
  );
}
