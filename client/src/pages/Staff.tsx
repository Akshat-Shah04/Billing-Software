import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import Message from "../components/Message";
import PageHeader from "../components/PageHeader";
import Sheet from "../components/Sheet";
import { useLoad } from "../hooks";
import type { User } from "../types";

const EMPTY = { username: "", full_name: "", password: "", role: "staff" as User["role"], email: "" };

export default function Staff() {
  const { user: me } = useAuth();
  const { data, error, reload } = useLoad(() => api<{ items: User[] }>("/users"), "users");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [resetting, setResetting] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ full_name: "", email: "" });
  const [newPassword, setNewPassword] = useState("");
  const [sheetError, setSheetError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  async function create() {
    setSaving(true);
    setSheetError("");
    try {
      await api("/users", { method: "POST", body: form });
      setMessage(`Account "${form.username.trim().toLowerCase()}" created. Share the password with them privately.`);
      setCreating(false);
      reload();
    } catch (err) {
      setSheetError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function patch(u: User, body: object, done: string): Promise<boolean> {
    setActionError("");
    setMessage("");
    try {
      await api(`/users/${u.id}`, { method: "PATCH", body });
      setMessage(done);
      reload();
      return true;
    } catch (err) {
      setActionError((err as Error).message);
      return false;
    }
  }

  async function saveUser() {
    if (!editingUser) return;
    setSaving(true);
    setSheetError("");
    try {
      await api(`/users/${editingUser.id}`, { method: "PATCH", body: editForm });
      setMessage(`${editForm.full_name.trim()} saved.`);
      setEditingUser(null);
      reload();
    } catch (err) {
      setSheetError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    if (!resetting) return;
    setSaving(true);
    setSheetError("");
    try {
      await api(`/users/${resetting.id}`, { method: "PATCH", body: { password: newPassword } });
      setMessage(`Password changed for ${resetting.username}.`);
      setResetting(null);
    } catch (err) {
      setSheetError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Staff" subtitle="Accounts that can log in. Admins can also change settings and cancel bills.">
        <button
          className="primary"
          onClick={() => {
            setForm(EMPTY);
            setSheetError("");
            setCreating(true);
          }}
        >
          <Icon name="plus" />
          New account
        </button>
      </PageHeader>

      {message && <Message kind="notice">{message}</Message>}
      {(error || actionError) && <Message kind="error">{error || actionError}</Message>}

      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((u) => (
                <tr key={u.id} className={u.is_active ? "" : "dim"}>
                  <td>
                    <strong style={{ fontWeight: 600 }}>{u.full_name}</strong>
                    {u.id === me?.id && <span className="muted tiny"> (you)</span>}
                    {u.email && <div className="muted tiny">{u.email}</div>}
                    {u.role === "admin" && !u.email && <div className="tiny" style={{ color: "var(--warn)" }}>No email: can’t use “Forgot password”</div>}
                  </td>
                  <td>{u.username}</td>
                  <td style={{ textTransform: "capitalize" }}>{u.role}</td>
                  <td>{u.is_active ? <span className="badge ok">Active</span> : <span className="badge neutral">Deactivated</span>}</td>
                  <td className="right nowrap">
                    <button
                      className="link"
                      onClick={() => {
                        setEditForm({ full_name: u.full_name, email: u.email ?? "" });
                        setSheetError("");
                        setEditingUser(u);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="link"
                      onClick={() => {
                        setNewPassword("");
                        setSheetError("");
                        setResetting(u);
                      }}
                    >
                      Reset password
                    </button>
                    {u.id !== me?.id &&
                      (u.is_active ? (
                        <button className="link danger" onClick={() => window.confirm(`Deactivate ${u.full_name}?\n\nThey are logged out at once and can't log in until reactivated.`) && patch(u, { is_active: false }, `${u.full_name} deactivated.`)}>
                          Deactivate
                        </button>
                      ) : (
                        <button className="link" onClick={() => patch(u, { is_active: true }, `${u.full_name} reactivated.`)}>
                          Reactivate
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet
        open={creating}
        title="New account"
        subtitle="Give the password to the person privately. They can't change it themselves, but you can reset it any time."
        onClose={() => setCreating(false)}
        onSubmit={create}
        submitLabel="Create account"
        busy={saving}
        submitDisabled={!form.username || !form.full_name || form.password.length < 8}
      >
        {sheetError && <Message kind="error">{sheetError}</Message>}
        <div className="grid two">
          <div className="field">
            <label htmlFor="u-name">Full name</label>
            <input id="u-name" autoFocus maxLength={100} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="u-user">Username</label>
            <input id="u-user" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={30} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <div className="hint">Lowercase letters, numbers, dot, dash or underscore.</div>
          </div>
          <div className="field">
            <label htmlFor="u-pass">Password</label>
            <input id="u-pass" type="password" autoComplete="new-password" maxLength={100} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <div className="hint">{form.password.length > 0 && form.password.length < 8 ? `${8 - form.password.length} more characters needed` : "At least 8 characters."}</div>
          </div>
          <div className="field">
            <label htmlFor="u-email">Email (optional)</label>
            <input id="u-email" type="email" maxLength={150} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <div className="hint">Administrators need one to use “Forgot password”.</div>
          </div>
          <div className="field">
            <label htmlFor="u-role">Role</label>
            <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User["role"] })}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={editingUser !== null}
        title={`Edit ${editingUser?.full_name ?? ""}`}
        subtitle={editingUser?.role === "admin" ? "A “Forgot password” link is sent to this email address." : "Staff can’t reset their own password; an administrator does it here."}
        onClose={() => setEditingUser(null)}
        onSubmit={saveUser}
        submitLabel="Save"
        busy={saving}
        submitDisabled={!editForm.full_name.trim()}
      >
        {sheetError && <Message kind="error">{sheetError}</Message>}
        <div className="grid two">
          <div className="field">
            <label htmlFor="e-name">Full name</label>
            <input id="e-name" autoFocus maxLength={100} value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="e-email">Email</label>
            <input id="e-email" type="email" maxLength={150} placeholder="name@yourfirm.in" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
          </div>
        </div>
      </Sheet>

      <Sheet
        open={resetting !== null}
        title={`Reset password for ${resetting?.full_name ?? ""}`}
        subtitle="They will need the new password the next time they log in."
        onClose={() => setResetting(null)}
        onSubmit={resetPassword}
        submitLabel="Change password"
        busy={saving}
        submitDisabled={newPassword.length < 8}
      >
        {sheetError && <Message kind="error">{sheetError}</Message>}
        <div className="field">
          <label htmlFor="u-newpass">New password</label>
          <input id="u-newpass" type="password" autoFocus autoComplete="new-password" maxLength={100} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <div className="hint">At least 8 characters.</div>
        </div>
      </Sheet>
    </>
  );
}
