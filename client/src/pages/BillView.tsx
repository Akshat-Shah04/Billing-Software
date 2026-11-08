import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, downloadFile, openPdf } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import Message from "../components/Message";
import PageHeader from "../components/PageHeader";
import PaymentDetails, { hasPaymentDetails } from "../components/PaymentDetails";
import Sheet from "../components/Sheet";
import StatusBadge from "../components/StatusBadge";
import { useLoad, useLogoUrl } from "../hooks";
import { amountInWords } from "../words";
import { calculateTotals, formatDate, formatRupees, fyLabel, paiseToInput, rupeesToPaise, todayISO } from "../money";
import type { Bill, Discount, HistoryEntry, Payment, PaymentMethod, Receipt, Settings } from "../types";

export const METHODS: [PaymentMethod, string][] = [
  ["upi", "UPI"],
  ["bank_transfer", "Bank transfer (NEFT / RTGS / IMPS)"],
  ["cash", "Cash"],
  ["cheque", "Cheque"],
  ["card", "Card"],
  ["other", "Other"],
];
const methodLabel = (m: PaymentMethod) => METHODS.find(([v]) => v === m)?.[1].replace(/ \(.*\)$/, "") ?? m;

type SheetName = null | "payment" | "credit" | "cancel" | "void" | "whatsapp" | "discount" | "void-discount" | "receipt";

/** A phone number as WhatsApp wants it: country code + number, digits only. */
export function whatsappNumber(phone: string | null, countryCode: string): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `${countryCode || "91"}${d}`;
  return d.length >= 8 ? d : "";
}

export default function BillView() {
  const { id } = useParams();
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const bill = useLoad(() => api<Bill>(`/bills/${id}`), String(id));
  const settings = useLoad(() => api<Settings>("/settings"), "settings");
  const [historyTick, setHistoryTick] = useState(0);
  const history = useLoad(() => api<{ items: HistoryEntry[] }>(`/bills/${id}/history`), `${id}|${historyTick}`);
  const logoUrl = useLogoUrl(settings.data?.has_logo, settings.data?.logo_version);

  const [sheet, setSheet] = useState<SheetName>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [voidingDiscount, setVoidingDiscount] = useState<Discount | null>(null);
  const [receiptFor, setReceiptFor] = useState<Payment | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  if (bill.error) return <Message kind="error">{bill.error}</Message>;
  if (!bill.data) return <p className="muted">Loading…</p>;
  const b = bill.data;
  const org = settings.data;
  const cancelled = b.state === "cancelled";
  const open = b.state === "open";

  /** After a change: show the new bill, refresh the history, say what happened. */
  function done(message: string) {
    bill.reload();
    setHistoryTick((t) => t + 1);
    setSheet(null);
    setVoiding(null);
    setNotice(message);
  }

  async function pdf(path: string) {
    setActionError("");
    try {
      await openPdf(path);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <>
      <Link to="/bills" className="back no-print">
        <Icon name="chevronLeft" />
        Bills
      </Link>
      <div className="no-print">
        <PageHeader
          title={`Bill ${b.bill_no}`}
          subtitle={
            <span className="row" style={{ gap: "0.5rem" }}>
              <StatusBadge bill={b} />
              <span>
                {b.client_name} · {formatDate(b.bill_date)}
              </span>
            </span>
          }
        >
          <button onClick={() => window.print()}>
            <Icon name="print" />
            <span className="btn-label-sm">Print</span>
          </button>
          <button onClick={() => pdf(`/bills/${b.id}/pdf?inline=1`)}>
            <Icon name="pdf" />
            <span className="btn-label-sm">PDF</span>
          </button>
          {!cancelled && (
            <Link to={`/bills/${b.id}/edit`} className="btn">
              <Icon name="edit" />
              <span className="btn-label-sm">Edit</span>
            </Link>
          )}
        </PageHeader>
        {notice && <Message kind="notice">{notice}</Message>}
        {actionError && <Message kind="error">{actionError}</Message>}
      </div>

      <div className="bill-layout">
        {/* ---------- The document, laid out like the firm's professional invoice, exactly as it prints ---------- */}
        <article className="card paper invoice">
          <header className="letterhead">
            {logoUrl && <img className="org-logo" src={logoUrl} alt="" />}
            <h1>{org?.org_name || "Invoice"}</h1>
            {org?.org_tagline && <div className="lh-tagline">{org.org_tagline}</div>}
            {org?.org_address && <div className="pre">{org.org_address}</div>}
            {(org?.org_mobile || org?.org_gstin) && (
              <div className="lh-contact">
                {[org.org_mobile && `Mobile: ${org.org_mobile}`, org.org_gstin && `GSTIN: ${org.org_gstin}`].filter(Boolean).join("   ·   ")}
              </div>
            )}
          </header>

          <div className="party">
            <div className="party-to">
              <div className="doc-label">To</div>
              <strong className="party-name">{b.client_name}</strong>
              {b.client_address && <div className="pre">{b.client_address}</div>}
              {b.client_city && <div>{b.client_city}</div>}
              {(b.client_pan || b.client_gstin) && (
                <div className="party-ids">{[b.client_pan && `PAN: ${b.client_pan}`, b.client_gstin && `GSTIN: ${b.client_gstin}`].filter(Boolean).join("   ·   ")}</div>
              )}
              {b.client_phone && <div className="muted">Mobile: {b.client_phone}</div>}
            </div>
            <div>
              <div className="invoice-box">
                <div className="invoice-title">Professional Invoice</div>
                <dl>
                  <dt>Bill No.</dt>
                  <dd>{b.bill_no}</dd>
                  <dt>Date</dt>
                  <dd>{formatDate(b.bill_date)}</dd>
                  {b.client_file_no && (
                    <>
                      <dt>File No.</dt>
                      <dd>{b.client_file_no}</dd>
                    </>
                  )}
                </dl>
              </div>
              {cancelled && <div className="stamp">Cancelled</div>}
            </div>
          </div>

          <div className="table-wrap">
            <table className="invoice-items">
              <thead>
                <tr>
                  <th style={{ width: "2.5rem" }}>Sr.</th>
                  <th>Being the charges for services rendered</th>
                  <th className="num">Year</th>
                  <th className="num">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {b.items.filter((i) => i.kind !== "reimbursement").map((i, n) => (
                  <tr key={i.id}>
                    <td>{n + 1}</td>
                    <td>
                      <div className="item-title">{i.description}</div>
                      {i.details && <div className="item-text">{i.details}</div>}
                      {i.quantity > 1 && (
                        <div className="item-text">
                          {i.quantity} × {formatRupees(i.unit_price_paise)}
                        </div>
                      )}
                    </td>
                    <td className="num">FY {i.fy_start}-{i.fy_start + 1}</td>
                    <td className="num">
                      <strong>{formatRupees(i.line_total_paise)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {b.items.some((i) => i.kind === "reimbursement") && (
            <div className="table-wrap" style={{ marginTop: "1.25rem" }}>
              <table className="invoice-items">
                <thead>
                  <tr>
                    <th style={{ width: "2.5rem" }}>Sr.</th>
                    <th>Paid on your behalf (no GST)</th>
                    <th className="num">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {b.items
                    .filter((i) => i.kind === "reimbursement")
                    .map((i, n) => (
                      <tr key={i.id}>
                        <td>{n + 1}</td>
                        <td>
                          <div className="item-title">{i.description}</div>
                          {i.details && <div className="item-text">{i.details}</div>}
                        </td>
                        <td className="num">
                          <strong>{formatRupees(i.line_total_paise)}</strong>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="totals" style={{ marginTop: "1rem" }}>
            {(b.gst_rate_percent > 0 || b.reimbursement_paise > 0) && (
              <div>
                <span>Fees</span>
                <span>{formatRupees(b.subtotal_paise)}</span>
              </div>
            )}
            {b.gst_rate_percent > 0 && (
              <div>
                <span>GST @ {b.gst_rate_percent}% (on fees)</span>
                <span>{formatRupees(b.gst_paise)}</span>
              </div>
            )}
            {b.reimbursement_paise > 0 && (
              <div>
                <span>Paid on your behalf</span>
                <span>{formatRupees(b.reimbursement_paise)}</span>
              </div>
            )}
            <div className="grand">
              <span>{b.reimbursement_paise > 0 ? "Total payable" : "Total"}</span>
              <span>{formatRupees(b.total_paise)}</span>
            </div>
          </div>
          <div className="in-words">
            <div>
              <div className="doc-label">Amount in words</div>
              <strong>{amountInWords(b.total_paise)}</strong>
            </div>
            <div className="muted small">E.&amp; O.E.</div>
          </div>

          {(b.notes || (b.due_date && !cancelled)) && (
            <div className="remarks">
              <div className="doc-label">Remarks</div>
              {b.due_date && !cancelled && <div>Payment due by {formatDate(b.due_date)}.</div>}
              {b.notes && <div className="pre">{b.notes}</div>}
            </div>
          )}

          {!cancelled && <PaymentDetails org={org} />}
          {!cancelled && admin && org && !hasPaymentDetails(org) && (
            <div className="no-print" style={{ marginTop: "1.25rem" }}>
              <Message kind="warn">
                No payment details are printed on this bill because none are set. Add your bank account and UPI ID in{" "}
                <Link to="/settings">Settings → Payment details</Link>; they then appear on every bill and PDF.
              </Message>
            </div>
          )}

          <footer className="sign-off">
            <div>{org?.org_state && <strong>State: {org.org_state}</strong>}</div>
            <div className="sign-who">
              <strong>For, {org?.org_name || "the firm"}</strong>
              <div className="sign-line">
                {org?.signatory_name ? (
                  <>
                    <strong>{org.signatory_name}</strong>
                    <div className="muted tiny">Authorised Signatory</div>
                  </>
                ) : (
                  "Authorised Signatory"
                )}
              </div>
            </div>
          </footer>
          {org?.jurisdiction?.trim() && <div className="jurisdiction">Subject to {org.jurisdiction.trim()} jurisdiction.</div>}
        </article>

        {/* ---------- Status and actions ---------- */}
        <aside className="bill-side no-print">
          <section className="card" aria-labelledby="bal-h">
            {cancelled ? (
              <>
                <h2 id="bal-h">Cancelled</h2>
                <p className="small" style={{ marginBottom: "0.25rem" }}>
                  {b.cancel_reason}
                </p>
                <p className="muted tiny" style={{ margin: 0 }}>
                  By {b.cancelled_by_name}
                  {b.cancelled_at && ` on ${new Date(b.cancelled_at).toLocaleString("en-IN")}`}. The bill and its number are kept for the record.
                </p>
              </>
            ) : (
              <>
                <div className="muted small" id="bal-h">
                  {open ? "Balance due" : "Settled"}
                </div>
                <div className="balance-big" style={{ color: b.overdue ? "var(--danger)" : undefined }}>
                  {formatRupees(Math.max(b.balance_paise, 0))}
                </div>
                {b.due_date && open && (
                  <div className={`tiny ${b.overdue ? "" : "muted"}`} style={{ color: b.overdue ? "var(--danger)" : undefined }}>
                    {b.overdue ? "Overdue since" : "Due on"} {formatDate(b.due_date)}
                  </div>
                )}
                <dl className="facts" style={{ marginTop: "1rem" }}>
                  <dt>Bill total</dt>
                  <dd>{formatRupees(b.total_paise)}</dd>
                  {b.credited_paise > 0 && (
                    <>
                      <dt>Credit notes</dt>
                      <dd>− {formatRupees(b.credited_paise)}</dd>
                    </>
                  )}
                  <dt>Received</dt>
                  <dd>− {formatRupees(b.paid_paise)}</dd>
                  {b.discount_paise > 0 && (
                    <>
                      <dt>Discount</dt>
                      <dd>− {formatRupees(b.discount_paise)}</dd>
                    </>
                  )}
                  <hr />
                  <dt className="total">Balance</dt>
                  <dd className="total">{formatRupees(Math.max(b.balance_paise, 0))}</dd>
                </dl>
                <div className="action-grid" style={{ marginTop: "1rem" }}>
                  {open && (
                    <button className="primary wide" onClick={() => setSheet("payment")}>
                      <Icon name="payment" />
                      Record payment
                    </button>
                  )}
                  <button className={open ? "" : "wide"} onClick={() => setSheet("whatsapp")}>
                    <Icon name="message" />
                    WhatsApp
                  </button>
                  {admin && open && (
                    <button onClick={() => setSheet("credit")}>
                      <Icon name="credit" />
                      Credit note
                    </button>
                  )}
                </div>
                {open && b.paid_paise > 0 && (
                  <button className="link" style={{ marginTop: "0.75rem", display: "block" }} onClick={() => setSheet("discount")}>
                    Client won't pay the rest? Settle the bill…
                  </button>
                )}
                {/* Cancelling is only for a bill with nothing recorded against it; otherwise a credit note is the way. */}
                {admin && !b.amounts_locked && (
                  <button className="link danger" style={{ marginTop: "0.75rem" }} onClick={() => setSheet("cancel")}>
                    Cancel this bill…
                  </button>
                )}
              </>
            )}
          </section>

          {b.payments.length > 0 && (
            <section className="card" aria-labelledby="pay-h">
              <h2 id="pay-h">Payments</h2>
              <ul className="list">
                {b.payments.map((p) => (
                  <li key={p.id} className={p.voided_at ? "voided" : ""}>
                    <div className="grow">
                      <div className="title">
                        {methodLabel(p.method)}
                        {p.voided_at && (
                          <>
                            {" "}
                            <span className="badge neutral" style={{ textDecoration: "none" }}>
                              Voided
                            </span>
                          </>
                        )}
                      </div>
                      <div className="meta">
                        {formatDate(p.paid_on)}
                        {p.reference && ` · ${p.reference}`} · by {p.created_by_name}
                      </div>
                      <div className="meta">Receipt {p.receipt_no}</div>
                      {p.notes && <div className="meta">{p.notes}</div>}
                      {p.voided_at && (
                        <div className="meta">
                          Voided by {p.voided_by_name}: {p.void_reason}
                        </div>
                      )}
                      <button
                        className="link"
                        style={{ marginLeft: "-0.35rem" }}
                        onClick={() => {
                          if (p.voided_at) return pdf(`/payments/${p.id}/receipt.pdf?inline=1`);
                          setReceiptFor(p);
                          setSheet("receipt");
                        }}
                      >
                        {p.voided_at ? "Void receipt (PDF)" : "Receipt…"}
                      </button>
                      {admin && !p.voided_at && (
                        <button
                          className="link danger"
                          style={{ marginLeft: "-0.35rem" }}
                          onClick={() => {
                            setVoiding(p);
                            setSheet("void");
                          }}
                        >
                          Void…
                        </button>
                      )}
                    </div>
                    <div className="amount">{formatRupees(p.amount_paise)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {b.discounts.length > 0 && (
            <section className="card" aria-labelledby="disc-h">
              <h2 id="disc-h">Discounts</h2>
              <ul className="list">
                {b.discounts.map((d) => (
                  <li key={d.id} className={d.voided_at ? "voided" : ""}>
                    <div className="grow">
                      <div className="title">
                        {d.reason}
                        {d.voided_at && (
                          <>
                            {" "}
                            <span className="badge neutral" style={{ textDecoration: "none" }}>
                              Voided
                            </span>
                          </>
                        )}
                      </div>
                      <div className="meta">
                        {formatDate(d.given_on)} · by {d.created_by_name}
                      </div>
                      {d.voided_at && (
                        <div className="meta">
                          Voided by {d.voided_by_name}: {d.void_reason}
                        </div>
                      )}
                      {admin && !d.voided_at && (
                        <button
                          className="link danger"
                          style={{ marginLeft: "-0.35rem" }}
                          onClick={() => {
                            setVoidingDiscount(d);
                            setSheet("void-discount");
                          }}
                        >
                          Void…
                        </button>
                      )}
                    </div>
                    <div className="amount">{formatRupees(d.amount_paise)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {b.credit_notes.length > 0 && (
            <section className="card" aria-labelledby="cn-h">
              <h2 id="cn-h">Credit notes</h2>
              <ul className="list">
                {b.credit_notes.map((c) => (
                  <li key={c.id}>
                    <div className="grow">
                      <div className="title">{c.cn_no}</div>
                      <div className="meta">
                        {formatDate(c.cn_date)} · {c.reason}
                      </div>
                      <button className="link" style={{ marginLeft: "-0.35rem" }} onClick={() => pdf(`/credit-notes/${c.id}/pdf?inline=1`)}>
                        Open PDF
                      </button>
                    </div>
                    <div className="amount">{formatRupees(c.total_paise)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <details className="disclosure">
              <summary>
                <Icon name="chevronRight" />
                History
              </summary>
              {history.data && (
                <ul className="list">
                  {history.data.items.map((h) => (
                    <li key={h.id}>
                      <div className="grow">
                        <div className="small">{h.summary}</div>
                        <div className="meta">
                          {h.changed_by_name} · {new Date(h.changed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </section>
        </aside>
      </div>

      <PaymentSheet
        open={sheet === "payment"}
        bill={b}
        onClose={() => setSheet(null)}
        onDone={(updated) => {
          // A receipt is made for every payment: open it straight away so it can be sent to the client.
          const newest = updated.payments.reduce<Payment | null>((m, p) => (!m || p.id > m.id ? p : m), null);
          done(newest ? `Payment recorded. Receipt ${newest.receipt_no} is ready to send.` : "Payment recorded.");
          if (newest) {
            setReceiptFor(newest);
            setSheet("receipt");
          }
        }}
      />
      {receiptFor && (
        <ReceiptSheet
          open={sheet === "receipt"}
          payment={receiptFor}
          org={org}
          onClose={() => setSheet(null)}
          onEmailed={(to) => {
            setHistoryTick((t) => t + 1);
            setNotice(`Receipt ${receiptFor.receipt_no} emailed to ${to}.`);
          }}
        />
      )}
      {admin && <CreditNoteSheet open={sheet === "credit"} bill={b} onClose={() => setSheet(null)} onDone={(cnNo) => done(`Credit note ${cnNo} issued.`)} />}
      {admin && <CancelSheet open={sheet === "cancel"} bill={b} onClose={() => setSheet(null)} onDone={() => done("Bill cancelled.")} />}
      {admin && voiding && <VoidSheet open={sheet === "void"} payment={voiding} onClose={() => setSheet(null)} onDone={() => done("Payment voided.")} />}
      <DiscountSheet open={sheet === "discount"} bill={b} onClose={() => setSheet(null)} onDone={() => done("Bill settled.")} />
      {admin && voidingDiscount && (
        <ReasonSheet
          open={sheet === "void-discount"}
          title={`Void discount of ${formatRupees(voidingDiscount.amount_paise)}?`}
          subtitle="The amount becomes due again. The discount stays on record, crossed out."
          submitLabel="Void discount"
          onClose={() => setSheet(null)}
          send={async (reason) => {
            await api<Bill>(`/discounts/${voidingDiscount.id}/void`, { method: "POST", body: { reason } });
            done("Discount voided.");
          }}
        />
      )}
      <WhatsAppSheet open={sheet === "whatsapp"} bill={b} org={org} onClose={() => setSheet(null)} />
    </>
  );
}

/* ====================================================================== */

type SettleAs = "credit_note" | "discount";

/** Last day a GST credit note can still reduce the GST of a financial year's bills: 30 November after it ends. */
const creditNoteDeadline = (fyStart: number) => `${fyStart + 1}-11-30`;

/** Fee + GST inside a GST-inclusive amount, adding up exactly (same maths as the server). */
function splitInclusive(total: number, ratePercent: number) {
  const rateBp = Math.round(ratePercent * 100);
  const subtotal = Math.round((total * 10000) / (10000 + rateBp));
  return { subtotal, gst: total - subtotal };
}

/** Whether a credit note is possible for this bill today, and the default way to settle. */
function settleDefaults(bill: Bill) {
  const deadline = creditNoteDeadline(bill.fy_start);
  const cnAllowed = bill.gst_rate_percent > 0 && todayISO() <= deadline;
  return { deadline, cnAllowed, defaultAs: (cnAllowed ? "credit_note" : "discount") as SettleAs };
}

/** For a GST bill: settle the shortfall with a credit note (GST goes down) or a plain discount (GST stays). */
function SettleChoice({ bill, amount, value, onChange }: { bill: Bill; amount: number; value: SettleAs; onChange: (v: SettleAs) => void }) {
  if (bill.gst_rate_percent <= 0) return null; // no GST on the bill: a plain discount is all there is
  const { deadline, cnAllowed } = settleDefaults(bill);
  const split = splitInclusive(amount, bill.gst_rate_percent);
  return (
    <div className="stack" style={{ gap: "0.5rem", marginTop: "0.6rem" }} role="radiogroup" aria-label="How to settle">
      <label className="check" style={{ alignItems: "flex-start", opacity: cnAllowed ? 1 : 0.55 }}>
        <input type="radio" name="settle-as" disabled={!cnAllowed} checked={value === "credit_note"} onChange={() => onChange("credit_note")} style={{ marginTop: 3 }} />
        <span>
          <strong style={{ fontWeight: 600 }}>Issue a credit note</strong> (recommended)
          <span className="tiny muted" style={{ display: "block" }}>
            {cnAllowed
              ? `Reduces the GST you owe. Credit note for ${formatRupees(amount)}: fee ${formatRupees(split.subtotal)} + GST ${formatRupees(split.gst)}. Report it in GSTR-1.`
              : `Not possible any more: the last day for credit notes on FY ${fyLabel(bill.fy_start)} bills was ${formatDate(deadline)}.`}
          </span>
        </span>
      </label>
      <label className="check" style={{ alignItems: "flex-start" }}>
        <input type="radio" name="settle-as" checked={value === "discount"} onChange={() => onChange("discount")} style={{ marginTop: 3 }} />
        <span>
          <strong style={{ fontWeight: 600 }}>Discount only</strong>
          <span className="tiny muted" style={{ display: "block" }}>
            Recorded in your books only. The GST charged on the full bill ({formatRupees(bill.gst_paise)}) stays payable.
          </span>
        </span>
      </label>
    </div>
  );
}

function PaymentSheet({ open, bill, onClose, onDone }: { open: boolean; bill: Bill; onClose: () => void; onDone: (b: Bill) => void }) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  // Off by default: nobody assumes the client will pay less. Ticked only when they did and the firm accepts it.
  const [settleRest, setSettleRest] = useState(false);
  const [discountReason, setDiscountReason] = useState("");
  const [settleAs, setSettleAs] = useState<SettleAs>("discount");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);

  // Each time it opens, start from the full balance and today.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setAmount(paiseToInput(Math.max(bill.balance_paise, 0)));
      setPaidOn(todayISO());
      setReference("");
      setNotes("");
      setSettleRest(false);
      setDiscountReason("");
      setSettleAs(settleDefaults(bill).defaultAs);
      setError("");
    }
  }

  const paise = rupeesToPaise(amount);
  const short = paise !== null && paise > 0 && paise < bill.balance_paise ? bill.balance_paise - paise : 0;
  async function submit() {
    if (paise === null || paise <= 0) return setError("Enter the amount received, for example 2500 or 2500.50");
    setBusy(true);
    setError("");
    try {
      onDone(await api<Bill>(`/bills/${bill.id}/payments`, { method: "POST", body: { amount_paise: paise, paid_on: paidOn, method, reference, notes, settle_rest: short > 0 && settleRest, settle_as: settleAs, discount_reason: discountReason } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Record payment" subtitle={`Bill ${bill.bill_no} · balance ${formatRupees(bill.balance_paise)}`} onClose={onClose} onSubmit={submit} submitLabel="Record payment" busy={busy}>
      {error && <Message kind="error">{error}</Message>}
      <div className="grid two">
        <div className="field">
          <label htmlFor="p-amount">Amount received (₹)</label>
          <input id="p-amount" inputMode="decimal" autoFocus maxLength={15} value={amount} onChange={(e) => setAmount(e.target.value)} />
          {short > 0 && !settleRest && <div className="hint">Part payment: {formatRupees(short)} will still be due.</div>}
          {short > 0 && settleRest && (
            <div className="hint">
              Bill settled: {formatRupees(short)} {settleAs === "credit_note" ? "by a credit note" : "recorded as discount"}.
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="p-date">Date received</label>
          <input id="p-date" type="date" max={todayISO()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p-method">How it was paid</label>
          <select id="p-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-ref">Reference (optional)</label>
          <input id="p-ref" maxLength={100} placeholder={method === "cheque" ? "Cheque number" : method === "cash" ? "Receipt number" : "UTR / transaction ID"} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      {short > 0 && (
        <div className="info-box" style={{ display: "block", marginTop: "0.85rem", marginBottom: 0 }}>
          <label className="check" style={{ fontWeight: 500 }}>
            <input type="checkbox" checked={settleRest} onChange={(e) => setSettleRest(e.target.checked)} />
            Client paid less by agreement: settle the bill
          </label>
          <div className="tiny muted" style={{ margin: "0.35rem 0 0 1.6rem" }}>
            {settleRest
              ? `Nothing more will be due. The bill itself keeps its full amount.`
              : `Leave this off if the client will still pay the remaining ${formatRupees(short)} later.`}
          </div>
          {settleRest && (
            <div style={{ marginLeft: "1.6rem" }}>
              <SettleChoice bill={bill} amount={short} value={settleAs} onChange={setSettleAs} />
            </div>
          )}
          {settleRest && (
            <div className="field" style={{ margin: "0.6rem 0 0 1.6rem" }}>
              <label htmlFor="p-disc-reason">Reason (optional, printed on a credit note)</label>
              <input id="p-disc-reason" maxLength={300} placeholder="Client paid less by agreement" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
            </div>
          )}
        </div>
      )}
      <div className="field" style={{ marginTop: "0.85rem" }}>
        <label htmlFor="p-notes">Notes (optional)</label>
        <textarea id="p-notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Sheet>
  );
}

/* ====================================================================== */

function DiscountSheet({ open, bill, onClose, onDone }: { open: boolean; bill: Bill; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [settleAs, setSettleAs] = useState<SettleAs>("discount");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setReason("");
      setSettleAs(settleDefaults(bill).defaultAs);
      setError("");
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api<Bill>(`/bills/${bill.id}/settle`, { method: "POST", body: { settle_as: settleAs, reason: reason.trim() } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={open}
      title={`Settle the remaining ${formatRupees(bill.balance_paise)}?`}
      subtitle={`For when the client has paid ${formatRupees(bill.paid_paise)} and won't pay the rest. Nothing more will be due; the bill itself keeps its full amount.`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Settle bill"
      busy={busy}
    >
      {error && <Message kind="error">{error}</Message>}
      <div className="field">
        <label htmlFor="d-reason">Reason (optional, printed on a credit note)</label>
        <input id="d-reason" autoFocus maxLength={300} placeholder="Client paid less by agreement" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <SettleChoice bill={bill} amount={bill.balance_paise} value={settleAs} onChange={setSettleAs} />
    </Sheet>
  );
}

/* ====================================================================== */

interface CnLine {
  key: number;
  description: string;
  quantity: string;
  price: string;
}
let cnKey = 1;

function CreditNoteSheet({ open, bill, onClose, onDone }: { open: boolean; bill: Bill; onClose: () => void; onDone: (cnNo: string) => void }) {
  const [reason, setReason] = useState("");
  const [cnDate, setCnDate] = useState(todayISO());
  const [lines, setLines] = useState<CnLine[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setReason("");
      setCnDate(todayISO());
      setLines([{ key: cnKey++, description: "", quantity: "1", price: "" }]);
      setError("");
    }
  }

  const parsed = lines.map((l) => ({
    quantity: /^\d+$/.test(l.quantity.trim()) ? Number(l.quantity) : 0,
    unit_price_paise: rupeesToPaise(l.price) ?? 0,
    ok: l.description.trim() !== "" && /^\d+$/.test(l.quantity.trim()) && Number(l.quantity) >= 1 && rupeesToPaise(l.price) !== null,
  }));
  const totals = calculateTotals(parsed, bill.gst_rate_percent);
  const tooMuch = totals.total_paise > bill.balance_paise;
  const update = (key: number, patch: Partial<CnLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function copyItems() {
    setLines(bill.items.map((i) => ({ key: cnKey++, description: i.description, quantity: String(i.quantity), price: paiseToInput(i.unit_price_paise) })));
  }

  async function submit() {
    const bad = parsed.findIndex((p) => !p.ok);
    if (bad >= 0) return setError(`Line ${bad + 1}: needs a description, a whole-number quantity and a valid price`);
    if (tooMuch) return setError(`A credit note can be for at most the unpaid balance (${formatRupees(bill.balance_paise)}).`);
    setBusy(true);
    setError("");
    try {
      const cn = await api<{ cn_no: string }>(`/bills/${bill.id}/credit-notes`, {
        method: "POST",
        body: { reason, cn_date: cnDate, items: lines.map((l, i) => ({ description: l.description, quantity: parsed[i].quantity, unit_price_paise: parsed[i].unit_price_paise })) },
      });
      onDone(cn.cn_no);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      wide
      title="Issue credit note"
      subtitle={`Reduces what is owed on bill ${bill.bill_no} without changing the bill. Up to ${formatRupees(bill.balance_paise)} can be credited.`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Issue credit note"
      busy={busy}
      submitDisabled={reason.trim().length < 3}
    >
      {error && <Message kind="error">{error}</Message>}
      <div className="grid two">
        <div className="field">
          <label htmlFor="cn-reason">Reason (printed on the credit note)</label>
          <input id="cn-reason" autoFocus maxLength={300} placeholder="e.g. Discount agreed, service not provided" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cn-date">Credit note date</label>
          <input id="cn-date" type="date" min={bill.bill_date} max={todayISO()} value={cnDate} onChange={(e) => setCnDate(e.target.value)} />
        </div>
      </div>

      <div className="row between" style={{ margin: "1.1rem 0 0.4rem" }}>
        <h3 style={{ margin: 0 }}>Lines</h3>
        <button type="button" className="link" onClick={copyItems}>
          Copy the bill's items
        </button>
      </div>
      <div className="table-wrap">
        <table className="items-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ width: 80 }}>Qty</th>
              <th style={{ width: 130 }}>Price (₹)</th>
              <th className="num">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} className="item-main">
                <td data-label="Description">
                  <input aria-label={`Description for line ${i + 1}`} maxLength={300} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                </td>
                <td data-label="Qty">
                  <input aria-label={`Quantity for line ${i + 1}`} inputMode="numeric" maxLength={6} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                </td>
                <td data-label="Price (₹)">
                  <input aria-label={`Price for line ${i + 1}`} inputMode="decimal" maxLength={15} value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} />
                </td>
                <td className="num nowrap" data-label="Amount">
                  {parsed[i].ok ? formatRupees(parsed[i].quantity * parsed[i].unit_price_paise) : "–"}
                </td>
                <td>
                  <button type="button" className="link danger" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" style={{ marginTop: "0.6rem" }} onClick={() => setLines((ls) => [...ls, { key: cnKey++, description: "", quantity: "1", price: "" }])}>
        <Icon name="plus" />
        Add line
      </button>
      <div className="totals" style={{ marginTop: "0.75rem" }}>
        <div>
          <span>Subtotal</span>
          <span>{formatRupees(totals.subtotal_paise)}</span>
        </div>
        {bill.gst_rate_percent > 0 && (
          <div>
            <span>GST @ {bill.gst_rate_percent}% (same as the bill)</span>
            <span>{formatRupees(totals.gst_paise)}</span>
          </div>
        )}
        <div className="grand" style={{ color: tooMuch ? "var(--danger)" : undefined }}>
          <span>Credit total</span>
          <span>{formatRupees(totals.total_paise)}</span>
        </div>
      </div>
      {tooMuch && <Message kind="warn">This is more than the unpaid balance of {formatRupees(bill.balance_paise)}. If the client has already paid, void the payment first.</Message>}
    </Sheet>
  );
}

/* ====================================================================== */

function ReasonSheet({ open, title, subtitle, submitLabel, onClose, send }: {
  open: boolean;
  title: string;
  subtitle: string;
  submitLabel: string;
  onClose: () => void;
  send: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setReason("");
      setError("");
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await send(reason);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} title={title} subtitle={subtitle} onClose={onClose} onSubmit={submit} submitLabel={submitLabel} busy={busy} tone="danger" submitDisabled={reason.trim().length < 3}>
      {error && <Message kind="error">{error}</Message>}
      <div className="field">
        <label htmlFor="reason">Reason (kept in the history)</label>
        <input id="reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="hint">At least 3 characters. This can't be undone.</div>
      </div>
    </Sheet>
  );
}

function CancelSheet({ open, bill, onClose, onDone }: { open: boolean; bill: Bill; onClose: () => void; onDone: (b: Bill) => void }) {
  return (
    <ReasonSheet
      open={open}
      title={`Cancel bill ${bill.bill_no}?`}
      subtitle="For a bill issued by mistake. The bill and its number are kept and marked cancelled; the client will owe nothing on it. To reduce a bill instead, issue a credit note."
      submitLabel="Cancel bill"
      onClose={onClose}
      send={async (reason) => onDone(await api<Bill>(`/bills/${bill.id}/cancel`, { method: "POST", body: { reason } }))}
    />
  );
}

function VoidSheet({ open, payment, onClose, onDone }: { open: boolean; payment: Payment; onClose: () => void; onDone: (b: Bill) => void }) {
  return (
    <ReasonSheet
      open={open}
      title={`Void payment of ${formatRupees(payment.amount_paise)}?`}
      subtitle={`Recorded on ${formatDate(payment.paid_on)}. A voided payment stays on record, crossed out, and no longer counts towards the bill.`}
      submitLabel="Void payment"
      onClose={onClose}
      send={async (reason) => onDone(await api<Bill>(`/payments/${payment.id}/void`, { method: "POST", body: { reason } }))}
    />
  );
}

/* ====================================================================== */

function WhatsAppSheet({ open, bill, org, onClose }: { open: boolean; bill: Bill; org: Settings | null; onClose: () => void }) {
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const number = whatsappNumber(bill.client_phone, org?.default_country_code ?? "91");
  const lines = [
    `Dear ${bill.client_name},`,
    "",
    `Please find attached bill ${bill.bill_no} dated ${formatDate(bill.bill_date)} for ${formatRupees(bill.total_paise)}.`,
  ];
  if (bill.state === "open") {
    lines.push(`Balance due: ${formatRupees(bill.balance_paise)}${bill.due_date ? `, by ${formatDate(bill.due_date)}` : ""}.`);
    if (org?.upi_id) lines.push(`UPI: ${org.upi_id}`);
    if (org?.bank_account_number) lines.push(`Bank: ${[org.bank_name, `A/c ${org.bank_account_number}`, org.bank_ifsc && `IFSC ${org.bank_ifsc}`].filter(Boolean).join(", ")}`);
  } else if (bill.state === "paid") {
    lines.push("This bill has been paid in full. Thank you!");
  }
  lines.push("", "Thank you,", org?.org_name ?? "");
  const text = lines.join("\n").trim();
  const link = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

  async function download() {
    setError("");
    setDownloading(true);
    try {
      await downloadFile(`/bills/${bill.id}/pdf`, `Bill ${bill.bill_no}.pdf`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Sheet open={open} title="Send on WhatsApp" subtitle={number ? `To ${bill.client_name} (+${number})` : `${bill.client_name} has no phone number saved, so WhatsApp will ask you to choose the chat.`} onClose={onClose}>
      {error && <Message kind="error">{error}</Message>}
      <ol className="stack" style={{ paddingLeft: "1.2rem", margin: 0 }}>
        <li>
          <div style={{ marginBottom: "0.4rem" }}>Download the bill as a PDF.</div>
          <button type="button" onClick={download} disabled={downloading}>
            <Icon name="download" />
            {downloading ? "Preparing…" : "Download PDF"}
          </button>
        </li>
        <li>
          <div style={{ marginBottom: "0.4rem" }}>Open the chat with this message ready, then attach the PDF.</div>
          <a className="btn primary" href={link} target="_blank" rel="noreferrer">
            <Icon name="message" />
            Open WhatsApp
          </a>
        </li>
      </ol>
      <label style={{ marginTop: "1rem" }}>Message</label>
      <div className="info-box pre small" style={{ display: "block" }}>
        {text}
      </div>
    </Sheet>
  );
}

/* ====================================================================== */

/** The acknowledgement receipt for one payment: view it, or send it to the client by email or on WhatsApp. */
function ReceiptSheet({ open, payment, org, onClose, onEmailed }: { open: boolean; payment: Payment; org: Settings | null; onClose: () => void; onEmailed: (to: string) => void }) {
  const receipt = useLoad(() => (open ? api<Receipt>(`/payments/${payment.id}/receipt`) : Promise.resolve(null)), `${payment.id}|${open}`);
  // The loader keeps the previous receipt while the next one loads: only use it once it is this payment's.
  const r = receipt.data && receipt.data.id === payment.id ? receipt.data : null;
  const [email, setEmail] = useState("");
  const [lastKey, setLastKey] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState<"" | "email" | "download">("");

  // Each time it opens for a receipt, start again with the client's saved email address.
  const key = `${payment.id}|${open}|${r ? "loaded" : ""}`;
  if (key !== lastKey) {
    setLastKey(key);
    setEmail(r?.client_email ?? "");
    if (!r) {
      setError("");
      setSent("");
    }
  }

  const number = whatsappNumber(r?.client_phone ?? null, org?.default_country_code ?? "91");
  const how = r ? (r.method === "cash" ? "in cash" : `by ${methodLabel(r.method)}`) : "";
  const text = r
    ? [
        `Dear ${r.client_name},`,
        "",
        `We acknowledge with thanks the receipt of ${formatRupees(r.amount_paise)} ${how}${r.reference ? ` (ref. ${r.reference})` : ""} on ${formatDate(r.paid_on)} towards bill ${r.bill_no}.`,
        r.kind === "full" ? `Bill ${r.bill_no} is now fully paid.` : `Balance still due on this bill: ${formatRupees(r.balance_after_paise)}.`,
        `Receipt No.: ${r.receipt_no}`,
        "",
        "Thank you,",
        org?.org_name ?? "",
      ]
        .join("\n")
        .trim()
    : "";

  async function view() {
    setError("");
    try {
      await openPdf(`/payments/${payment.id}/receipt.pdf?inline=1`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function download() {
    setError("");
    setBusy("download");
    try {
      await downloadFile(`/payments/${payment.id}/receipt.pdf`, `Receipt ${payment.receipt_no.replace(/\//g, "-")}.pdf`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function sendEmail() {
    setError("");
    setSent("");
    setBusy("email");
    try {
      const res = await api<{ sent_to: string }>(`/payments/${payment.id}/receipt/email`, { method: "POST", body: { to: email.trim() || null } });
      setSent(res.sent_to);
      onEmailed(res.sent_to);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <Sheet
      open={open}
      title={`Receipt ${payment.receipt_no}`}
      subtitle={r ? `${formatRupees(r.amount_paise)} received on ${formatDate(r.paid_on)} · ${r.voided_at ? "void" : r.kind === "full" ? "full payment" : "part payment"}` : "Loading…"}
      onClose={onClose}
    >
      {receipt.error && <Message kind="error">{receipt.error}</Message>}
      {error && <Message kind="error">{error}</Message>}
      {sent && <Message kind="notice">Receipt emailed to {sent}.</Message>}
      {r && (
        <>
          <dl className="facts" style={{ marginTop: 0 }}>
            <dt>Bill {r.bill_no}</dt>
            <dd>{formatRupees(r.bill_total_paise)}</dd>
            {r.reduced_paise > 0 && (
              <>
                <dt>Credit notes / discount</dt>
                <dd>− {formatRupees(r.reduced_paise)}</dd>
              </>
            )}
            {r.received_before_paise > 0 && (
              <>
                <dt>Received earlier</dt>
                <dd>− {formatRupees(r.received_before_paise)}</dd>
              </>
            )}
            <dt>This receipt</dt>
            <dd>− {formatRupees(r.amount_paise)}</dd>
            <hr />
            <dt className="total">Balance due</dt>
            <dd className="total">{formatRupees(r.balance_after_paise)}</dd>
          </dl>
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", margin: "1rem 0" }}>
            <button type="button" onClick={view}>
              <Icon name="pdf" />
              View PDF
            </button>
            <button type="button" onClick={download} disabled={busy === "download"}>
              <Icon name="download" />
              {busy === "download" ? "Preparing…" : "Download PDF"}
            </button>
          </div>
          {r.voided_at ? (
            <Message kind="warn">This payment was voided, so the receipt is marked VOID and can't be sent.</Message>
          ) : (
            <>
              <label htmlFor="r-email">Email the receipt (PDF attached)</label>
              <div className="row" style={{ gap: "0.5rem" }}>
                <input id="r-email" className="grow" type="email" maxLength={200} placeholder="client@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                <button type="button" className="primary" onClick={sendEmail} disabled={busy === "email" || !email.trim()}>
                  {busy === "email" ? "Sending…" : "Send email"}
                </button>
              </div>
              {!r.client_email && <div className="hint">No email address is saved for {r.client_name}: type one, or add it to the client.</div>}

              <label style={{ marginTop: "1.1rem" }}>Or send on WhatsApp</label>
              <div className="tiny muted" style={{ marginBottom: "0.4rem" }}>
                Download the PDF, open the chat with this message ready, then attach the PDF.
              </div>
              <a className="btn" href={`https://wa.me/${number}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
                <Icon name="message" />
                Open WhatsApp{number ? ` (+${number})` : ""}
              </a>
              <div className="info-box pre small" style={{ display: "block", marginTop: "0.75rem" }}>
                {text}
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
