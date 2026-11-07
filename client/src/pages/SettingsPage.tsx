import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { api, apiUpload } from "../api";
import { useLogoUrl } from "../hooks";
import { prepareLogo } from "../logoImage";
import type { Settings } from "../types";

// The same limits the server enforces.
const PAYMENT_LIMITS: Partial<Record<keyof Settings, number>> = {
  bank_account_holder: 150, bank_name: 150, bank_account_number: 30, bank_ifsc: 15, bank_branch: 150, upi_id: 100,
};
const clientFolders = new Intl.PluralRules("en");
const countFolders = (n: number) => `${n} client ${clientFolders.select(n) === "one" ? "folder" : "folders"}`;

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
  const [files, setFiles] = useState<FilesStatus | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState("");
  const [form, setForm] = useState<Settings | null>(null);
  const [rate, setRate] = useState("18");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState("");
  const [logoError, setLogoError] = useState("");
  const logoUrl = useLogoUrl(form?.has_logo, form?.logo_version);

  // The logo is saved the moment it is chosen (it does not wait for "Save settings").
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

  useEffect(() => {
    api<Settings>("/settings")
      .then((s) => {
        setForm(s);
        setRate(String(s.gst_rate_percent));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    api<FilesStatus>("/client-files/status")
      .then(setFiles)
      .catch(() => setFiles(null));
  }, []);

  async function rebuild() {
    setRebuilding(true);
    setRebuildMsg("");
    try {
      const r = await api<FilesStatus & { clients: number }>("/client-files/rebuild", { method: "POST" });
      setFiles(r);
      setRebuildMsg(r.lastError ? "" : `Done: ${countFolders(r.clients)} written.`);
    } catch (err) {
      setRebuildMsg((err as Error).message);
    } finally {
      setRebuilding(false);
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
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const s = await api<Settings>("/settings", { method: "PUT", body: { ...form, gst_rate_percent } });
      setForm(s);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!form) return error ? <div className="error">{error}</div> : <p>Loading…</p>;

  return (
    <form onSubmit={save}>
      <h1>Organisation settings</h1>
      {error && <div className="error">{error}</div>}
      {saved && <div className="notice">Settings saved.</div>}

      <div className="card">
        <h2>Logo</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Shown at the top of every bill. PNG, JPEG or WebP. Large images are shrunk automatically. A logo with a
          transparent or white background looks best.
        </p>
        {logoError && <div className="error">{logoError}</div>}
        {logoMsg && <div className="notice">{logoMsg}</div>}
        <div className="row">
          {logoUrl ? <img className="logo-preview" src={logoUrl} alt="Current logo" /> : <span className="muted">No logo yet.</span>}
          <div className="row">
            <label className="btn" style={{ margin: 0, cursor: logoBusy ? "wait" : "pointer", color: "var(--text)", fontSize: "1rem" }}>
              {logoBusy ? "Working…" : form.has_logo ? "Change logo" : "Upload logo"}
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
                Remove logo
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Firm details (shown on bills)</h2>
        <div className="grid">
          <div className="field">
            <label htmlFor="o-name">Firm name</label>
            <input id="o-name" maxLength={150} value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="o-gstin">Firm GSTIN</label>
            <input id="o-gstin" maxLength={15} value={form.org_gstin} onChange={(e) => setForm({ ...form, org_gstin: e.target.value })} />
          </div>
        </div>
        <div className="field" style={{ marginTop: ".75rem" }}>
          <label htmlFor="o-addr">Address</label>
          <textarea id="o-addr" rows={2} maxLength={300} value={form.org_address} onChange={(e) => setForm({ ...form, org_address: e.target.value })} />
        </div>
      </div>

      <div className="card">
        <h2>Payment details (shown on bills)</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          So your clients know where to pay. Fill in what applies: anything left empty is not printed. If you leave
          everything empty, bills show no payment section.
        </p>
        <div className="grid">
          {PAYMENT_FIELDS.map(([key, label]) => (
            <div className="field" key={key}>
              <label htmlFor={`p-${key}`}>{label}</label>
              <input id={`p-${key}`} maxLength={PAYMENT_LIMITS[key]} value={String(form[key] ?? "")} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="field" style={{ marginTop: ".75rem" }}>
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

      <div className="card">
        <h2>GST</h2>
        <label className="check">
          <input type="checkbox" checked={form.gst_enabled} onChange={(e) => setForm({ ...form, gst_enabled: e.target.checked })} />
          Charge GST on new bills
        </label>
        <div className="field" style={{ marginTop: ".75rem", maxWidth: 200 }}>
          <label htmlFor="o-rate">GST rate (%)</label>
          <input id="o-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <p className="muted small">
          This only affects bills created after you save. Existing bills keep the GST they were created with.
        </p>
      </div>

      {files && (
        <div className="card">
          <h2>Client folders (backup on this PC)</h2>
          {files.enabled ? (
            <>
              <p style={{ marginTop: 0 }}>
                Every client has a folder with their details and a copy of each bill. It is updated automatically
                whenever a client or bill is saved.
              </p>
              <p>
                Location: <strong style={{ wordBreak: "break-all" }}>{files.dir}</strong>
              </p>
              {files.lastError ? (
                <div className="error">
                  The last update failed: {files.lastError}. Bills are still saved in the database. Check that the
                  folder exists, is not full, and can be written to, then press Rebuild.
                </div>
              ) : (
                <p className="muted small">
                  {files.lastSync ? `Last updated ${new Date(files.lastSync).toLocaleString("en-IN")}.` : "Working normally."}
                </p>
              )}
              {rebuildMsg && <div className="notice">{rebuildMsg}</div>}
              <button type="button" onClick={rebuild} disabled={rebuilding}>
                {rebuilding ? "Rebuilding…" : "Rebuild all client folders now"}
              </button>
            </>
          ) : (
            <p className="muted">Client folders are switched off on this server.</p>
          )}
        </div>
      )}

      <button className="primary" disabled={saving}>
        {saving ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
