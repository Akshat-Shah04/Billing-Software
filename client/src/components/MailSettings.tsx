import { useEffect, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";
import Message from "./Message";

interface Mail {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_from: string;
  app_url: string;
  smtp_password_set: boolean;
  configured: boolean;
}

/**
 * Settings → Email: the firm's mail server, used to send "forgot password" links to administrators.
 * The saved password is never shown or sent back; leaving the box empty keeps it.
 */
export default function MailSettings() {
  const [m, setM] = useState<Mail | null>(null);
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const here = `${window.location.protocol}//${window.location.host}`;

  useEffect(() => {
    api<Mail>("/settings/mail").then(setM).catch((e: Error) => setError(e.message));
  }, []);
  if (!m) return error ? <Message kind="error">{error}</Message> : null;

  async function save() {
    if (!m) return;
    setBusy("save");
    setMsg("");
    setError("");
    try {
      const body = { ...m, ...(password ? { smtp_password: password } : removePassword ? { smtp_password: "" } : {}) };
      const saved = await api<Mail>("/settings/mail", { method: "PUT", body });
      setM(saved);
      setPassword("");
      setRemovePassword(false);
      setMsg(saved.configured ? "Email settings saved. Send a test email to check them." : "Saved. Add the mail server and the From address to switch email on.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function test() {
    setBusy("test");
    setMsg("");
    setError("");
    try {
      const r = await api<{ sent_to: string }>("/settings/mail/test", { method: "POST" });
      setMsg(`Test email sent to ${r.sent_to}. If it doesn’t arrive, check the spam folder and the settings above.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const set = (patch: Partial<Mail>) => setM({ ...m, ...patch });
  return (
    <>
      <div className="section-label">Email (for “Forgot password”)</div>
      <div className="card">
        {!m.configured && (
          <Message kind="info">
            Not set up yet, so administrators can’t reset a forgotten password by email. Use your email provider’s SMTP details: for Gmail, smtp.gmail.com, port
            587 and an “app password”; for Outlook / Microsoft 365, smtp.office365.com, port 587.
          </Message>
        )}
        {error && <Message kind="error">{error}</Message>}
        {msg && <Message kind="notice">{msg}</Message>}
        <div className="grid two">
          <div className="field">
            <label htmlFor="m-host">Mail server (SMTP)</label>
            <input id="m-host" maxLength={200} placeholder="e.g. smtp.gmail.com" value={m.smtp_host} onChange={(e) => set({ smtp_host: e.target.value.trim() })} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
            <div className="field">
              <label htmlFor="m-port">Port</label>
              <input id="m-port" inputMode="numeric" maxLength={5} value={String(m.smtp_port)} onChange={(e) => set({ smtp_port: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            </div>
            <div className="field">
              <label htmlFor="m-secure">Security</label>
              <select id="m-secure" value={m.smtp_secure ? "ssl" : "starttls"} onChange={(e) => set({ smtp_secure: e.target.value === "ssl", smtp_port: e.target.value === "ssl" ? 465 : 587 })}>
                <option value="starttls">STARTTLS (port 587)</option>
                <option value="ssl">SSL/TLS (port 465)</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="m-user">Username</label>
            <input id="m-user" autoComplete="off" maxLength={200} placeholder="Usually your email address" value={m.smtp_user} onChange={(e) => set({ smtp_user: e.target.value.trim() })} />
          </div>
          <div className="field">
            <label htmlFor="m-pass">Password</label>
            <input
              id="m-pass"
              type="password"
              autoComplete="new-password"
              maxLength={300}
              placeholder={m.smtp_password_set && !removePassword ? "Saved (leave empty to keep it)" : "For Gmail, an app password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {m.smtp_password_set && !password && (
              <label className="check small" style={{ marginTop: "0.35rem" }}>
                <input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} />
                Remove the saved password
              </label>
            )}
          </div>
          <div className="field">
            <label htmlFor="m-from">Send from</label>
            <input id="m-from" maxLength={200} placeholder="e.g. Shah & Associates <billing@yourfirm.in>" value={m.smtp_from} onChange={(e) => set({ smtp_from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="m-url">Address of this software (for links in emails)</label>
            <input id="m-url" maxLength={200} placeholder={here} value={m.app_url} onChange={(e) => set({ app_url: e.target.value.trim() })} />
            <div className="hint">
              The address staff type to open Billing Software.{" "}
              {m.app_url !== here && (
                <button type="button" className="link" style={{ padding: 0, minHeight: 0 }} onClick={() => set({ app_url: here })}>
                  Use {here}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: "1rem" }}>
          <button type="button" onClick={save} disabled={busy !== ""}>
            {busy === "save" ? "Saving…" : "Save email settings"}
          </button>
          <button type="button" onClick={test} disabled={busy !== "" || !m.configured}>
            <Icon name="mail" />
            {busy === "test" ? "Sending…" : "Send test email to me"}
          </button>
        </div>
      </div>
      <p className="section-foot">Used only to send password reset links to administrators. The password is stored on this computer and never shown again.</p>
    </>
  );
}
