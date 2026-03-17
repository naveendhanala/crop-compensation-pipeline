import { useState } from "react";

const colors = {
  navy: "#1b3068", gold: "#c8973a",
  bg: "#f0f2f6", white: "#ffffff", border: "#dde3ef",
  text: "#1a2340", textLight: "#8a93a8",
};

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const validUser = import.meta.env.VITE_APP_USERNAME;
    const validPass = import.meta.env.VITE_APP_PASSWORD;
    if (username === validUser && password === validPass) {
      onLogin();
    } else {
      setError("Invalid username or password.");
    }
  };

  return (
    <div style={{ fontFamily: "'Source Sans 3', 'Segoe UI', sans-serif", background: colors.bg, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;600&family=Source+Sans+3:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: colors.navy, padding: "0 40px", display: "flex", alignItems: "center", height: 66, boxShadow: "0 2px 10px rgba(0,0,0,0.2)" }}>
        <div style={{ background: colors.gold, color: "white", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 3, letterSpacing: 1, textTransform: "uppercase", marginRight: 16 }}>RVR</div>
        <div>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 19, fontWeight: 600, color: "#ffffff" }}>Crop Compensation Ledger</div>
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>Pipeline Project — Farmer Compensation Tracker</div>
        </div>
      </div>

      {/* Card */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "40px 44px", width: "100%", maxWidth: 400, boxShadow: "0 8px 32px rgba(27,48,104,0.08)" }}>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 22, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Sign In</div>
          <div style={{ fontSize: 13, color: colors.textLight, marginBottom: 28 }}>Enter your credentials to access the ledger.</div>

          {error && (
            <div style={{ background: "#fff5f5", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 7, padding: "10px 14px", fontSize: 13, marginBottom: 18 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7, display: "block", marginBottom: 6 }}>Username</label>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(""); }}
                required
                placeholder="Enter username"
                style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: 6, padding: "10px 12px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 14, color: colors.text, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7, display: "block", marginBottom: 6 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                required
                placeholder="••••••••"
                style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: 6, padding: "10px 12px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 14, color: colors.text, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <button
              type="submit"
              style={{ width: "100%", background: colors.navy, color: "white", border: "none", borderRadius: 6, padding: "12px 0", fontFamily: "'Source Sans 3', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
