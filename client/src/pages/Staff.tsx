import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useLoad } from "../hooks";
import type { User } from "../types";

const EMPTY = { username: "", full_name: "", password: "", role: "staff" as User["role"] };

export default function Staff() {
  const { user: me } = useAuth();
  const { data, error, reload } = useLoad(() => api<{ items: User[] }>("/users"), "users");
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    setMessage("");
    try {
      await api("/users", { method: "POST", body: form });
      setMessage(`Account "${form.username.trim().toLowerCase()}" created. Share the password with them privately.`);
      setForm(EMPTY);
      reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function patch(u: User, body: object, done: string) {
    setActionError("");
    setMessage("");
    try {
      await api(`/users/${u.id}`, { method: "PATCH", body });
      setMessage(done);
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  function resetPassword(u: User) {
    const password = window.prompt(`New password for ${u.username} (at least 8 characters):`);
    if (password) patch(u, { password }, `Password changed for ${u.username}.`);
  }

  return (
    <>
      <h1>Staff</h1>

      <form className="card" onSubmit={create}>
        <h2>Create account</h2>
        {formError && <div className="error">{formError}</div>}
        <div className="grid">
          <div className="field">
            <label htmlFor="u-name">Full name *</label>
            <input id="u-name" maxLength={100} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="u-user">Username *</label>
            <input id="u-user" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={30} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="u-pass">Password * (8+ characters)</label>
            <input id="u-pass" type="password" autoComplete="new-password" maxLength={100} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="u-role">Role</label>
            <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User["role"] })}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <button className="primary" style={{ marginTop: "1rem" }} disabled={saving || !form.username || !form.full_name || form.password.length < 8}>
          {saving ? "Creating…" : "Create account"}
        </button>
      </form>

      <div className="card">
        {message && <div className="notice">{message}</div>}
        {(error || actionError) && <div className="error">{error || actionError}</div>}
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
                  <td>{u.full_name}</td>
                  <td>{u.username}</td>
                  <td>{u.role}</td>
                  <td>{u.is_active ? <span className="badge ok">active</span> : <span className="badge warn">deactivated</span>}</td>
                  <td className="right nowrap">
                    <button className="link" onClick={() => resetPassword(u)}>
                      Reset password
                    </button>
                    {u.id !== me?.id &&
                      (u.is_active ? (
                        <button className="link danger" onClick={() => window.confirm(`Deactivate ${u.full_name}? They will be logged out and unable to log in.`) && patch(u, { is_active: false }, `${u.full_name} deactivated.`)}>
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
    </>
  );
}
