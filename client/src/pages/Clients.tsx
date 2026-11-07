import { useState, type FormEvent } from "react";
import { api, qs } from "../api";
import Pager from "../components/Pager";
import { useDebounced, useLoad } from "../hooks";
import type { Client, Page } from "../types";

const EMPTY = { name: "", phone: "", email: "", city: "", address: "", pan: "", gstin: "", referred_by: "" };
type Form = typeof EMPTY;

const fieldsOf = (c: Client): Form => ({
  name: c.name,
  phone: c.phone ?? "",
  email: c.email ?? "",
  city: c.city ?? "",
  address: c.address ?? "",
  pan: c.pan ?? "",
  gstin: c.gstin ?? "",
  referred_by: c.referred_by ?? "",
});

// The same limits the server enforces, so you cannot type past them and find out only when saving.
const LIMITS: Record<keyof Form, number> = {
  name: 150, phone: 20, email: 150, city: 100, pan: 10, gstin: 15, referred_by: 150, address: 300,
};

const LABELS: [keyof Form, string][] = [
  ["name", "Name *"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["city", "City"],
  ["pan", "PAN"],
  ["gstin", "GSTIN"],
  ["referred_by", "Referred by"],
  ["address", "Address"],
];

export default function Clients() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showDeleted, setShowDeleted] = useState(false);
  const q = useDebounced(search);

  const { data, error, loading, reload } = useLoad(
    () => api<Page<Client>>(`/clients${qs({ q, page, include_deleted: showDeleted })}`),
    `${q}|${page}|${showDeleted}`,
  );

  // `editing`: null = form closed, "new" = adding, otherwise the client being edited
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  function open(c: Client | "new") {
    setEditing(c);
    setForm(c === "new" ? EMPTY : fieldsOf(c));
    setFormError("");
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (editing === "new") await api("/clients", { method: "POST", body: form });
      else if (editing) await api(`/clients/${editing.id}`, { method: "PUT", body: form });
      setEditing(null);
      reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Client) {
    if (!window.confirm(`Delete ${c.name}? Their old bills are kept, and you can restore them later.`)) return;
    setActionError("");
    try {
      await api(`/clients/${c.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function restore(c: Client) {
    setActionError("");
    try {
      await api(`/clients/${c.id}/restore`, { method: "POST" });
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  return (
    <>
      <div className="row between">
        <h1>Clients</h1>
        <button className="primary" onClick={() => open("new")}>
          Add client
        </button>
      </div>

      {editing && (
        <form className="card" onSubmit={save}>
          <h2>{editing === "new" ? "Add client" : `Edit ${editing.name}`}</h2>
          {editing !== "new" && editing.folder_name && (
            <p className="muted small">
              Files folder on this PC: <strong>{editing.folder_name}</strong>
            </p>
          )}
          {formError && <div className="error">{formError}</div>}
          <div className="grid">
            {LABELS.map(([key, label]) => (
              <div className="field" key={key}>
                <label htmlFor={`c-${key}`}>{label}</label>
                <input id={`c-${key}`} maxLength={LIMITS[key]} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: "1rem" }}>
            <button className="primary" disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: ".75rem" }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <input
              placeholder="Search by name, phone or referred by"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => {
                setShowDeleted(e.target.checked);
                setPage(1);
              }}
            />
            Show deleted
          </label>
        </div>
        {(error || actionError) && <div className="error">{error || actionError}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>City</th>
                <th>GSTIN</th>
                <th>Referred by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((c) => (
                <tr key={c.id} className={c.is_deleted ? "dim" : ""}>
                  <td>
                    {c.name} {c.is_deleted && <span className="badge warn">deleted</span>}
                  </td>
                  <td className="nowrap">{c.phone}</td>
                  <td>{c.city}</td>
                  <td>{c.gstin}</td>
                  <td>{c.referred_by}</td>
                  <td className="right nowrap">
                    {c.is_deleted ? (
                      <button className="link" onClick={() => restore(c)}>
                        Restore
                      </button>
                    ) : (
                      <>
                        <button className="link" onClick={() => open(c)}>
                          Edit
                        </button>
                        <button className="link danger" onClick={() => remove(c)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    {loading ? "Loading…" : "No clients found."}
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
