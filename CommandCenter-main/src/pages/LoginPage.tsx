import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://orca-app-v7oew.ondigitalocean.app";

export function LoginPage({ onLogin }: { onLogin: (token: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "register") {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Registration failed");
      }
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Login failed");
      localStorage.setItem("auth_token", data.access_token);
      onLogin(data.access_token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#162a1c",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Oswald', Arial, sans-serif",
    }}>
      <div style={{
        background: "#1e3629",
        border: "1px solid rgba(232,168,32,0.35)",
        borderRadius: 4,
        padding: "2.5rem 2rem",
        width: "100%",
        maxWidth: 380,
        boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: "0 auto 12px" }}>
            <rect x="4" y="4" width="32" height="32" rx="2" stroke="#e8a820" strokeWidth="1.5"/>
            <rect x="10" y="10" width="8" height="8" rx="1" fill="#e8a820" opacity="0.9"/>
            <rect x="22" y="10" width="8" height="8" rx="1" fill="#e8a820" opacity="0.5"/>
            <rect x="10" y="22" width="8" height="8" rx="1" fill="#e8a820" opacity="0.5"/>
            <rect x="22" y="22" width="8" height="8" rx="1" fill="#e8a820" opacity="0.9"/>
          </svg>
          <h1 style={{ color: "#e8a820", fontSize: 22, letterSpacing: "0.15em", margin: 0 }}>COMMAND CENTER</h1>
          <p style={{ color: "rgba(245,240,224,0.4)", fontSize: 10, letterSpacing: "0.14em", marginTop: 6, textTransform: "uppercase" }}>
            {mode === "login" ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ color: "rgba(245,240,224,0.5)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ color: "rgba(245,240,224,0.5)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          {error && (
            <p style={{ color: "#d94040", fontSize: 11, letterSpacing: "0.05em", margin: "4px 0 0" }}>{error}</p>
          )}

          <button type="submit" disabled={loading} style={{
            ...btnStyle,
            opacity: loading ? 0.7 : 1,
            marginTop: 8,
          }}>
            {loading ? "..." : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
          </button>
        </form>

        <button
          onClick={() => { setMode(m => m === "login" ? "register" : "login"); setError(""); }}
          style={{
            background: "none", border: "none",
            color: "rgba(245,240,224,0.35)",
            fontSize: 10, letterSpacing: "0.1em",
            cursor: "pointer", marginTop: 20,
            width: "100%", textAlign: "center",
            textTransform: "uppercase", padding: "4px 0",
            fontFamily: "'Oswald', Arial, sans-serif",
          }}
        >
          {mode === "login" ? "No account? Register →" : "Have an account? Sign in →"}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#162a1c",
  border: "1px solid rgba(232,168,32,0.25)",
  borderRadius: 2,
  padding: "9px 12px",
  color: "#f5f0e0",
  fontSize: 13,
  letterSpacing: "0.04em",
  fontFamily: "'Oswald', Arial, sans-serif",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  background: "#e8a820",
  color: "#162a1c",
  border: "none",
  borderRadius: 2,
  padding: "11px",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.14em",
  cursor: "pointer",
  fontFamily: "'Oswald', Arial, sans-serif",
  textTransform: "uppercase" as const,
};
