import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import PaymentDetails from "../components/PaymentDetails";
import { useLoad, useLogoUrl } from "../hooks";
import { formatDate, formatRupees, fyLabel } from "../money";
import type { Bill, Settings } from "../types";

export default function BillView() {
  const { id } = useParams();
  const bill = useLoad(() => api<Bill>(`/bills/${id}`), String(id));
  const settings = useLoad(() => api<Settings>("/settings"), "settings");
  const logoUrl = useLogoUrl(settings.data?.has_logo, settings.data?.logo_version);

  if (bill.error) return <div className="error">{bill.error}</div>;
  if (!bill.data) return <p>Loading…</p>;
  const b = bill.data;
  const org = settings.data;

  return (
    <>
      <div className="row between no-print">
        <Link to="/bills">← All bills</Link>
        <div className="row">
          <button onClick={() => window.print()}>Print</button>
          <Link to={`/bills/${b.id}/edit`} className="btn primary">
            Edit bill
          </Link>
        </div>
      </div>

      <div className="card paper" style={{ marginTop: ".75rem" }}>
        <div className="invoice-head">
          <div>
            {logoUrl && <img className="org-logo" src={logoUrl} alt="" />}
            <h1 style={{ marginBottom: ".25rem" }}>{org?.org_name || "Invoice"}</h1>
            <div className="muted" style={{ whiteSpace: "pre-line" }}>
              {org?.org_address}
            </div>
            {org?.org_gstin && <div className="muted">GSTIN: {org.org_gstin}</div>}
          </div>
          <div className="right">
            <div className="bill-id">{b.bill_no}</div>
            <div className="bill-date">{formatDate(b.bill_date)}</div>
            <div className="muted small">Financial year {fyLabel(b.fy_start)}</div>
          </div>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <div className="muted small">Billed to</div>
          <strong>{b.client_name}</strong>
          {b.client_address && <div style={{ whiteSpace: "pre-line" }}>{b.client_address}</div>}
          <div className="muted">{[b.client_city, b.client_phone].filter(Boolean).join(" · ")}</div>
          {b.client_gstin && <div className="muted">GSTIN: {b.client_gstin}</div>}
          {b.client_pan && <div className="muted">PAN: {b.client_pan}</div>}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {b.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <div className="item-title">{i.description}</div>
                    {i.details && <div className="item-text">{i.details}</div>}
                  </td>
                  <td className="num">{i.quantity}</td>
                  <td className="num">{formatRupees(i.unit_price_paise)}</td>
                  <td className="num">{formatRupees(i.line_total_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="totals" style={{ marginTop: "1rem" }}>
          <div>
            <span>Subtotal</span>
            <span>{formatRupees(b.subtotal_paise)}</span>
          </div>
          {b.gst_rate_percent > 0 && (
            <div>
              <span>GST @ {b.gst_rate_percent}%</span>
              <span>{formatRupees(b.gst_paise)}</span>
            </div>
          )}
          <div className="grand">
            <span>Total</span>
            <span>{formatRupees(b.total_paise)}</span>
          </div>
        </div>

        {b.notes && (
          <p style={{ marginTop: "1rem", whiteSpace: "pre-line" }}>
            <span className="muted small">Notes</span>
            <br />
            {b.notes}
          </p>
        )}

        <PaymentDetails org={org} />
      </div>

      <p className="muted small no-print">
        Created by {b.created_by_name} on {new Date(b.created_at).toLocaleString("en-IN")}
        {b.updated_by_name && ` · Last edited by ${b.updated_by_name} on ${new Date(b.updated_at).toLocaleString("en-IN")}`}
      </p>
    </>
  );
}
