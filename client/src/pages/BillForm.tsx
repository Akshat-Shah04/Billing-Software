import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, qs } from "../api";
import { useDebounced } from "../hooks";
import { calculateTotals, formatRupees, fyLabel, fyStartOf, paiseToInput, rupeesToPaise, todayISO } from "../money";
import type { Bill, Client, Page, Service, Settings } from "../types";

interface Row {
  key: number;
  service_id: number | null;
  description: string;
  details: string; // the service's description, copied onto the line (editable for this bill only)
  quantity: string;
  price: string; // rupees, as typed
}

let nextKey = 1;
const blankRow = (): Row => ({ key: nextKey++, service_id: null, description: "", details: "", quantity: "1", price: "" });

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
            })),
          );
        } else {
          const s = await api<Settings>("/settings");
          if (current) setRate(s.gst_enabled ? s.gst_rate_percent : 0);
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

  const fy = fyStartOf(date);
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
      notes,
      items: rows.map((r, i) => ({
        service_id: r.service_id,
        description: r.description,
        details: r.details,
        quantity: parsed[i].quantity,
        unit_price_paise: parsed[i].unit_price_paise,
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

  if (!ready) return error ? <div className="error">{error}</div> : <p>Loading…</p>;

  return (
    <form onSubmit={submit}>
      <h1>{editId ? `Edit bill ${billNo}` : "Create bill"}</h1>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="grid">
          <div className="field">
            <label>Client *</label>
            {!picking && clientId ? (
              <div className="row">
                <strong>{clientName}</strong>
                <button type="button" className="link" onClick={() => setPicking(true)}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <input autoFocus placeholder="Search client by name or phone" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
                <div className="picker">
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
                  {clientResults.length === 0 && <div className="muted small" style={{ padding: ".5rem" }}>No clients found. <Link to="/clients">Add one first</Link>.</div>}
                </div>
              </>
            )}
          </div>
          <div className="field">
            <label htmlFor="bill-date">
              Bill date{fy !== null && <strong> · Financial year {fyLabel(fy)}</strong>}
            </label>
            <input id="bill-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Items</h2>
        <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>Service (optional)</th>
                <th style={{ minWidth: 200 }}>Item name</th>
                <th style={{ width: 80 }}>Qty</th>
                <th style={{ width: 130 }}>Price (₹)</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={r.key}>
                <tr className="item-main">
                  <td data-label="Service (optional)">
                    <select
                      aria-label={`Service for item ${i + 1}`}
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
                    <input aria-label={`Item name for item ${i + 1}`} placeholder="e.g. GST Return Filing" maxLength={300} value={r.description} onChange={(e) => updateRow(r.key, { description: e.target.value })} />
                  </td>
                  <td data-label="Qty">
                    <input aria-label={`Quantity for item ${i + 1}`} inputMode="numeric" maxLength={6} value={r.quantity} onChange={(e) => updateRow(r.key, { quantity: e.target.value })} />
                  </td>
                  <td data-label="Price (₹)">
                    <input aria-label={`Price for item ${i + 1}`} inputMode="decimal" maxLength={15} value={r.price} onChange={(e) => updateRow(r.key, { price: e.target.value })} />
                  </td>
                  <td className="num nowrap" data-label="Amount">{parsed[i].valid ? formatRupees(parsed[i].quantity * (parsed[i].unit_price_paise ?? 0)) : "–"}</td>
                  <td>
                    <button type="button" className="link danger" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      Remove
                    </button>
                  </td>
                </tr>
                <tr className="item-desc">
                  <td colSpan={6}>
                    <label htmlFor={`item-desc-${r.key}`}>
                      Description for item {i + 1}
                      <span className="muted small"> (printed under the item on the bill; filled in from the service, and you can edit it)</span>
                    </label>
                    <textarea
                      id={`item-desc-${r.key}`}
                      aria-label={`Description for item ${i + 1}`}
                      rows={2}
                      maxLength={500}
                      placeholder="Describe the work for this item, e.g. what is included"
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
        <button type="button" style={{ marginTop: ".75rem" }} onClick={() => setRows((rs) => [...rs, blankRow()])}>
          + Add item
        </button>

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
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="row">
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : editId ? "Save changes" : "Create bill"}
        </button>
        <Link to={editId ? `/bills/${editId}` : "/bills"} className="btn">
          Cancel
        </Link>
      </div>
    </form>
  );
}
