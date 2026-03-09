import { useState, useRef, useCallback } from "react";

const FIELDS = [
  { key: "village", label: "Village", group: "location" },
  { key: "tehsil", label: "Tehsil", group: "location" },
  { key: "district", label: "District", group: "location" },
  { key: "khasraNo", label: "Khasra No.", group: "location" },
  { key: "chainageFrom", label: "Chainage From", group: "pipeline" },
  { key: "chainageTo", label: "Chainage To", group: "pipeline" },
  { key: "length", label: "Length (m)", group: "pipeline" },
  { key: "dia", label: "Diameter (MM)", group: "pipeline" },
  { key: "row", label: "ROW (m)", group: "pipeline" },
  { key: "landOwnerName", label: "Land Owner Name", group: "parties" },
  { key: "farmerName", label: "Farmer / Lessee Name", group: "parties" },
  { key: "crop", label: "Crop", group: "compensation" },
  { key: "affectedArea", label: "Affected Area (Ha)", group: "compensation" },
  { key: "mandiRate", label: "Mandi Rate (Rs/quintal)", group: "compensation" },
  { key: "yield", label: "Yield (quintals/ha)", group: "compensation" },
  { key: "compensationAmount", label: "Compensation Amount (Rs)", group: "compensation" },
  { key: "bankName", label: "Bank Name", group: "banking" },
  { key: "accountNo", label: "Account Number", group: "banking" },
  { key: "ifscCode", label: "IFSC Code", group: "banking" },
];

const GROUPS = [
  { id: "location", label: "Land Location", icon: "📍" },
  { id: "pipeline", label: "Pipeline Details", icon: "⚙️" },
  { id: "parties", label: "Parties Involved", icon: "👤" },
  { id: "compensation", label: "Crop & Compensation", icon: "🌾" },
  { id: "banking", label: "Banking Details", icon: "🏦" },
];

const EMPTY_FORM = Object.fromEntries(FIELDS.map(f => [f.key, ""]));

function chainageOverlap(aFrom, aTo, bFrom, bTo) {
  return !(parseFloat(aTo) <= parseFloat(bFrom) || parseFloat(bTo) <= parseFloat(aFrom));
}

function checkDuplicates(form, ledger) {
  const warnings = [];
  ledger.forEach((entry) => {
    if (
      entry.khasraNo.trim().toLowerCase() === form.khasraNo.trim().toLowerCase() &&
      form.chainageFrom && form.chainageTo &&
      entry.chainageFrom && entry.chainageTo &&
      chainageOverlap(form.chainageFrom, form.chainageTo, entry.chainageFrom, entry.chainageTo)
    ) {
      warnings.push({
        type: "Duplicate Chainage Range",
        severity: "high",
        message: `Khasra No. "${form.khasraNo}" with chainage ${form.chainageFrom}–${form.chainageTo} overlaps with Entry #${entry.srNo} (chainage ${entry.chainageFrom}–${entry.chainageTo}, Farmer: ${entry.farmerName}).`,
      });
    }
    if (
      entry.accountNo.trim() === form.accountNo.trim() &&
      form.accountNo.trim() !== "" &&
      entry.farmerName.trim().toLowerCase() !== form.farmerName.trim().toLowerCase()
    ) {
      warnings.push({
        type: "Bank Account Mismatch",
        severity: "high",
        message: `Account No. "${form.accountNo}" is already registered under a different farmer: "${entry.farmerName}" (Entry #${entry.srNo}). Please verify before proceeding.`,
      });
    }
    if (
      entry.khasraNo.trim().toLowerCase() === form.khasraNo.trim().toLowerCase() &&
      entry.farmerName.trim().toLowerCase() === form.farmerName.trim().toLowerCase() &&
      form.chainageFrom && form.chainageTo &&
      entry.chainageFrom && entry.chainageTo &&
      !chainageOverlap(form.chainageFrom, form.chainageTo, entry.chainageFrom, entry.chainageTo)
    ) {
      warnings.push({
        type: "Repeat Compensation — Same Farmer",
        severity: "low",
        message: `Farmer "${form.farmerName}" has a previous compensation for Khasra No. "${form.khasraNo}" under a different chainage range (Entry #${entry.srNo}). This is permitted but flagged for awareness.`,
      });
    }
  });
  return warnings;
}

function verifyCalculations(form) {
  const flags = [];
  const length = parseFloat(form.length);
  const row = parseFloat(form.row);
  const area = parseFloat(form.affectedArea);
  const mandiRate = parseFloat(form.mandiRate);
  const yieldVal = parseFloat(form.yield);
  const comp = parseFloat(form.compensationAmount);
  if (length && row && area) {
    const calcArea = parseFloat(((length * row) / 10000).toFixed(6));
    if (Math.abs(calcArea - parseFloat(area.toFixed(6))) > 0.0001) {
      flags.push({ type: "Area Calculation Mismatch", message: `Expected: ${length}m × ${row}m ÷ 10,000 = ${calcArea} ha. Document states: ${area} ha.` });
    }
  }
  if (area && yieldVal && mandiRate && comp) {
    const calcComp = parseFloat((area * yieldVal * mandiRate).toFixed(2));
    if (Math.abs(calcComp - parseFloat(comp.toFixed(2))) > 2) {
      flags.push({ type: "Compensation Calculation Mismatch", message: `Expected: ${area} ha × ${yieldVal} q/ha × Rs.${mandiRate} = Rs.${calcComp.toLocaleString("en-IN")}. Document states: Rs.${parseFloat(comp).toLocaleString("en-IN")}.` });
    }
  }
  return flags;
}

async function extractFromPDF(base64Data) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
          { type: "text", text: "Extract the following fields from this crop compensation document. Return ONLY a valid JSON object with no preamble, explanation, or markdown. Use empty string for any field not found.\n\nFields: village, tehsil, district, khasraNo, chainageFrom (numeric), chainageTo (numeric), length (meters numeric), dia (MM numeric), row (meters numeric), landOwnerName, farmerName (lessee who receives compensation), crop, affectedArea (hectares numeric), mandiRate (per quintal numeric), yield (quintals/hectare numeric), compensationAmount (total amount numeric), bankName, accountNo, ifscCode\n\nReturn only the JSON object." }
        ]
      }]
    })
  });
  const data = await response.json();
  const text = data.content.map(i => i.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function exportToCSV(ledger) {
  const headers = ["Sr.No.", "Date", ...FIELDS.map(f => f.label)];
  const rows = ledger.map(e => [e.srNo, e.date, ...FIELDS.map(f => e[f.key] || "")]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `crop_compensation_ledger_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}

export default function App() {
  const [ledger, setLedger] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [step, setStep] = useState("idle");
  const [warnings, setWarnings] = useState([]);
  const [calcFlags, setCalcFlags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingEntry, setPendingEntry] = useState(null);
  const [activeTab, setActiveTab] = useState("entry");
  const [hoverUpload, setHoverUpload] = useState(false);
  const fileRef = useRef();

  const handleFile = useCallback(async (file) => {
    if (!file || file.type !== "application/pdf") { setError("Please upload a valid PDF file."); return; }
    setLoading(true); setError(""); setStep("uploading");
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Failed"));
        r.readAsDataURL(file);
      });
      const extracted = await extractFromPDF(base64);
      setForm({ ...EMPTY_FORM, ...extracted });
      setCalcFlags(verifyCalculations({ ...EMPTY_FORM, ...extracted }));
      setStep("reviewing");
    } catch (e) {
      setError("Could not extract data. Please check the file and try again.");
      setStep("idle");
    }
    setLoading(false);
  }, []);

  const handleFormChange = (key, val) => {
    const updated = { ...form, [key]: val };
    setForm(updated);
    setCalcFlags(verifyCalculations(updated));
  };

  const handleSave = () => {
    const dups = checkDuplicates(form, ledger);
    const cFlags = calcFlags.map(f => ({ ...f, severity: "medium" }));
    const all = [...dups, ...cFlags];
    if (all.length > 0) { setWarnings(all); setPendingEntry(form); setStep("warning"); }
    else commitEntry(form);
  };

  const commitEntry = (data) => {
    setLedger(prev => [...prev, { ...data, srNo: prev.length + 1, date: new Date().toLocaleDateString("en-IN") }]);
    setForm(EMPTY_FORM); setCalcFlags([]); setWarnings([]); setPendingEntry(null);
    setStep("saved");
    setTimeout(() => { setStep("idle"); if (fileRef.current) fileRef.current.value = ""; }, 2500);
  };

  const highWarnings = warnings.filter(w => w.severity === "high");
  const totalComp = ledger.reduce((s, e) => s + (parseFloat(e.compensationAmount) || 0), 0);
  const totalArea = ledger.reduce((s, e) => s + (parseFloat(e.affectedArea) || 0), 0);

  const colors = {
    navy: "#1b3068", navyDark: "#142450", gold: "#c8973a", goldDark: "#b5832e",
    green: "#16a34a", bg: "#f0f2f6", white: "#ffffff",
    border: "#dde3ef", borderLight: "#eef1f9",
    text: "#1a2340", textMid: "#4a5470", textLight: "#8a93a8",
    tableHover: "#f7f9fd", formBg: "#f5f7fc",
  };

  return (
    <div style={{ fontFamily: "'Source Sans 3', 'Segoe UI', sans-serif", background: colors.bg, minHeight: "100vh", color: colors.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;600&family=Source+Sans+3:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; }
        input { transition: border-color 0.15s, box-shadow 0.15s; }
        input:focus { outline: none; border-color: #1b3068 !important; box-shadow: 0 0 0 3px rgba(27,48,104,0.1) !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner { width: 32px; height: 32px; border: 3px solid #eef1f9; border-top-color: #1b3068; border-radius: 50%; animation: spin 0.75s linear infinite; margin: 0 auto 14px; }
        .trow:hover td { background: #f5f8ff !important; }
        .btn-primary { transition: background 0.15s; } .btn-primary:hover { background: #142450 !important; }
        .btn-sec { transition: background 0.15s; } .btn-sec:hover { background: #f0f3fa !important; }
        .nav-tab { transition: color 0.15s; }
      `}</style>

      {/* MODAL */}
      {step === "warning" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,18,40,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, backdropFilter: "blur(3px)" }}>
          <div style={{ background: colors.white, borderRadius: 12, padding: 32, maxWidth: 580, width: "90%", boxShadow: "0 24px 60px rgba(10,18,40,0.22)" }}>
            <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Verification Required</div>
            <div style={{ fontSize: 13, color: colors.textLight, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${colors.borderLight}` }}>
              {warnings.length} issue{warnings.length > 1 ? "s" : ""} detected. Review carefully before saving this entry.
            </div>
            {warnings.map((w, i) => {
              const bgs = { high: "#fff5f5", medium: "#fffbeb", low: "#eff6ff" };
              const borders = { high: "#fca5a5", medium: "#fde68a", low: "#bfdbfe" };
              const tcs = { high: "#dc2626", medium: "#d97706", low: "#2563eb" };
              return (
                <div key={i} style={{ background: bgs[w.severity] || "#eff6ff", border: `1px solid ${borders[w.severity] || "#bfdbfe"}`, borderRadius: 8, padding: "13px 16px", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: tcs[w.severity] || "#2563eb", marginBottom: 5 }}>{w.type}</div>
                  <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.55 }}>{w.message}</div>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 10, marginTop: 22, paddingTop: 20, borderTop: `1px solid ${colors.borderLight}` }}>
              <button className="btn-sec" style={{ flex: 1, padding: "11px 0", background: colors.white, color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                onClick={() => { setStep("reviewing"); setWarnings([]); }}>← Go Back & Edit</button>
              <button className="btn-primary" style={{ flex: 1, padding: "11px 0", background: highWarnings.length === 0 ? colors.navy : "#dc2626", color: colors.white, border: "none", borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                onClick={() => commitEntry(pendingEntry)}>
                {highWarnings.length === 0 ? "Confirm & Save Entry" : "Override & Save (High Risk)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{ background: colors.navy, padding: "0 40px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 66, boxShadow: "0 2px 10px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ background: colors.gold, color: "white", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 3, letterSpacing: 1, textTransform: "uppercase" }}>NVDA</div>
          <div>
            <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 19, fontWeight: 600, color: "#ffffff" }}>Crop Compensation Ledger</div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>Pipeline Project — Farmer Compensation Tracker</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.65)", fontSize: 12, padding: "5px 15px", borderRadius: 20 }}>
            {ledger.length} {ledger.length === 1 ? "entry" : "entries"}
          </div>
          <button disabled={ledger.length === 0} onClick={() => exportToCSV(ledger)}
            style={{ background: ledger.length === 0 ? "rgba(255,255,255,0.1)" : colors.gold, color: ledger.length === 0 ? "rgba(255,255,255,0.3)" : "white", border: "none", borderRadius: 5, padding: "7px 18px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 600, cursor: ledger.length === 0 ? "not-allowed" : "pointer" }}>
            ↓ Export to CSV
          </button>
        </div>
      </div>

      {/* NAV TABS */}
      <div style={{ background: colors.white, borderBottom: `1px solid ${colors.border}`, padding: "0 40px", display: "flex" }}>
        {[["entry", "New Entry"], ["ledger", `Ledger${ledger.length > 0 ? ` (${ledger.length})` : ""}`]].map(([id, label]) => (
          <button key={id} className="nav-tab" onClick={() => setActiveTab(id)}
            style={{ background: "none", border: "none", borderBottom: activeTab === id ? `3px solid ${colors.navy}` : "3px solid transparent", color: activeTab === id ? colors.navy : colors.textLight, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: activeTab === id ? 700 : 500, padding: "13px 20px", cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {/* MAIN */}
      <div style={{ padding: "30px 40px", maxWidth: 1140, margin: "0 auto" }}>

        {/* ---- ENTRY TAB ---- */}
        {activeTab === "entry" && (
          <div>
            {step === "saved" && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", borderRadius: 8, padding: "11px 16px", fontSize: 13, marginBottom: 16 }}>
                ✓ Entry saved successfully and added to the ledger.
              </div>
            )}
            {error && (
              <div style={{ background: "#fff5f5", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 8, padding: "11px 16px", fontSize: 13, marginBottom: 16 }}>
                ⚠ {error}
              </div>
            )}
            {calcFlags.length > 0 && step === "reviewing" && calcFlags.map((f, i) => (
              <div key={i} style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "11px 16px", fontSize: 13, marginBottom: 12, display: "flex", gap: 8 }}>
                ⚠ <div><strong>{f.type}:</strong> {f.message}</div>
              </div>
            ))}

            {/* Upload Zone */}
            {(step === "idle" || step === "saved") && !loading && (
              <>
                <div
                  onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
                  onDragOver={e => e.preventDefault()}
                  onMouseEnter={() => setHoverUpload(true)}
                  onMouseLeave={() => setHoverUpload(false)}
                  onClick={() => fileRef.current.click()}
                  style={{ background: hoverUpload ? colors.formBg : colors.white, border: `2px dashed ${hoverUpload ? colors.navy : "#c9d3e8"}`, borderRadius: 10, padding: "56px 24px", textAlign: "center", cursor: "pointer", marginBottom: 20, transition: "all 0.15s" }}
                >
                  <div style={{ width: 54, height: 54, background: "#eef1f9", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", fontSize: 22 }}>📄</div>
                  <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 17, fontWeight: 600, color: colors.navy, marginBottom: 7 }}>Upload Compensation Document</div>
                  <div style={{ fontSize: 13, color: colors.textLight, lineHeight: 1.6 }}>
                    Drag & drop a PDF here, or <span style={{ color: colors.navy, fontWeight: 600 }}>click to browse</span><br />
                    Claude will automatically extract all fields from the document
                  </div>
                  <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <button style={{ background: "none", border: "none", color: "#4a6fa5", fontSize: 13, cursor: "pointer", textDecoration: "underline", fontFamily: "'Source Sans 3', sans-serif" }}
                    onClick={() => setStep("reviewing")}>Enter data manually without uploading</button>
                </div>
              </>
            )}

            {loading && (
              <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 36, textAlign: "center", marginBottom: 20 }}>
                <div className="spinner" />
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Extracting data from document...</div>
                <div style={{ fontSize: 12, color: colors.textLight }}>Claude is reading and parsing all fields from the PDF</div>
              </div>
            )}

            {/* Review Form */}
            {step === "reviewing" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                  <div>
                    <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, color: colors.text }}>Review Extracted Data</div>
                    <div style={{ fontSize: 13, color: colors.textLight, marginTop: 3 }}>Verify all fields before saving. Edit directly if anything needs correction.</div>
                  </div>
                  <button className="btn-sec" style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.textLight, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, padding: "6px 13px", cursor: "pointer" }}
                    onClick={() => { setStep("idle"); setForm(EMPTY_FORM); setCalcFlags([]); }}>✕ Clear</button>
                </div>

                {GROUPS.map(group => {
                  const gFields = FIELDS.filter(f => f.group === group.id);
                  return (
                    <div key={group.id} style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, marginBottom: 14, overflow: "hidden" }}>
                      <div style={{ background: colors.formBg, borderBottom: `1px solid ${colors.border}`, padding: "11px 20px", display: "flex", alignItems: "center", gap: 9 }}>
                        <span style={{ fontSize: 14 }}>{group.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#3a4566", textTransform: "uppercase", letterSpacing: 0.8 }}>{group.label}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
                        {gFields.map((f, idx) => (
                          <div key={f.key} style={{ padding: "14px 20px", borderRight: (idx + 1) % 3 === 0 ? "none" : `1px solid ${colors.borderLight}`, borderBottom: idx < gFields.length - Math.ceil(gFields.length / 3) * (gFields.length > 3 ? 1 : 0) ? `1px solid ${colors.borderLight}` : "none" }}>
                            <label style={{ fontSize: 10.5, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6, display: "block" }}>{f.label}</label>
                            <input
                              value={form[f.key]}
                              onChange={e => handleFormChange(f.key, e.target.value)}
                              placeholder="—"
                              style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: 5, padding: "7px 10px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button className="btn-sec" style={{ padding: "11px 20px", background: colors.white, color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, cursor: "pointer" }}
                    onClick={() => { setStep("idle"); setForm(EMPTY_FORM); setCalcFlags([]); }}>Cancel</button>
                  <button className="btn-primary" style={{ flex: 1, padding: "11px 0", background: colors.navy, color: colors.white, border: "none", borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                    onClick={handleSave}>Run Checks & Save Entry →</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- LEDGER TAB ---- */}
        {activeTab === "ledger" && (
          <div>
            {ledger.length === 0 ? (
              <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, textAlign: "center", padding: "80px 24px" }}>
                <div style={{ fontSize: 38, marginBottom: 16 }}>📋</div>
                <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 18, color: colors.text, marginBottom: 8 }}>No Entries Yet</div>
                <div style={{ fontSize: 13, color: colors.textLight }}>Add your first compensation entry from the New Entry tab.</div>
              </div>
            ) : (
              <>
                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 22 }}>
                  {[
                    { label: "Total Entries", value: ledger.length, color: colors.text },
                    { label: "Total Compensation", value: `Rs. ${totalComp.toLocaleString("en-IN")}`, color: colors.gold },
                    { label: "Total Affected Area", value: `${totalArea.toFixed(4)} Ha`, color: colors.green },
                  ].map(s => (
                    <div key={s.label} style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, padding: "20px 24px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>{s.label}</div>
                      <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 26, fontWeight: 600, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Table */}
                <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ background: colors.formBg, borderBottom: `1px solid ${colors.border}`, padding: "13px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#3a4566", textTransform: "uppercase", letterSpacing: 0.6 }}>Compensation Records</div>
                    <button className="btn-sec" style={{ padding: "5px 14px", background: colors.white, color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 5, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, cursor: "pointer" }}
                      onClick={() => exportToCSV(ledger)}>↓ Export CSV</button>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr>
                          {["#", "Date", "Village", "Tehsil", "District", "Khasra No.", "Chainage", "Length", "ROW", "Land Owner", "Farmer / Lessee", "Crop", "Area (Ha)", "Mandi Rate", "Yield", "Compensation", "Bank", "Account No.", "IFSC"].map(h => (
                            <th key={h} style={{ background: colors.formBg, color: "#6b7490", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, padding: "10px 14px", textAlign: "left", borderBottom: `1px solid ${colors.border}`, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ledger.map((e, i) => (
                          <tr key={i} className="trow" style={{ borderBottom: `1px solid #f0f2f8` }}>
                            <td style={{ padding: "11px 14px", color: colors.textLight, fontWeight: 600, fontSize: 12 }}>{e.srNo}</td>
                            <td style={{ padding: "11px 14px", color: colors.textMid }}>{e.date}</td>
                            <td style={{ padding: "11px 14px" }}>{e.village}</td>
                            <td style={{ padding: "11px 14px" }}>{e.tehsil}</td>
                            <td style={{ padding: "11px 14px" }}>{e.district}</td>
                            <td style={{ padding: "11px 14px", color: colors.navy, fontWeight: 600 }}>{e.khasraNo}</td>
                            <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>{e.chainageFrom}–{e.chainageTo}</td>
                            <td style={{ padding: "11px 14px" }}>{e.length}m</td>
                            <td style={{ padding: "11px 14px" }}>{e.row}m</td>
                            <td style={{ padding: "11px 14px" }}>{e.landOwnerName}</td>
                            <td style={{ padding: "11px 14px", fontWeight: 500, color: colors.text }}>{e.farmerName}</td>
                            <td style={{ padding: "11px 14px" }}>{e.crop}</td>
                            <td style={{ padding: "11px 14px" }}>{e.affectedArea}</td>
                            <td style={{ padding: "11px 14px" }}>Rs.{e.mandiRate}</td>
                            <td style={{ padding: "11px 14px" }}>{e.yield}</td>
                            <td style={{ padding: "11px 14px", color: colors.green, fontWeight: 600 }}>{e.compensationAmount ? `Rs. ${parseFloat(e.compensationAmount).toLocaleString("en-IN")}` : "—"}</td>
                            <td style={{ padding: "11px 14px" }}>{e.bankName}</td>
                            <td style={{ padding: "11px 14px" }}>{e.accountNo}</td>
                            <td style={{ padding: "11px 14px" }}>{e.ifscCode}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
