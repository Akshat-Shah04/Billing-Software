import { useState } from "react";
import { api } from "../api";
import Icon from "../components/Icon";
import Message from "../components/Message";
import PageHeader from "../components/PageHeader";
import Sheet from "../components/Sheet";
import { useLoad } from "../hooks";
import { formatRupees, paiseToInput, rupeesToPaise } from "../money";
import type { Service } from "../types";

interface Form {
  name: string;
  description: string;
  price: string;
  is_active: boolean;
}
const EMPTY: Form = { name: "", description: "", price: "", is_active: true };

export default function Services() {
  const [showInactive, setShowInactive] = useState(false);
  const { data, error, loading, reload } = useLoad(
    () => api<{ items: Service[] }>(`/services?include_inactive=${showInactive}`),
    String(showInactive),
  );

  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  function open(s: Service | "new") {
    setEditing(s);
    setForm(s === "new" ? EMPTY : { name: s.name, description: s.description ?? "", price: paiseToInput(s.price_paise), is_active: s.is_active });
    setFormError("");
  }

  async function save() {
    const price_paise = rupeesToPaise(form.price);
    if (price_paise === null) {
      setFormError("Price must be an amount like 2500 or 2500.50");
      return;
    }
    setSaving(true);
    setFormError("");
    const body = { name: form.name, description: form.description, price_paise, is_active: form.is_active };
    try {
      if (editing === "new") await api("/services", { method: "POST", body });
      else if (editing) await api(`/services/${editing.id}`, { method: "PUT", body });
      setEditing(null);
      reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Services" subtitle="The work you bill for, with a default price and the description printed on bills.">
        <button className="primary" onClick={() => open("new")}>
          <Icon name="plus" />
          Add service
        </button>
      </PageHeader>

      {error && <Message kind="error">{error}</Message>}

      <div className="card flush">
        <div className="filters">
          <label className="check">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive services
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Description</th>
                <th className="num">Default price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((s) => (
                <tr key={s.id} className={s.is_active ? "" : "dim"}>
                  <td>
                    <strong style={{ fontWeight: 600 }}>{s.name}</strong> {!s.is_active && <span className="badge neutral">Inactive</span>}
                  </td>
                  <td className="muted small pre">{s.description}</td>
                  <td className="num">{formatRupees(s.price_paise)}</td>
                  <td className="right">
                    <button className="link" onClick={() => open(s)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    {loading ? "Loading…" : (
                      <div className="empty">
                        <strong>No services yet</strong>
                        Add the services you offer so bills fill in prices and descriptions for you.
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet
        open={editing !== null}
        title={editing === "new" ? "Add service" : `Edit ${typeof editing === "object" && editing ? editing.name : ""}`}
        subtitle="Changing a service never changes bills already made."
        onClose={() => setEditing(null)}
        onSubmit={save}
        submitLabel={editing === "new" ? "Add service" : "Save"}
        busy={saving}
        submitDisabled={!form.name.trim() || !form.price.trim()}
      >
        {formError && <Message kind="error">{formError}</Message>}
        <div className="grid two">
          <div className="field">
            <label htmlFor="s-name">Name</label>
            <input id="s-name" autoFocus maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="s-price">Default price (₹)</label>
            <input id="s-price" inputMode="decimal" maxLength={15} placeholder="e.g. 2500" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>
        </div>
        <div className="field" style={{ marginTop: "0.85rem" }}>
          <label htmlFor="s-desc">Description, printed under the item on bills</label>
          <textarea id="s-desc" rows={3} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <label className="check" style={{ marginTop: "0.85rem" }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Active (can be added to new bills)
        </label>
      </Sheet>
    </>
  );
}
