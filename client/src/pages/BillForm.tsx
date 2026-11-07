import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, qs } from "../api";
import Icon from "../components/Icon";
import Message from "../components/Message";
import PageHeader from "../components/PageHeader";
import { useDebounced } from "../hooks";
import { calculateTotals, formatDate, formatRupees, fyLabel, fyStartOf, paiseToInput, rupeesToPaise, todayISO } from "../money";
import type { Bill, Client, Page, Service, Settings } from "../types";

interface Row {
  key: number;
  service_id: number | null;
  description: string;
  details: string; // the service's description, copied onto the line (editable for this bill only)
  quantity: string; // not shown any more (always 1 on new lines); kept so older bills with a quantity save unchanged
  /** The line's financial year; null = the same as the bill's. */
  fy: number | null;
  price: string; // rupees, as typed
}

let nextKey = 1;

/** The oldest financial year offered in the dropdown (2000 = FY 2000-01), for entering old bills. */
const FIRST_FY = 2000;

/** "2026-11-05" + 15 days -> "2026-11-20" (calendar maths in UTC, so daylight saving never shifts a day). */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const blankRow = (): Row => ({ key: nextKey++, service_id: null, description: "", details: "", quantity: "1", price: "", fy: null });

export default function BillForm() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientName, setClientName] = useState("");
  const [picking, setPicking] = useState(true);
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [date, setDate] = useState(todayISO());
  // The financial year the bill belongs to. Chosen separately: it is NOT worked out from the bill date
  // (a bill made today can be for an earlier year's work, and old bills can be entered later).
  const currentFy = fyStartOf(todayISO())!;
  const [fyStart, setFyStart] = useState(currentFy);
  const [dueDate, setDueDate] = useState("");
  // New bills: the due date follows the bill date (date + payment terms) until the user picks one themselves.
  const [dueTouched, setDueTouched] = useState(false);
  const [termsDays, setTermsDays] = useState(15);
  const [locked, setLocked] = useState(false);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [rate, setRate] = useState(0);
  const [billNo, setBillNo] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Load services, plus either the bill being edited or the current GST setting.
  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const svc = await api<{ items: Service[] }>("/services");
        if (!current) return;
        setServices(svc.items);
        if (editId) {
          const bill = await api<Bill>(`/bills/${editId}`);
          if (!current) return;
          setClientId(bill.client_id);
          setClientName(bill.client_name);
          setPicking(false);
          setDate(bill.bill_date);
          setFyStart(bill.fy_start);
          setDueDate(bill.due_date ?? "");
          setDueTouched(true);
          setLocked(bill.amounts_locked);
          setNotes(bill.notes ?? "");
          setRate(bill.gst_rate_percent); // an existing bill keeps its own rate
          setBillNo(bill.bill_no);
          setRows(
            bill.items.map((i) => ({
              key: nextKey++,
              service_id: i.service_id,
              description: i.description,
              details: i.details ?? "",
              quantity: String(i.quantity),
              price: paiseToInput(i.unit_price_paise),
              fy: i.fy_start === bill.fy_start ? null : i.fy_start,
            })),
          );
        } else {
          const s = await api<Settings>("/settings");
          if (current) {
            setRate(s.gst_enabled ? s.gst_rate_percent : 0);
            setTermsDays(s.payment_terms_days);
          }
        }
        setReady(true);
      } catch (e) {
        if (current) setError((e as Error).message);
      }
    })();
    return () => {
      current = false;
    };
  }, [editId]);

  // Client picker: search as the user types.
  const debouncedSearch = useDebounced(clientSearch);
  useEffect(() => {
    if (!picking) return;
    let current = true;
    api<Page<Client>>(`/clients${qs({ q: debouncedSearch, limit: 8 })}`)
      .then((r) => current && setClientResults(r.items))
      .catch(() => current && setClientResults([]));
    return () => {
      current = false;
    };
  }, [debouncedSearch, picking]);

  const parsed = useMemo(
    () =>
      rows.map((r) => {
        const quantity = /^\d+$/.test(r.quantity.trim()) ? Number(r.quantity) : 0;
        const unit_price_paise = rupeesToPaise(r.price);
        return { quantity, unit_price_paise, valid: quantity >= 1 && unit_price_paise !== null && r.description.trim() !== "" };
      }),
    [rows],
  );
  const totals = useMemo(
    () => calculateTotals(parsed.map((p) => ({ quantity: p.quantity, unit_price_paise: p.unit_price_paise ?? 0 })), rate),
    [parsed, rate],
  );

  // Years to choose from: next year (advance billing), this year, and every year back to FIRST_FY, newest first.
  const fyOptions = Array.from({ length: currentFy + 2 - FIRST_FY }, (_, i) => currentFy + 1 - i);
  if (!fyOptions.includes(fyStart)) fyOptions.push(fyStart);
  const autoDue = /^\d{4}-\d{2}-\d{2}$/.test(date) ? addDays(date, termsDays) : "";
  const effectiveDue = dueTouched ? dueDate : autoDue;
  const updateRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function chooseService(key: number, value: string) {
    if (!value) return updateRow(key, { service_id: null });
    const s = services.find((x) => x.id === Number(value));
    if (s) updateRow(key, { service_id: s.id, description: s.name, details: s.description ?? "", price: paiseToInput(s.price_paise) });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientId) return setError("Choose a client");
    const bad = parsed.findIndex((p) => !p.valid);
    if (bad >= 0) return setError(`Item ${bad + 1}: needs a description, a whole-number quantity and a valid price`);

    const body = {
      client_id: clientId,
      bill_date: date || null,
      fy_start: fyStart,
      due_date: effectiveDue || null,
      notes,
      items: rows.map((r, i) => ({
        service_id: r.service_id,
        description: r.description,
        details: r.details,
        quantity: parsed[i].quantity,
        unit_price_paise: parsed[i].unit_price_paise,
        fy_start: r.fy ?? fyStart,
      })),
    };
    setSaving(true);
    try {
      const saved = editId
        ? await api<Bill>(`/bills/${editId}`, { method: "PUT", body })
        : await api<Bill>("/bills", { method: "POST", body });
      navigate(`/bills/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  if (!ready) return error ? <Message kind="error">{error}</Message> : <p className="muted">Loading…</p>;

  return (
    <form onSubmit={submit}>
      <Link to={editId ? `/bills/${editId}` : "/bills"} className="back">
        <Icon name="chevronLeft" />
        {editId ? `Bill ${billNo}` : "Bills"}
      </Link>
      <PageHeader title={editId ? `Edit bill ${billNo}` : "New bill"} subtitle={`Financial year ${fyLabel(fyStart)}`}>
        <Link to={editId ? `/bills/${editId}` : "/bills"} className="btn">
          Cancel
        </Link>
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : editId ? "Save changes" : "Create bill"}
        </button>
      </PageHeader>
      {error && <Message kind="error">{error}</Message>}
      {locked && (
        <Message kind="info">
          This bill has payments or credit notes, so its client, date and items are fixed. You can still change the due
          date and notes. To reduce the amount, issue a credit note from the bill page.
        </Message>
      )}

      <div className="card">
        <div className="grid">
          <div className="field" style={{ gridColumn: "1 / -1", maxWidth: 440 }}>
            <label htmlFor="bill-fy">Financial year of this bill</label>
            <select id="bill-fy" disabled={editId !== null} value={fyStart} onChange={(e) => setFyStart(Number(e.target.value))}>
              {fyOptions
                .sort((a, b) => b - a)
                .map((y) => (
                  <option key={y} value={y}>
                    {y}-{y + 1}
                    {y === currentFy ? " (current year)" : y === currentFy + 1 ? " (next year)" : ""}
                  </option>
                ))}
            </select>
            <div className="hint">
              {editId
                ? `This bill belongs to ${fyLabel(fyStart)} and its number is from that year's series, so the year can't be changed.`
                : `Numbered in the ${fyLabel(fyStart)} series (like ${fyLabel(fyStart)}/0001) and listed under ${fyLabel(fyStart)}. The bill date below is separate.`}
            </div>
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label htmlFor="client-search">Client</label>
            {!picking && clientId ? (
              <div className="chosen">
                <strong>{clientName}</strong>
                {!locked && (
                  <button type="button" className="link" onClick={() => setPicking(true)}>
                    Change
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="search">
                  <Icon name="search" />
                  <input id="client-search" autoFocus placeholder="Search by name or phone" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
                </div>
                <div className="picker" aria-label="Matching clients">
                  {clientResults.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => {
                        setClientId(c.id);
                        setClientName(c.name);
                        setPicking(false);
                      }}
                    >
                      {c.name}
                      <span className="muted small"> {[c.phone, c.city].filter(Boolean).join(" · ")}</span>
                    </button>
                  ))}
                  {clientResults.length === 0 && (
                    <div className="muted small" style={{ padding: ".6rem .75rem" }}>
                      No clients found. <Link to="/clients">Add one first</Link>.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="field">
            <label htmlFor="bill-date">Bill date</label>
            <input id="bill-date" type="date" disabled={locked} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="due-date">Due date</label>
            <input
              id="due-date"
              type="date"
              min={date}
              value={effectiveDue}
              onChange={(e) => {
                setDueTouched(true);
                setDueDate(e.target.value);
              }}
            />
            <div className="hint">
              {!dueTouched && !editId ? `${termsDays} days after the bill date (your usual terms)` : effectiveDue ? `Due ${formatDate(effectiveDue)}` : "No due date"}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Items</h2>
        <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>Service</th>
                <th style={{ minWidth: 200 }}>Item name</th>
                <th style={{ width: 130 }}>Financial year</th>
                <th style={{ width: 130 }}>Price (₹)</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={r.key}>
                  <tr className="item-main">
                    <td data-label="Service">
                      <select
                        aria-label={`Service for item ${i + 1}`}
                        disabled={locked}
                        value={services.some((s) => s.id === r.service_id) ? String(r.service_id) : ""}
                        onChange={(e) => chooseService(r.key, e.target.value)}
                      >
                        <option value="">Custom item</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Item name">
                      <input aria-label={`Item name for item ${i + 1}`} disabled={locked} placeholder="e.g. GST Return Filing" maxLength={300} value={r.description} onChange={(e) => updateRow(r.key, { description: e.target.value })} />
                    </td>
                    <td data-label="Financial year">
                      <select aria-label={`Financial year for item ${i + 1}`} disabled={locked} value={r.fy ?? fyStart} onChange={(e) => updateRow(r.key, { fy: Number(e.target.value) === fyStart ? null : Number(e.target.value) })}>
                        {[...new Set([...fyOptions, r.fy ?? fyStart])]
                          .sort((a, b) => b - a)
                          .map((y) => (
                            <option key={y} value={y}>
                              {fyLabel(y)}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td data-label="Price (₹)">
                      <input aria-label={`Price for item ${i + 1}`} disabled={locked} inputMode="decimal" maxLength={15} value={r.price} onChange={(e) => updateRow(r.key, { price: e.target.value })} />
                      {r.quantity.trim() !== "1" && <div className="hint">× {r.quantity} (from the original bill)</div>}
                    </td>
                    <td className="num nowrap" data-label="Amount">
                      {parsed[i].valid ? formatRupees(parsed[i].quantity * (parsed[i].unit_price_paise ?? 0)) : "–"}
                    </td>
                    <td>
                      {!locked && (
                        <button type="button" className="link danger" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                  <tr className="item-desc">
                    <td colSpan={6}>
                      <label htmlFor={`item-desc-${r.key}`}>Description, printed under the item</label>
                      <textarea
                        id={`item-desc-${r.key}`}
                        rows={2}
                        maxLength={500}
                        disabled={locked}
                        placeholder="What is included. Filled in from the service; you can change it for this bill."
                        value={r.details}
                        onChange={(e) => updateRow(r.key, { details: e.target.value })}
                      />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {!locked && (
          <button type="button" style={{ marginTop: ".75rem" }} onClick={() => setRows((rs) => [...rs, blankRow()])}>
            <Icon name="plus" />
            Add item
          </button>
        )}

        <div className="totals" style={{ marginTop: "1rem" }}>
          <div>
            <span>Subtotal</span>
            <span>{formatRupees(totals.subtotal_paise)}</span>
          </div>
          {rate > 0 && (
            <div>
              <span>GST @ {rate}%</span>
              <span>{formatRupees(totals.gst_paise)}</span>
            </div>
          )}
          <div className="grand">
            <span>Total</span>
            <span>{formatRupees(totals.total_paise)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="notes">Notes, printed on the bill</label>
          <textarea id="notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </form>
  );
}
