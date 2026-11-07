import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import BrandMark from "../components/BrandMark";
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
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">
          <BrandMark size={34} />
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Billing Software</h1>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Log in with the account your admin created for you.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="field" style={{ marginBottom: ".85rem" }}>
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
        <div className="field" style={{ marginBottom: "1.1rem" }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="primary" style={{ width: "100%" }} disabled={busy || !username || !password}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
