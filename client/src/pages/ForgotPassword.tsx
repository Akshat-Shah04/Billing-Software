import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import BrandMark from "../components/BrandMark";
import Message from "../components/Message";
import ThemeToggle from "../components/ThemeToggle";

function Frame({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <div className="login-wrap">
      <div className="corner-toggle">
        <ThemeToggle />
      </div>
      <div className="card login-card">
        <BrandMark size={56} />
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        {children}
      </div>
    </div>
  );
}

/** Step 1: ask for the reset link. The reply never says whether the account exists. */
export function ForgotPassword() {
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/forgot", { method: "POST", body: { login } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame title="Forgot password" lede="Administrators can get a link by email to choose a new password.">
      {sent ? (
        <div style={{ textAlign: "left" }}>
          <Message kind="notice">
            If that is an administrator account with an email address, a reset link is on its way. It works once, for 30 minutes. Check the spam folder if it
            doesn’t arrive in a few minutes.
          </Message>
          <Link to="/" className="btn" style={{ width: "100%" }}>
            Back to log in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit}>
          {error && <Message kind="error">{error}</Message>}
          <div className="field" style={{ marginBottom: "1rem" }}>
            <label htmlFor="login">Username or email address</label>
            <input id="login" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={200} value={login} onChange={(e) => setLogin(e.target.value)} />
          </div>
          <button className="primary" style={{ width: "100%", minHeight: 38 }} disabled={busy || !login.trim()}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <p className="small muted" style={{ margin: "1rem 0 0" }}>
            Staff accounts: ask your administrator to reset your password under Staff.
          </p>
          <p className="small" style={{ margin: "0.5rem 0 0", textAlign: "center" }}>
            <Link to="/">Back to log in</Link>
          </p>
        </form>
      )}
    </Frame>
  );
}

/** Step 2: the link from the email opens this page to set the new password. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    setError("");
    try {
      const r = await api<{ username: string }>("/auth/reset", { method: "POST", body: { token, password } });
      setDone(r.username);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Frame title="Reset password" lede="This page needs the link from the reset email.">
        <Link to="/forgot-password" className="btn primary" style={{ width: "100%" }}>
          Ask for a reset link
        </Link>
      </Frame>
    );
  }

  return (
    <Frame title="Choose a new password" lede="At least 8 characters. You will be logged out on other computers.">
      {done ? (
        <div style={{ textAlign: "left" }}>
          <Message kind="notice">
            Password changed for <strong>{done}</strong>. You can log in with it now.
          </Message>
          <button className="primary" style={{ width: "100%" }} onClick={() => navigate("/", { replace: true })}>
            Go to log in
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          {error && (
            <Message kind="error">
              {error} {/link/.test(error) && <Link to="/forgot-password">Ask for a new link</Link>}
            </Message>
          )}
          <div className="field" style={{ marginBottom: "0.85rem" }}>
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" autoFocus autoComplete="new-password" maxLength={100} value={password} onChange={(e) => setPassword(e.target.value)} />
            {password.length > 0 && password.length < 8 && <div className="hint">{8 - password.length} more characters needed</div>}
          </div>
          <div className="field" style={{ marginBottom: "1.1rem" }}>
            <label htmlFor="confirm-password">Type it again</label>
            <input id="confirm-password" type="password" autoComplete="new-password" maxLength={100} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <button className="primary" style={{ width: "100%", minHeight: 38 }} disabled={busy || password.length < 8 || !confirm}>
            {busy ? "Saving…" : "Set new password"}
          </button>
        </form>
      )}
    </Frame>
  );
}
