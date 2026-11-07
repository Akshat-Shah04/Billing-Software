import { useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadFile, qs } from "../api";
import Icon from "../components/Icon";
import Message from "../components/Message";
import PageHeader from "../components/PageHeader";
import Pager from "../components/Pager";
import Sheet from "../components/Sheet";
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

const FIELDS: { key: keyof Form; label: string; type?: string; inputMode?: "tel" | "email"; upper?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone", type: "tel", inputMode: "tel" },
  { key: "email", label: "Email", type: "email", inputMode: "email" },
  { key: "city", label: "City" },
  { key: "pan", label: "PAN", upper: true },
  { key: "gstin", label: "GSTIN", upper: true },
  { key: "referred_by", label: "Referred by" },
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

  // `editing`: null = sheet closed, "new" = adding, otherwise the client being edited
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  function open(c: Client | "new") {
    setEditing(c);
    setForm(c === "new" ? EMPTY : fieldsOf(c));
    setFormError("");
  }

  async function save() {
    setSaving(true);
    setFormError("");
    try {
      if (editing === "new") await api("/clients", { method: "POST", body: form });
      else if (editing) await api(`/clients/${editing.id}`, { method: "PUT", body: form });
      setNotice(editing === "new" ? `${form.name.trim()} added.` : `${form.name.trim()} saved.`);
      setEditing(null);
      reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function act(fn: () => Promise<unknown>, message = "") {
    setActionError("");
    setNotice("");
    try {
      await fn();
      if (message) setNotice(message);
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  const remove = (c: Client) =>
    window.confirm(`Delete ${c.name}?\n\nTheir bills are kept, and you can restore the client later from "Show deleted".`) &&
    act(() => api(`/clients/${c.id}`, { method: "DELETE" }), `${c.name} deleted.`);

  const statement = (c: Client) =>
    act(() => downloadFile(`/exports/statement.csv${qs({ client_id: c.id })}`, `statement-${c.name}.csv`));

  return (
    <>
      <PageHeader title="Clients" subtitle={data ? `${data.total} ${data.total === 1 ? "client" : "clients"}${showDeleted ? ", including deleted" : ""}` : undefined}>
        <button className="primary" onClick={() => open("new")}>
          <Icon name="plus" />
          Add client
        </button>
      </PageHeader>

      {notice && <Message kind="notice">{notice}</Message>}
      {(error || actionError) && <Message kind="error">{error || actionError}</Message>}

      <div className="card flush">
        <div className="filters">
          <div className="search">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search clients"
              placeholder="Search name, phone or referred by"
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
                    <strong style={{ fontWeight: 600 }}>{c.name}</strong> {c.is_deleted && <span className="badge neutral">Deleted</span>}
                    {c.email && <div className="muted tiny">{c.email}</div>}
                  </td>
                  <td className="nowrap">{c.phone}</td>
                  <td>{c.city}</td>
                  <td className="nowrap">{c.gstin}</td>
                  <td>{c.referred_by}</td>
                  <td className="right nowrap">
                    <Link className="link-action" to={`/bills?client_id=${c.id}`}>
                      Bills
                    </Link>
                    <button className="link" onClick={() => statement(c)} title="Download a statement of bills, payments and credit notes (CSV)">
                      Statement
                    </button>
                    {c.is_deleted ? (
                      <button className="link" onClick={() => act(() => api(`/clients/${c.id}/restore`, { method: "POST" }), `${c.name} restored.`)}>
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
                    {loading ? "Loading…" : q ? "No clients match your search." : (
                      <div className="empty">
                        <strong>No clients yet</strong>
                        Add your first client to start billing.
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      </div>

      <Sheet
        open={editing !== null}
        title={editing === "new" ? "Add client" : `Edit ${typeof editing === "object" && editing ? editing.name : ""}`}
        subtitle={typeof editing === "object" && editing?.folder_name ? <>Folder on this PC: <span className="path">{editing.folder_name}</span></> : "Only the name is required."}
        onClose={() => setEditing(null)}
        onSubmit={save}
        submitLabel={editing === "new" ? "Add client" : "Save"}
        busy={saving}
        submitDisabled={!form.name.trim()}
        wide
      >
        {formError && <Message kind="error">{formError}</Message>}
        <div className="grid">
          {FIELDS.map(({ key, label, type, inputMode, upper }) => (
            <div className="field" key={key}>
              <label htmlFor={`c-${key}`}>{label}</label>
              <input
                id={`c-${key}`}
                type={type ?? "text"}
                inputMode={inputMode}
                autoFocus={key === "name"}
                maxLength={LIMITS[key]}
                style={upper ? { textTransform: "uppercase" } : undefined}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: upper ? e.target.value.toUpperCase() : e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="field" style={{ marginTop: "0.85rem" }}>
          <label htmlFor="c-address">Address</label>
          <textarea id="c-address" rows={2} maxLength={LIMITS.address} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
      </Sheet>
    </>
  );
}
