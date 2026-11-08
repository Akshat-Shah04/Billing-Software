import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import BrandMark from "../components/BrandMark";
import Message from "../components/Message";
import ThemeToggle from "../components/ThemeToggle";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="corner-toggle">
        <ThemeToggle />
      </div>
      <div className="card login-card">
        <BrandMark size={64} />
        <h1>Billing Software</h1>
        <p className="lede">Log in with the account your administrator created for you.</p>
        <form onSubmit={submit}>
          {error && <Message kind="error">{error}</Message>}
          <div className="field" style={{ marginBottom: "0.85rem" }}>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: "1.25rem" }}>
            <div className="row between" style={{ marginBottom: "0.3rem" }}>
              <label htmlFor="password" style={{ margin: 0 }}>
                Password
              </label>
              <Link to="/forgot-password" className="small">
                Forgot password?
              </Link>
            </div>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="primary" style={{ width: "100%", minHeight: 38 }} disabled={busy || !username || !password}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
