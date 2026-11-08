import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { api, apiUpload } from "../api";
import Icon from "../components/Icon";
import Message from "../components/Message";
import PageHeader from "../components/PageHeader";
import { useLogoUrl } from "../hooks";
import { prepareLogo } from "../logoImage";
import type { BackupStatus, Settings } from "../types";

// The same limits the server enforces.
const PAYMENT_LIMITS: Partial<Record<keyof Settings, number>> = {
  bank_account_holder: 150, bank_name: 150, bank_account_number: 30, bank_ifsc: 15, bank_branch: 150, upi_id: 100,
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const when = (t: string | null) => (t ? new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never");

const PAYMENT_FIELDS: [keyof Settings, string][] = [
  ["bank_account_holder", "Account holder name"],
  ["bank_name", "Bank name"],
  ["bank_account_number", "Account number"],
  ["bank_ifsc", "IFSC code"],
  ["bank_branch", "Branch"],
  ["upi_id", "UPI ID"],
];

interface FilesStatus {
  enabled: boolean;
  dir: string | null;
  lastError: string | null;
  lastSync: string | null;
}

export default function SettingsPage() {
  const [form, setForm] = useState<Settings | null>(null);
  const [rate, setRate] = useState("18");
  const [terms, setTerms] = useState("15");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState("");
  const [logoError, setLogoError] = useState("");
  const logoUrl = useLogoUrl(form?.has_logo, form?.logo_version);

  const [files, setFiles] = useState<FilesStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState("");

  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [copyDir, setCopyDir] = useState("");
  const [backupBusy, setBackupBusy] = useState<"" | "save" | "run">("");
  const [backupMsg, setBackupMsg] = useState("");
  const [backupError, setBackupError] = useState("");

  useEffect(() => {
    api<Settings>("/settings")
      .then((s) => {
        setForm(s);
        setRate(String(s.gst_rate_percent));
        setTerms(String(s.payment_terms_days));
      })
      .catch((e: Error) => setError(e.message));
    api<FilesStatus>("/client-files/status").then(setFiles).catch(() => setFiles(null));
    api<BackupStatus>("/backup/status")
      .then((b) => {
        setBackup(b);
        setCopyDir(b.copyDir ?? "");
      })
      .catch(() => setBackup(null));
  }, []);

  // The logo is saved the moment it is chosen (it does not wait for "Save").
  async function chooseLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be chosen again later
    if (!file) return;
    setLogoBusy(true);
    setLogoMsg("");
    setLogoError("");
    try {
      const s = await apiUpload<Settings>("/settings/logo", await prepareLogo(file));
      setForm((f) => (f ? { ...f, has_logo: s.has_logo, logo_version: s.logo_version } : f));
      setLogoMsg("Logo saved. It now appears on every bill.");
    } catch (err) {
      setLogoError((err as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!window.confirm("Remove the logo from all bills?")) return;
    setLogoBusy(true);
    setLogoMsg("");
    setLogoError("");
    try {
      const s = await api<Settings>("/settings/logo", { method: "DELETE" });
      setForm((f) => (f ? { ...f, has_logo: s.has_logo, logo_version: s.logo_version } : f));
      setLogoMsg("Logo removed.");
    } catch (err) {
      setLogoError((err as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function rebuild() {
    setRebuilding(true);
    setRebuildMsg("");
    try {
      const r = await api<FilesStatus & { clients: number }>("/client-files/rebuild", { method: "POST" });
      setFiles(r);
      setRebuildMsg(r.lastError ? "" : `Done: ${plural(r.clients, "client folder", "client folders")} written.`);
    } catch (err) {
      setRebuildMsg((err as Error).message);
    } finally {
      setRebuilding(false);
    }
  }

  async function saveCopyDir() {
    setBackupBusy("save");
    setBackupMsg("");
    setBackupError("");
    try {
      const b = await api<BackupStatus>("/backup/location", { method: "PUT", body: { copy_dir: copyDir } });
      setBackup(b);
      setCopyDir(b.copyDir ?? "");
      setBackupMsg(b.copyDir ? "Second backup location saved. Press Back up now to make the first copy there." : "Second backup location turned off.");
    } catch (err) {
      setBackupError((err as Error).message);
    } finally {
      setBackupBusy("");
    }
  }

  async function runBackup() {
    setBackupBusy("run");
    setBackupMsg("");
    setBackupError("");
    try {
      const r = await api<{ result: { errors: string[] }; status: BackupStatus }>("/backup/run", { method: "POST" });
      setBackup(r.status);
      if (r.result.errors.length) setBackupError(r.result.errors.join(" "));
      else setBackupMsg("Backup finished.");
    } catch (err) {
      setBackupError((err as Error).message);
    } finally {
      setBackupBusy("");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const gst_rate_percent = Number(rate);
    if (rate.trim() === "" || Number.isNaN(gst_rate_percent) || gst_rate_percent < 0 || gst_rate_percent > 100) {
      setError("GST rate must be a number between 0 and 100");
      return;
    }
    const payment_terms_days = Number(terms);
    if (!/^\d{1,3}$/.test(terms.trim()) || payment_terms_days > 365) {
      setError("Payment terms must be a whole number of days, from 0 to 365");
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const s = await api<Settings>("/settings", { method: "PUT", body: { ...form, gst_rate_percent, payment_terms_days } });
      setForm(s);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!form) return error ? <Message kind="error">{error}</Message> : <p className="muted">Loading…</p>;

  return (
    <>
      <form onSubmit={save}>
        <PageHeader title="Settings" subtitle="Your firm's details, what prints on bills, and backups.">
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </PageHeader>
        {error && <Message kind="error">{error}</Message>}
        {saved && <Message kind="notice">Settings saved.</Message>}

        <div className="section-label">Firm</div>
        <div className="card">
          <div className="grid two">
            <div className="field">
              <label htmlFor="o-name">Firm name</label>
              <input id="o-name" maxLength={150} value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="o-gstin">Firm GSTIN</label>
              <input id="o-gstin" maxLength={15} style={{ textTransform: "uppercase" }} value={form.org_gstin} onChange={(e) => setForm({ ...form, org_gstin: e.target.value.toUpperCase() })} />
            </div>
          </div>
          <div className="field" style={{ marginTop: ".85rem" }}>
            <label htmlFor="o-tagline">Line under the firm name</label>
            <input id="o-tagline" maxLength={150} placeholder="e.g. Tax Consultants" value={form.org_tagline} onChange={(e) => setForm({ ...form, org_tagline: e.target.value })} />
          </div>
          <div className="field" style={{ marginTop: ".85rem" }}>
            <label htmlFor="o-addr">Address</label>
            <textarea id="o-addr" rows={2} maxLength={300} value={form.org_address} onChange={(e) => setForm({ ...form, org_address: e.target.value })} />
          </div>
          <div className="grid two" style={{ marginTop: ".85rem" }}>
            <div className="field">
              <label htmlFor="o-mobile">Mobile number</label>
              <input
                id="o-mobile"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10 digits, e.g. 9825176666"
                value={form.org_mobile}
                onChange={(e) => setForm({ ...form, org_mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
              />
              {form.org_mobile && form.org_mobile.length !== 10 && <div className="hint">{10 - form.org_mobile.length} more digits needed</div>}
            </div>
            <div className="field">
              <label htmlFor="o-state">State (with GST state code)</label>
              <input id="o-state" maxLength={60} placeholder="e.g. GUJARAT(24)" style={{ textTransform: "uppercase" }} value={form.org_state} onChange={(e) => setForm({ ...form, org_state: e.target.value.toUpperCase() })} />
            </div>
            <div className="field">
              <label htmlFor="o-signatory">Signatory name</label>
              <input id="o-signatory" maxLength={100} placeholder="Printed under “For, firm name”" value={form.signatory_name} onChange={(e) => setForm({ ...form, signatory_name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="o-juris">Jurisdiction (city)</label>
              <input id="o-juris" maxLength={100} placeholder="e.g. Ahmedabad" value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} />
              <div className="hint">{form.jurisdiction.trim() ? `Bills say “Subject to ${form.jurisdiction.trim()} jurisdiction.”` : "Leave empty to print no jurisdiction line."}</div>
            </div>
          </div>

          <div style={{ marginTop: "1.25rem" }}>
            <label>Logo</label>
            {logoError && <Message kind="error">{logoError}</Message>}
            {logoMsg && <Message kind="notice">{logoMsg}</Message>}
            <div className="row">
              {logoUrl ? <img className="logo-preview" src={logoUrl} alt="Current logo" /> : <span className="muted small">No logo yet.</span>}
              <div className="row">
                <label className="btn" style={{ margin: 0, cursor: logoBusy ? "wait" : "pointer", color: "var(--text)", font: "var(--t-callout)", fontWeight: 500 }}>
                  {logoBusy ? "Working…" : form.has_logo ? "Change logo…" : "Upload logo…"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={chooseLogo}
                    disabled={logoBusy}
                    style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                    aria-label="Choose logo file"
                  />
                </label>
                {form.has_logo && (
                  <button type="button" className="danger" onClick={removeLogo} disabled={logoBusy}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <p className="section-foot">All of these are printed on every bill and PDF. The logo is saved as soon as you choose it. PNG or JPEG (WebP is converted). Large images are shrunk automatically.</p>

        <div className="section-label">Billing</div>
        <div className="card">
          <div className="grid">
            <div className="field">
              <label htmlFor="o-terms">Payment terms (days)</label>
              <input id="o-terms" inputMode="numeric" maxLength={3} value={terms} onChange={(e) => setTerms(e.target.value)} />
              <div className="hint">New bills are due this many days after the bill date.</div>
            </div>
            <div className="field">
              <label htmlFor="o-cc">WhatsApp country code</label>
              <input id="o-cc" inputMode="numeric" maxLength={4} value={form.default_country_code} onChange={(e) => setForm({ ...form, default_country_code: e.target.value.replace(/\D/g, "") })} />
              <div className="hint">Added in front of 10-digit phone numbers. 91 is India.</div>
            </div>
          </div>
          <div style={{ marginTop: "1.1rem", paddingTop: "1rem", borderTop: "0.5px solid var(--separator)" }}>
            <label className="check">
              <input type="checkbox" checked={form.gst_enabled} onChange={(e) => setForm({ ...form, gst_enabled: e.target.checked })} />
              Charge GST on new bills
            </label>
            <div className="field" style={{ marginTop: ".75rem", maxWidth: 200 }}>
              <label htmlFor="o-rate">GST rate (%)</label>
              <input id="o-rate" inputMode="decimal" disabled={!form.gst_enabled} value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>
        </div>
        <p className="section-foot">Changes apply to bills created after you save. Existing bills keep their own GST rate and due date.</p>

        <div className="section-label">Payment details printed on bills</div>
        <div className="card">
          <div className="grid">
            {PAYMENT_FIELDS.map(([key, label]) => (
              <div className="field" key={key}>
                <label htmlFor={`p-${key}`}>{label}</label>
                <input id={`p-${key}`} maxLength={PAYMENT_LIMITS[key]} value={String(form[key] ?? "")} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="field" style={{ marginTop: ".85rem" }}>
            <label htmlFor="p-instructions">Other payment instructions</label>
            <textarea
              id="p-instructions"
              maxLength={500}
              rows={2}
              placeholder="e.g. Cheques in favour of Shah & Associates. Please quote the bill number when paying."
              value={form.payment_instructions}
              onChange={(e) => setForm({ ...form, payment_instructions: e.target.value })}
            />
          </div>
        </div>
        <p className="section-foot">Anything left empty is not printed. If everything is empty, bills show no payment section.</p>
      </form>

      {backup && (
        <>
          <div className="section-label">Backups</div>
          <div className="card">
            {backup.enabled ? (
              <>
                <dl className="facts" style={{ marginBottom: "1rem" }}>
                  <dt>Last backup</dt>
                  <dd>{when(backup.lastRunAt)}</dd>
                  <dt>Kept on this PC in</dt>
                  <dd>
                    <span className="path">{backup.backupDir}</span>
                  </dd>
                  <dt>Second copy</dt>
                  <dd>{backup.copyDir ? when(backup.lastCopyAt) : "not set up"}</dd>
                </dl>
                {!backup.canBackUpDatabase && (
                  <Message kind="info">This server uses a separate PostgreSQL database, which must be backed up with pg_dump. Client folders are still copied.</Message>
                )}
                {backup.lastError && <Message kind="error">The last backup had a problem: {backup.lastError}</Message>}
                {backupError && <Message kind="error">{backupError}</Message>}
                {backupMsg && <Message kind="notice">{backupMsg}</Message>}
                {!backup.copyDir && (
                  <Message kind="warn">
                    Backups are only on this PC. If its disk fails they are lost too. Add a second location below: a USB drive, a
                    network folder, or a OneDrive / Google Drive folder.
                  </Message>
                )}
                <div className="field">
                  <label htmlFor="b-copy">Second backup location</label>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <input id="b-copy" maxLength={500} placeholder="e.g. E:\Billing Backups or \\office-server\backups" value={copyDir} onChange={(e) => setCopyDir(e.target.value)} />
                    <button type="button" onClick={saveCopyDir} disabled={backupBusy !== "" || copyDir === (backup.copyDir ?? "")}>
                      {backupBusy === "save" ? "Checking…" : "Save"}
                    </button>
                  </div>
                  <div className="hint">A full folder path on the computer running Billing Software. Leave empty and save to turn the second copy off.</div>
                </div>
                <button type="button" style={{ marginTop: "1rem" }} onClick={runBackup} disabled={backupBusy !== "" || backup.running}>
                  <Icon name="backup" />
                  {backupBusy === "run" || backup.running ? "Backing up…" : "Back up now"}
                </button>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Automatic backups are not set up on this server.
              </p>
            )}
          </div>
          <p className="section-foot">A backup runs every day automatically. The 14 most recent are kept in each place.</p>
        </>
      )}

      {files && (
        <>
          <div className="section-label">Client folders</div>
          <div className="card">
            {files.enabled ? (
              <>
                <p>Every client has a folder with their details and a copy of each bill, updated whenever a client or bill is saved.</p>
                <p className="small">
                  Location: <span className="path">{files.dir}</span>
                </p>
                {files.lastError ? (
                  <Message kind="error">
                    The last update failed: {files.lastError}. Bills are still saved in the database. Check that the folder exists, is not full,
                    and can be written to, then press Rebuild.
                  </Message>
                ) : (
                  <p className="muted small">{files.lastSync ? `Last updated ${when(files.lastSync)}.` : "Working normally."}</p>
                )}
                {rebuildMsg && <Message kind="notice">{rebuildMsg}</Message>}
                <button type="button" onClick={rebuild} disabled={rebuilding}>
                  <Icon name="folder" />
                  {rebuilding ? "Rebuilding…" : "Rebuild all client folders"}
                </button>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Client folders are switched off on this server.
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
