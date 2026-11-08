import { useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadFile, qs } from "../api";
import Icon from "../components/Icon";
import LedgerSheet, { type LedgerTarget } from "../components/LedgerSheet";
import Message from "../components/Message";
import PageHeader from "../components/PageHeader";
import Pager from "../components/Pager";
import Sheet from "../components/Sheet";
import { useDebounced, useLoad } from "../hooks";
import type { Client, ClientGroup, Page } from "../types";

const EMPTY = { name: "", phone: "", email: "", city: "", address: "", pan: "", gstin: "", referred_by: "", file_no: "" };
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
  file_no: c.file_no ?? "",
});

// The same limits the server enforces, so you cannot type past them and find out only when saving.
const LIMITS: Record<keyof Form, number> = {
  name: 150, phone: 10, email: 150, city: 100, pan: 10, gstin: 15, referred_by: 150, address: 300, file_no: 50,
};

const FIELDS: { key: keyof Form; label: string; type?: string; inputMode?: "numeric" | "email"; upper?: boolean; digits?: boolean; placeholder?: string }[] = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Mobile", type: "tel", inputMode: "numeric", digits: true, placeholder: "10 digits" },
  { key: "file_no", label: "File No.", upper: true, placeholder: "e.g. BHAVIK SMS" },
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
  const [groupFilter, setGroupFilter] = useState("");
  const q = useDebounced(search);

  const { data, error, loading, reload } = useLoad(
    () => api<Page<Client>>(`/clients${qs({ q, page, include_deleted: showDeleted, group_id: groupFilter })}`),
    `${q}|${page}|${showDeleted}|${groupFilter}`,
  );
  const [groupsTick, setGroupsTick] = useState(0);
  const groups = useLoad(() => api<{ items: ClientGroup[] }>("/client-groups"), `groups|${groupsTick}`);
  const [ledgerFor, setLedgerFor] = useState<LedgerTarget | null>(null);
  const [managingGroups, setManagingGroups] = useState(false);
  const [formGroup, setFormGroup] = useState("");

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
    setFormGroup(c === "new" ? groupFilter : c.group_id ? String(c.group_id) : "");
    setFormError("");
  }

  async function save() {
    setSaving(true);
    setFormError("");
    try {
      const body = { ...form, group_id: formGroup ? Number(formGroup) : null };
      if (editing === "new") await api("/clients", { method: "POST", body });
      else if (editing) await api(`/clients/${editing.id}`, { method: "PUT", body });
      setGroupsTick((t) => t + 1); // member counts
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
        <button onClick={() => setManagingGroups(true)}>
          <Icon name="clients" />
          Groups
        </button>
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
              placeholder="Search name, mobile, file no. or referred by"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Group"
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All clients</option>
            {groups.data?.items.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.member_count})
              </option>
            ))}
          </select>
          {groupFilter && (
            <button className="tinted" onClick={() => setLedgerFor({ kind: "group", id: Number(groupFilter), name: groups.data?.items.find((g) => String(g.id) === groupFilter)?.name ?? "Group" })}>
              <Icon name="pdf" />
              Group ledger
            </button>
          )}
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
          <table className="table-clients">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile</th>
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
                    {c.group_name && (
                      <div>
                        <button className="link tiny" style={{ padding: 0, minHeight: 0 }} onClick={() => setGroupFilter(String(c.group_id))} title="Show everyone in this group">
                          {c.group_name}
                        </button>
                      </div>
                    )}
                    {(c.file_no || c.email) && <div className="muted tiny">{[c.file_no && `File ${c.file_no}`, c.email].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className="nowrap">{c.phone}</td>
                  <td>{c.city}</td>
                  <td className="nowrap">{c.gstin}</td>
                  <td>{c.referred_by}</td>
                  <td className="right nowrap">
                    <Link className="link-action" to={`/bills?client_id=${c.id}`}>
                      Bills
                    </Link>
                    <button className="link" onClick={() => setLedgerFor({ kind: "client", id: c.id, name: c.name })} title="Ledger account for a period, as a PDF to send to the client">
                      Ledger
                    </button>
                    <button className="link" onClick={() => statement(c)} title="Download a statement of bills, payments and credit notes (CSV)">
                      CSV
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
        submitDisabled={!form.name.trim() || (form.phone !== "" && form.phone.length !== 10)}
        wide
      >
        {formError && <Message kind="error">{formError}</Message>}
        <div className="grid">
          {FIELDS.map(({ key, label, type, inputMode, upper, digits, placeholder }) => (
            <div className="field" key={key}>
              <label htmlFor={`c-${key}`}>{label}</label>
              <input
                id={`c-${key}`}
                type={type ?? "text"}
                inputMode={inputMode}
                autoFocus={key === "name"}
                maxLength={LIMITS[key]}
                placeholder={placeholder}
                style={upper ? { textTransform: "uppercase" } : undefined}
                value={form[key]}
                onChange={(e) =>
                  setForm({ ...form, [key]: digits ? e.target.value.replace(/\D/g, "").slice(0, 10) : upper ? e.target.value.toUpperCase() : e.target.value })
                }
              />
              {digits && form[key] && form[key].length !== 10 && <div className="hint">{10 - form[key].length} more digits needed</div>}
            </div>
          ))}
        </div>
        <div className="field" style={{ marginTop: "0.85rem", maxWidth: 360 }}>
          <label htmlFor="c-group">Group (family)</label>
          <select id="c-group" value={formGroup} onChange={(e) => setFormGroup(e.target.value)}>
            <option value="">No group</option>
            {groups.data?.items.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <div className="hint">For family members and HUFs handled together. Add groups with the Groups button.</div>
        </div>
        <div className="field" style={{ marginTop: "0.85rem" }}>
          <label htmlFor="c-address">Address</label>
          <textarea id="c-address" rows={2} maxLength={LIMITS.address} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
      </Sheet>

      <LedgerSheet target={ledgerFor} onClose={() => setLedgerFor(null)} />
      <GroupsSheet
        open={managingGroups}
        groups={groups.data?.items ?? []}
        onClose={() => setManagingGroups(false)}
        onChanged={() => {
          setGroupsTick((t) => t + 1);
          reload();
        }}
        onShow={(g) => {
          setManagingGroups(false);
          setGroupFilter(String(g.id));
          setPage(1);
        }}
        onLedger={(g) => {
          setManagingGroups(false);
          setLedgerFor({ kind: "group", id: g.id, name: g.name });
        }}
      />
    </>
  );
}

/** Add, rename and remove groups (e.g. families). Removing a group never touches its clients or their bills. */
function GroupsSheet({ open, groups, onClose, onChanged, onShow, onLedger }: {
  open: boolean;
  groups: ClientGroup[];
  onClose: () => void;
  onChanged: () => void;
  onShow: (g: ClientGroup) => void;
  onLedger: (g: ClientGroup) => void;
}) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} wide title="Client groups" subtitle="Group family members (and their HUF) to see them together and send one combined ledger. Each member stays a separate client with their own bills." onClose={onClose}>
      {error && <Message kind="error">{error}</Message>}
      <div className="row" style={{ flexWrap: "nowrap", marginBottom: "1rem" }}>
        <input aria-label="New group name" placeholder="New group, e.g. Shah family" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <button
          type="button"
          className="primary"
          disabled={busy || !name.trim()}
          onClick={async () => (await run(() => api("/client-groups", { method: "POST", body: { name } }))) && setName("")}
        >
          Add group
        </button>
      </div>
      <ul className="list">
        {groups.map((g) => (
          <li key={g.id}>
            <div className="grow">
              {renaming?.id === g.id ? (
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input aria-label="Group name" autoFocus maxLength={100} value={renaming.name} onChange={(e) => setRenaming({ id: g.id, name: e.target.value })} />
                  <button type="button" disabled={busy || !renaming.name.trim()} onClick={async () => (await run(() => api(`/client-groups/${g.id}`, { method: "PUT", body: { name: renaming.name, notes: g.notes } }))) && setRenaming(null)}>
                    Save
                  </button>
                  <button type="button" className="link" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <div className="title">{g.name}</div>
                  <div className="meta">
                    {g.member_count} {g.member_count === 1 ? "client" : "clients"}
                  </div>
                </>
              )}
            </div>
            {renaming?.id !== g.id && (
              <div className="nowrap">
                <button type="button" className="link" onClick={() => onShow(g)}>
                  Show
                </button>
                <button type="button" className="link" onClick={() => onLedger(g)}>
                  Ledger
                </button>
                <button type="button" className="link" onClick={() => setRenaming({ id: g.id, name: g.name })}>
                  Rename
                </button>
                <button
                  type="button"
                  className="link danger"
                  onClick={() =>
                    window.confirm(`Remove the group "${g.name}"?\n\nIts ${g.member_count} clients and all their bills stay exactly as they are; they just won't be grouped.`) &&
                    run(() => api(`/client-groups/${g.id}`, { method: "DELETE" }))
                  }
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
        {!groups.length && <li className="muted small">No groups yet.</li>}
      </ul>
    </Sheet>
  );
}
