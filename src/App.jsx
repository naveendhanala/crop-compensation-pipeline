import { useState, useRef, useCallback, useEffect } from "react";
import Anthropic from "@anthropic-ai/sdk";
import Login from "./Login";
import { supabase } from "./supabaseClient";

const DEFAULT_JUNCTION_DATA = [
  { from: "J-1",   to: "J-3",   length: 1684.9  },
  { from: "J-1",   to: "J-2",   length: 353.61  },
  { from: "J-10",  to: "J-13",  length: 738.97  },
  { from: "J-102", to: "J-111", length: 213.2   },
  { from: "J-11",  to: "J-23",  length: 2371.9  },
  { from: "J-111", to: "J-122", length: 792.7   },
  { from: "J-121", to: "J-157", length: 1035.3  },
  { from: "J-122", to: "J-130", length: 207.35  },
  { from: "J-13",  to: "J-22",  length: 2764.1  },
  { from: "J-130", to: "J-139", length: 398.07  },
  { from: "J-15",  to: "J-18",  length: 253.14  },
  { from: "J-157", to: "J-189", length: 1088.6  },
  { from: "J-18",  to: "J-20",  length: 320.86  },
  { from: "J-189", to: "J-220", length: 665.09  },
  { from: "J-2",   to: "J-6",   length: 551.73  },
  { from: "J-20",  to: "J-25",  length: 566.13  },
  { from: "J-22",  to: "J-36",  length: 2035.2  },
  { from: "J-220", to: "J-233", length: 607.37  },
  { from: "J-23",  to: "J-34",  length: 2288.5  },
  { from: "J-23",  to: "J-27",  length: 188.85  },
  { from: "J-233", to: "J-247", length: 688.81  },
  { from: "J-247", to: "J-254", length: 666.91  },
  { from: "J-254", to: "J-261", length: 554.1   },
  { from: "J-3",   to: "J-10",  length: 2118.9  },
  { from: "J-3",   to: "J-7",   length: 1185.8  },
  { from: "J-34",  to: "J-65",  length: 3725.9  },
  { from: "J-34",  to: "J-35",  length: 36.21   },
  { from: "J-35",  to: "J-44",  length: 282.68  },
  { from: "J-36",  to: "J-51",  length: 803.64  },
  { from: "J-36",  to: "J-47",  length: 266.71  },
  { from: "J-51",  to: "J-62",  length: 1234.1  },
  { from: "J-51",  to: "J-54",  length: 399.61  },
  { from: "J-6",   to: "J-15",  length: 739.98  },
  { from: "J-62",  to: "J-67",  length: 513.25  },
  { from: "J-65",  to: "J-70",  length: 631.06  },
  { from: "J-67",  to: "J-77",  length: 989.77  },
  { from: "J-7",   to: "J-11",  length: 798.95  },
  { from: "J-70",  to: "J-74",  length: 541.26  },
  { from: "J-74",  to: "J-79",  length: 681.2   },
  { from: "J-77",  to: "J-95",  length: 920.63  },
  { from: "J-79",  to: "J-85",  length: 142.43  },
  { from: "J-85",  to: "J-90",  length: 252.82  },
  { from: "J-90",  to: "J-96",  length: 263.48  },
  { from: "J-95",  to: "J-121", length: 872.79  },
  { from: "J-96",  to: "J-102", length: 492.13  },
  { from: "PH-1",  to: "J-1",   length: 25.5    },
];

const CLUSTERS = ["A", "B", "C", "D1", "D2", "E"];
const DEFAULT_CLUSTER_JUNCTIONS = Object.fromEntries(
  CLUSTERS.map(c => [c, DEFAULT_JUNCTION_DATA.map(j => ({ ...j }))])
);

const FIELDS = [
  { key: "cluster", label: "Cluster", group: "location", type: "select", options: ["A", "B", "C", "D1", "D2", "E"] },
  { key: "village", label: "Village", group: "location" },
  { key: "khasraNo", label: "Khasra No.", group: "location" },
  { key: "junctionFrom", label: "Junction: From", group: "pipeline", type: "select" },
  { key: "junctionTo", label: "Junction: To", group: "pipeline", type: "select" },
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

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
});

async function extractFromPDF(base64Data) {
  const response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
        { type: "text", text: `Extract the following fields from this crop compensation document. Return ONLY a valid JSON object with no preamble, explanation, or markdown. Use empty string for any field not found.\n\nFields: village, cluster (must be one of: A, B, C, D1, D2, E), khasraNo, junctionFrom (the starting node of the pipeline section, e.g. "J-1"), junctionTo (the ending node of the pipeline section, e.g. "J-3"), chainageFrom (numeric), chainageTo (numeric), length (meters numeric), dia (MM numeric), row (meters numeric), landOwnerName, farmerName (lessee who receives compensation), crop, affectedArea (hectares numeric), mandiRate (per quintal numeric), yield (quintals/hectare numeric), compensationAmount (total amount numeric), bankName, accountNo, ifscCode\n\nReturn only the JSON object.` }
      ]
    }]
  });
  const text = response.content.map(b => b.type === "text" ? b.text : "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function exportToCSV(ledger) {
  const headers = ["Sr.No.", "Date", "Approval ID", ...FIELDS.map(f => f.label), "Cheque/RTGS Details"];
  const rows = ledger.map(e => [e.srNo, e.date, e.approvalId || "", ...FIELDS.map(f => e[f.key] || ""), e.paymentDetails || ""]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `crop_compensation_ledger_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}

function exportToExcel(entries, approvalId) {
  const headers = ["Approval ID", "Sr.No.", "Date", ...FIELDS.map(f => f.label)];
  const rows = entries.map(e => [approvalId, e.srNo, e.date, ...FIELDS.map(f => e[f.key] || "")]);
  const tableHTML = `<html><head><meta charset="UTF-8"></head><body><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  const blob = new Blob([tableHTML], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pending_approval_${approvalId}_${new Date().toISOString().split("T")[0]}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [ledger, setLedger] = useState([]);
  const [editingEntry, setEditingEntry] = useState(null); // null = new, otherwise entry being edited
  const [form, setForm] = useState(EMPTY_FORM);
  const [step, setStep] = useState("idle");
  const [warnings, setWarnings] = useState([]);
  const [calcFlags, setCalcFlags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingEntry, setPendingEntry] = useState(null);
  const [activeTab, setActiveTab] = useState("entry");
  const [ledgerSubTab, setLedgerSubTab] = useState("records"); // "records" | "pending"
  const [generatedApprovalId, setGeneratedApprovalId] = useState(null);
  const [hoverUpload, setHoverUpload] = useState(false);
  const [clusterJunctions, setClusterJunctions] = useState(() => {
    try {
      const s = localStorage.getItem("rvr_cluster_junctions");
      if (!s) return DEFAULT_CLUSTER_JUNCTIONS;
      const parsed = JSON.parse(s);
      if (typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_CLUSTER_JUNCTIONS;
      return parsed;
    } catch { return DEFAULT_CLUSTER_JUNCTIONS; }
  });
  const [selectedJunctionCluster, setSelectedJunctionCluster] = useState("A");
  const [junctionEdit, setJunctionEdit] = useState(null); // index of row being edited
  const [junctionEditForm, setJunctionEditForm] = useState({ from: "", to: "", length: "" });
  const [newJunction, setNewJunction] = useState({ from: "", to: "", length: "" });
  const [junctionDeleteConfirm, setJunctionDeleteConfirm] = useState(null);
  const [selectedPending, setSelectedPending] = useState(new Set());
  const [selectedLedgerCluster, setSelectedLedgerCluster] = useState("A");
  const [paymentEntry, setPaymentEntry] = useState(null); // _id of record being paid
  const [paymentInput, setPaymentInput] = useState("");
  const fileRef = useRef();

  // Persist junction data to localStorage
  useEffect(() => {
    localStorage.setItem("rvr_cluster_junctions", JSON.stringify(clusterJunctions));
  }, [clusterJunctions]);

  // Load ledger from Supabase when user logs in
  useEffect(() => {
    if (!loggedIn) return;
    supabase
      .from("ledger")
      .select("*")
      .order("sr_no", { ascending: true })
      .then(({ data, error }) => {
        if (error) { console.error("Failed to load ledger:", error.message); return; }
        if (data) setLedger(data.map(row => ({ _id: row.id, srNo: row.sr_no, date: row.date, approvalId: row.data.approvalId || null, ...row.data })));
      });
  }, [loggedIn]);

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
      const msg = e?.message || String(e);
      if (msg.includes("401") || msg.includes("authentication") || msg.includes("API key")) {
        setError("Authentication failed. Please check your VITE_ANTHROPIC_API_KEY in .env.local and restart the dev server.");
      } else if (msg.includes("400") || msg.includes("invalid")) {
        setError(`API error: ${msg}`);
      } else {
        setError(`Extraction failed: ${msg}`);
      }
      setStep("idle");
    }
    setLoading(false);
  }, []);

  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  const handleFormChange = (key, val) => {
    const updated = { ...form, [key]: val };
    setForm(updated);
    setCalcFlags(verifyCalculations(updated));
  };

  const handleSave = () => {
    const ledgerToCheck = editingEntry ? ledger.filter(e => e.srNo !== editingEntry.srNo) : ledger;
    const dups = checkDuplicates(form, ledgerToCheck);
    const cFlags = calcFlags.map(f => ({ ...f, severity: "medium" }));
    const all = [...dups, ...cFlags];
    if (all.length > 0) { setWarnings(all); setPendingEntry(form); setStep("warning"); }
    else commitEntry(form);
  };

  const commitEntry = async (data) => {
    if (editingEntry) {
      // UPDATE existing entry — preserve approvalId
      const { _id, srNo, date, approvalId } = editingEntry;
      const { _id: _a, srNo: _b, date: _c, approvalId: _d, ...fields } = { ...data };
      const { error: dbError } = await supabase
        .from("ledger")
        .update({ data: { ...fields, approvalId: approvalId || null } })
        .eq("id", _id);
      if (dbError) { setError(`Failed to update: ${dbError.message}`); return; }
      setLedger(prev => prev.map(e => e._id === _id ? { _id, srNo, date, approvalId: approvalId || null, ...fields } : e));
      setEditingEntry(null);
    } else {
      // INSERT new entry — no approvalId yet (pending)
      const srNo = ledger.length + 1;
      const date = new Date().toLocaleDateString("en-IN");
      const { srNo: _, date: __, approvalId: _d, ...fields } = { ...data };
      const { error: dbError } = await supabase
        .from("ledger")
        .insert({ sr_no: srNo, date, data: { ...fields, approvalId: null } });
      if (dbError) { setError(`Failed to save to database: ${dbError.message}`); return; }
      setLedger(prev => [...prev, { ...data, srNo, date, approvalId: null }]);
    }
    setForm(EMPTY_FORM); setCalcFlags([]); setWarnings([]); setPendingEntry(null);
    setStep("saved");
    setTimeout(() => { setStep("idle"); if (fileRef.current) fileRef.current.value = ""; }, 2500);
  };

  const handleEdit = (entry) => {
    const { _id, srNo, date, ...fields } = entry;
    setEditingEntry(entry);
    setForm({ ...EMPTY_FORM, ...fields });
    setCalcFlags(verifyCalculations({ ...EMPTY_FORM, ...fields }));
    setActiveTab("entry");
    setStep("reviewing");
    setError("");
  };

  const cancelEdit = () => {
    setEditingEntry(null);
    setForm(EMPTY_FORM);
    setCalcFlags([]);
    setStep("idle");
    setActiveTab("ledger");
  };

  const highWarnings = warnings.filter(w => w.severity === "high");
  const clusterLedger = ledger.filter(e => e.cluster === selectedLedgerCluster);
  const pendingEntries = clusterLedger.filter(e => !e.approvalId);
  const totalComp = clusterLedger.reduce((s, e) => s + (parseFloat(e.compensationAmount) || 0), 0);
  const junctionData = clusterJunctions[selectedJunctionCluster] || [];
  const totalJunctionLength = junctionData.reduce((s, j) => s + (parseFloat(j.length) || 0), 0);

  const updateClusterJunctions = (cluster, updater) =>
    setClusterJunctions(prev => ({ ...prev, [cluster]: updater(prev[cluster] || []) }));

  const saveJunctionEdit = () => {
    if (!junctionEditForm.from.trim() || !junctionEditForm.to.trim()) return;
    updateClusterJunctions(selectedJunctionCluster, arr => arr.map((j, i) => i === junctionEdit
      ? { from: junctionEditForm.from.trim(), to: junctionEditForm.to.trim(), length: parseFloat(junctionEditForm.length) || 0 } : j));
    setJunctionEdit(null);
  };
  const deleteJunction = (idx) => updateClusterJunctions(selectedJunctionCluster, arr => arr.filter((_, i) => i !== idx));
  const addJunction = () => {
    if (!newJunction.from.trim() || !newJunction.to.trim()) return;
    updateClusterJunctions(selectedJunctionCluster, arr => [...arr, { from: newJunction.from.trim(), to: newJunction.to.trim(), length: parseFloat(newJunction.length) || 0 }]);
    setNewJunction({ from: "", to: "", length: "" });
  };

  const handleGenerateId = () => {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    setGeneratedApprovalId(`RVR-${year}-${rand}`);
  };

  const handleAcceptPending = async () => {
    if (!generatedApprovalId || selectedPending.size === 0) return;
    setLoading(true);
    const toApprove = pendingEntries.filter(e => selectedPending.has(e._id));
    for (const entry of toApprove) {
      const { _id, srNo, date, approvalId: _old, ...fields } = entry;
      const { error: dbError } = await supabase
        .from("ledger")
        .update({ data: { ...fields, approvalId: generatedApprovalId } })
        .eq("id", _id);
      if (dbError) { setError(`Failed to approve: ${dbError.message}`); setLoading(false); return; }
    }
    exportToExcel(toApprove, generatedApprovalId);
    setLedger(prev => prev.map(e => selectedPending.has(e._id) ? { ...e, approvalId: generatedApprovalId } : e));
    setSelectedPending(new Set());
    setGeneratedApprovalId(null);
    setLoading(false);
  };

  const handleSavePayment = async () => {
    if (!paymentInput.trim() || !paymentEntry) return;
    const entry = ledger.find(e => e._id === paymentEntry);
    if (!entry) return;
    const { _id, srNo, date, approvalId, ...fields } = entry;
    const { error: dbError } = await supabase
      .from("ledger")
      .update({ data: { ...fields, approvalId, paymentDetails: paymentInput.trim() } })
      .eq("id", _id);
    if (dbError) { setError(`Failed to save payment: ${dbError.message}`); return; }
    setLedger(prev => prev.map(e => e._id === _id ? { ...e, paymentDetails: paymentInput.trim() } : e));
    setPaymentEntry(null);
    setPaymentInput("");
  };

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
        input:focus, select:focus { outline: none; border-color: #1b3068 !important; box-shadow: 0 0 0 3px rgba(27,48,104,0.1) !important; }
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
          <div style={{ background: colors.gold, color: "white", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 3, letterSpacing: 1, textTransform: "uppercase" }}>RVR</div>
          <div>
            <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 19, fontWeight: 600, color: "#ffffff" }}>Crop Compensation Ledger</div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>Pipeline Project — Farmer Compensation Tracker</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
<button onClick={() => setLoggedIn(false)}
            style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 5, padding: "7px 16px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            Sign Out
          </button>
        </div>
      </div>

      {/* NAV TABS */}
      <div style={{ background: colors.white, borderBottom: `1px solid ${colors.border}`, padding: "0 40px", display: "flex" }}>
        {[["entry", "New Entry"], ["ledger", "Ledger"], ["junctions", "Junctions"]].map(([id, label]) => (
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
                    <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, color: colors.text }}>
                      {editingEntry ? `Edit Entry #${editingEntry.srNo}` : "Review Extracted Data"}
                    </div>
                    <div style={{ fontSize: 13, color: colors.textLight, marginTop: 3 }}>
                      {editingEntry ? "Make changes below. Validations will run again on submit." : "Verify all fields before saving. Edit directly if anything needs correction."}
                    </div>
                  </div>
                  <button className="btn-sec" style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.textLight, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, padding: "6px 13px", cursor: "pointer" }}
                    onClick={editingEntry ? cancelEdit : () => { setStep("idle"); setForm(EMPTY_FORM); setCalcFlags([]); }}>✕ {editingEntry ? "Cancel Edit" : "Clear"}</button>
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
                            {f.type === "select" ? (() => {
                              const clusterJns = clusterJunctions[form.cluster] || [];
                              const opts = f.options
                                ? f.options
                                : f.key === "junctionFrom"
                                  ? [...new Set(clusterJns.map(j => j.from))].sort()
                                  : [...new Set(clusterJns.map(j => j.to))].sort();
                              return (
                                <select
                                  value={form[f.key]}
                                  onChange={e => handleFormChange(f.key, e.target.value)}
                                  style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: 5, padding: "7px 10px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: form[f.key] ? colors.text : colors.textLight, background: colors.white, cursor: "pointer" }}
                                >
                                  <option value="">— Select —</option>
                                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              );
                            })() : (
                              <input
                                value={form[f.key]}
                                onChange={e => handleFormChange(f.key, e.target.value)}
                                placeholder="—"
                                style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: 5, padding: "7px 10px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white }}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button className="btn-sec" style={{ padding: "11px 20px", background: colors.white, color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, cursor: "pointer" }}
                    onClick={editingEntry ? cancelEdit : () => { setStep("idle"); setForm(EMPTY_FORM); setCalcFlags([]); }}>Cancel</button>
                  <button className="btn-primary" style={{ flex: 1, padding: "11px 0", background: colors.navy, color: colors.white, border: "none", borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                    onClick={handleSave}>{editingEntry ? "Run Checks & Update Entry →" : "Run Checks & Save Entry →"}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- JUNCTIONS TAB ---- */}
        {activeTab === "junctions" && (
          <div>
            {/* Cluster selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7 }}>Cluster</span>
              <div style={{ display: "flex", gap: 8 }}>
                {CLUSTERS.map(c => (
                  <button key={c} onClick={() => { setSelectedJunctionCluster(c); setJunctionEdit(null); setJunctionDeleteConfirm(null); }}
                    style={{ padding: "6px 18px", borderRadius: 6, border: selectedJunctionCluster === c ? "none" : `1px solid ${colors.border}`, background: selectedJunctionCluster === c ? colors.navy : colors.white, color: selectedJunctionCluster === c ? "white" : colors.textMid, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.15s" }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Stats bar */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 22 }}>
              {[
                { label: "Total Junctions", value: junctionData.length, color: colors.navy },
                { label: "Total Pipeline Length", value: `${totalJunctionLength.toLocaleString("en-IN", { maximumFractionDigits: 2 })} m`, color: colors.gold },
                { label: "Balance Length", value: `${(totalJunctionLength - junctionData.reduce((s, j) => s + ledger.filter(e => e.cluster === selectedJunctionCluster && e.junctionFrom === j.from && e.junctionTo === j.to).reduce((a, e) => a + (parseFloat(e.length) || 0), 0), 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })} m`, color: colors.green },
              ].map(s => (
                <div key={s.label} style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, padding: "20px 24px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>{s.label}</div>
                  <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 22, fontWeight: 600, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Table card */}
            <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ background: colors.formBg, borderBottom: `1px solid ${colors.border}`, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#3a4566", textTransform: "uppercase", letterSpacing: 0.8 }}>⚙️ Junction Master List</span>
                <span style={{ fontSize: 12, color: colors.textLight }}>{junctionData.length} sections</span>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {["#", "From", "To", "Length (m)", "Completed Length (m)", "Balance Length (m)", "Actions"].map(h => (
                        <th key={h} style={{ background: colors.formBg, color: "#6b7490", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, padding: "10px 16px", textAlign: ["Length (m)", "Completed Length (m)", "Balance Length (m)", "#"].includes(h) ? "right" : "left", borderBottom: `1px solid ${colors.border}`, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {junctionData.map((j, idx) => {
                      const completedLength = ledger
                        .filter(e => e.cluster === selectedJunctionCluster && e.junctionFrom === j.from && e.junctionTo === j.to)
                        .reduce((s, e) => s + (parseFloat(e.length) || 0), 0);
                      const balanceLength = (parseFloat(j.length) || 0) - completedLength;
                      return (
                        <tr key={idx} className="trow" style={{ borderBottom: `1px solid #f0f2f8` }}>
                          <td style={{ padding: "10px 16px", color: colors.textLight, fontWeight: 600, fontSize: 12, textAlign: "right", width: 50 }}>{idx + 1}</td>
                          {junctionEdit === idx ? (
                            <>
                              <td style={{ padding: "6px 16px" }}>
                                <input value={junctionEditForm.from} onChange={e => setJunctionEditForm(f => ({ ...f, from: e.target.value }))}
                                  placeholder="From"
                                  style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%" }} />
                              </td>
                              <td style={{ padding: "6px 16px" }}>
                                <input value={junctionEditForm.to} onChange={e => setJunctionEditForm(f => ({ ...f, to: e.target.value }))}
                                  placeholder="To"
                                  style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%" }} />
                              </td>
                              <td style={{ padding: "6px 16px", width: 140 }}>
                                <input type="number" value={junctionEditForm.length} onChange={e => setJunctionEditForm(f => ({ ...f, length: e.target.value }))}
                                  style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%", textAlign: "right" }} />
                              </td>
                              <td style={{ padding: "6px 16px", textAlign: "right", color: colors.textLight }}>—</td>
                              <td style={{ padding: "6px 16px", textAlign: "right", color: colors.textLight }}>—</td>
                              <td style={{ padding: "6px 16px", whiteSpace: "nowrap" }}>
                                <button onClick={saveJunctionEdit} style={{ background: colors.navy, color: "white", border: "none", borderRadius: 4, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 6, fontFamily: "'Source Sans 3', sans-serif" }}>Save</button>
                                <button onClick={() => setJunctionEdit(null)} style={{ background: "none", color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 4, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>Cancel</button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={{ padding: "10px 16px", color: colors.text, fontWeight: 500 }}>{j.from}</td>
                              <td style={{ padding: "10px 16px", color: colors.text, fontWeight: 500 }}>{j.to}</td>
                              <td style={{ padding: "10px 16px", color: colors.navy, fontWeight: 600, textAlign: "right" }}>{parseFloat(j.length).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                              <td style={{ padding: "10px 16px", color: completedLength > 0 ? colors.green : colors.textLight, fontWeight: completedLength > 0 ? 600 : 400, textAlign: "right" }}>
                                {completedLength > 0 ? completedLength.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                              </td>
                              <td style={{ padding: "10px 16px", color: balanceLength < 0 ? "#dc2626" : balanceLength === 0 ? colors.textLight : colors.gold, fontWeight: 600, textAlign: "right" }}>
                                {balanceLength.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                              </td>
                              <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>
                                <button onClick={() => { setJunctionEdit(idx); setJunctionEditForm({ from: j.from, to: j.to, length: String(j.length) }); }}
                                  style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.navy, fontSize: 12, fontWeight: 600, padding: "4px 12px", cursor: "pointer", marginRight: 6, fontFamily: "'Source Sans 3', sans-serif" }}>Edit</button>
                                {junctionDeleteConfirm === idx ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>Confirm?</span>
                                    <button onClick={() => { deleteJunction(idx); setJunctionDeleteConfirm(null); }}
                                      style={{ background: "#dc2626", border: "none", borderRadius: 4, color: "#fff", fontSize: 12, fontWeight: 600, padding: "4px 10px", cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>Yes</button>
                                    <button onClick={() => setJunctionDeleteConfirm(null)}
                                      style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.text, fontSize: 12, fontWeight: 600, padding: "4px 10px", cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>No</button>
                                  </span>
                                ) : (
                                  <button onClick={() => setJunctionDeleteConfirm(idx)}
                                    style={{ background: "none", border: "1px solid #fca5a5", borderRadius: 4, color: "#dc2626", fontSize: 12, fontWeight: 600, padding: "4px 12px", cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>Delete</button>
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {/* Add new row */}
                    <tr style={{ borderTop: `2px solid ${colors.border}`, background: "#f9fafb" }}>
                      <td style={{ padding: "10px 16px", color: colors.textLight, fontWeight: 600, fontSize: 12, textAlign: "right" }}>+</td>
                      <td style={{ padding: "8px 16px" }}>
                        <input value={newJunction.from} onChange={e => setNewJunction(f => ({ ...f, from: e.target.value }))}
                          placeholder="From (e.g. J-96)"
                          style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%" }}
                          onKeyDown={e => e.key === "Enter" && addJunction()} />
                      </td>
                      <td style={{ padding: "8px 16px" }}>
                        <input value={newJunction.to} onChange={e => setNewJunction(f => ({ ...f, to: e.target.value }))}
                          placeholder="To (e.g. PH-2)"
                          style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%" }}
                          onKeyDown={e => e.key === "Enter" && addJunction()} />
                      </td>
                      <td style={{ padding: "8px 16px", width: 140 }}>
                        <input type="number" value={newJunction.length} onChange={e => setNewJunction(f => ({ ...f, length: e.target.value }))}
                          placeholder="Length in m"
                          style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%", textAlign: "right" }}
                          onKeyDown={e => e.key === "Enter" && addJunction()} />
                      </td>
                      <td colSpan={2} />
                      <td style={{ padding: "8px 16px" }}>
                        <button onClick={addJunction} disabled={!newJunction.from.trim() || !newJunction.to.trim()}
                          style={{ background: (newJunction.from.trim() && newJunction.to.trim()) ? colors.gold : "#e8ecf6", color: (newJunction.from.trim() && newJunction.to.trim()) ? "white" : colors.textLight, border: "none", borderRadius: 4, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: (newJunction.from.trim() && newJunction.to.trim()) ? "pointer" : "not-allowed", fontFamily: "'Source Sans 3', sans-serif" }}>
                          Add Junction
                        </button>
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr style={{ background: colors.formBg, borderTop: `1px solid ${colors.border}` }}>
                      <td colSpan={3} style={{ padding: "10px 16px", fontSize: 12, fontWeight: 700, color: colors.textMid, textTransform: "uppercase", letterSpacing: 0.6 }}>Totals</td>
                      <td style={{ padding: "10px 16px", fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: colors.gold, textAlign: "right" }}>
                        {totalJunctionLength.toLocaleString("en-IN", { maximumFractionDigits: 2 })} m
                      </td>
                      <td style={{ padding: "10px 16px", fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: colors.green, textAlign: "right" }}>
                        {junctionData.reduce((s, j) => s + ledger.filter(e => e.cluster === selectedJunctionCluster && e.junctionFrom === j.from && e.junctionTo === j.to).reduce((a, e) => a + (parseFloat(e.length) || 0), 0), 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} m
                      </td>
                      <td style={{ padding: "10px 16px", fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: colors.navy, textAlign: "right" }}>
                        {(totalJunctionLength - junctionData.reduce((s, j) => s + ledger.filter(e => e.cluster === selectedJunctionCluster && e.junctionFrom === j.from && e.junctionTo === j.to).reduce((a, e) => a + (parseFloat(e.length) || 0), 0), 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })} m
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ---- LEDGER TAB ---- */}
        {activeTab === "ledger" && (
          <div>
            {/* Cluster selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7 }}>Cluster</span>
              <div style={{ display: "flex", gap: 8 }}>
                {CLUSTERS.map(c => (
                  <button key={c} onClick={() => { setSelectedLedgerCluster(c); setSelectedPending(new Set()); setGeneratedApprovalId(null); }}
                    style={{ padding: "6px 18px", borderRadius: 6, border: selectedLedgerCluster === c ? "none" : `1px solid ${colors.border}`, background: selectedLedgerCluster === c ? colors.navy : colors.white, color: selectedLedgerCluster === c ? "white" : colors.textMid, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.15s" }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {ledger.length === 0 ? (
              <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, textAlign: "center", padding: "80px 24px" }}>
                <div style={{ fontSize: 38, marginBottom: 16 }}>📋</div>
                <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 18, color: colors.text, marginBottom: 8 }}>No Entries Yet</div>
                <div style={{ fontSize: 13, color: colors.textLight }}>Add your first compensation entry from the New Entry tab.</div>
              </div>
            ) : (
              <>
                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 22 }}>
                  {[
                    { label: "Total Compensation", value: `Rs. ${totalComp.toLocaleString("en-IN")}`, color: colors.gold },
                    { label: "Completed Length", value: `${clusterLedger.reduce((s, e) => s + (parseFloat(e.length) || 0), 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} m`, color: colors.green },
                  ].map(s => (
                    <div key={s.label} style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, padding: "20px 24px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>{s.label}</div>
                      <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 26, fontWeight: 600, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Sub-tabs */}
                <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
                  {/* Sub-tab bar */}
                  <div style={{ background: colors.formBg, borderBottom: `1px solid ${colors.border}`, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex" }}>
                      {[["records", "Compensation Records"], ["pending", `Pending Approval`]].map(([id, label]) => (
                        <button key={id} onClick={() => setLedgerSubTab(id)}
                          style={{ background: "none", border: "none", borderBottom: ledgerSubTab === id ? `2px solid ${colors.navy}` : "2px solid transparent", color: ledgerSubTab === id ? colors.navy : colors.textLight, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: ledgerSubTab === id ? 700 : 500, padding: "12px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                          {label}
                          {id === "records" && (
                            <span style={{ background: "#e8ecf6", color: "#3a4566", fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>{clusterLedger.length}</span>
                          )}
                          {id === "pending" && (
                            <span style={{ background: pendingEntries.length > 0 ? "#fef3c7" : "#e8ecf6", color: pendingEntries.length > 0 ? "#92400e" : "#3a4566", fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>{pendingEntries.length}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    {ledgerSubTab === "records" && (
                      <button className="btn-sec" style={{ padding: "5px 14px", background: colors.white, color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 5, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, cursor: "pointer" }}
                        onClick={() => exportToCSV(clusterLedger)}>↓ Export CSV</button>
                    )}
                  </div>

                  {/* ---- Compensation Records sub-tab ---- */}
                  {ledgerSubTab === "records" && (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr>
                            {["#", "Date", "Approval ID", "Cluster", "Village", "Khasra No.", "Jn. From", "Jn. To", "Chainage", "Length", "ROW", "Land Owner", "Farmer / Lessee", "Crop", "Area (Ha)", "Mandi Rate", "Yield", "Compensation", "Bank", "Account No.", "IFSC", "Cheque/RTGS Details", ""].map(h => (
                              <th key={h} style={{ background: colors.formBg, color: "#6b7490", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, padding: "10px 14px", textAlign: "left", borderBottom: `1px solid ${colors.border}`, whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {clusterLedger.map((e, i) => (
                            <tr key={i} className="trow" style={{ borderBottom: `1px solid #f0f2f8` }}>
                              <td style={{ padding: "11px 14px", color: colors.textLight, fontWeight: 600, fontSize: 12 }}>{e.srNo}</td>
                              <td style={{ padding: "11px 14px", color: colors.textMid }}>{e.date}</td>
                              <td style={{ padding: "11px 14px" }}>
                                {e.approvalId ? (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    <span style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{e.approvalId}</span>
                                    {e.paymentDetails
                                      ? <span style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>✓ Paid</span>
                                      : <span style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>Approved</span>}
                                  </div>
                                ) : <span style={{ color: colors.textLight, fontSize: 11 }}>Pending</span>}
                              </td>
                              <td style={{ padding: "11px 14px" }}>{e.cluster}</td>
                              <td style={{ padding: "11px 14px" }}>{e.village}</td>
                              <td style={{ padding: "11px 14px", color: colors.navy, fontWeight: 600 }}>{e.khasraNo}</td>
                              <td style={{ padding: "11px 14px" }}>{e.junctionFrom}</td>
                              <td style={{ padding: "11px 14px" }}>{e.junctionTo}</td>
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
                              <td style={{ padding: "11px 14px", maxWidth: 200, color: e.paymentDetails ? colors.text : colors.textLight, fontStyle: e.paymentDetails ? "normal" : "italic" }}>{e.paymentDetails || "—"}</td>
                              <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                                <button onClick={() => handleEdit(e)}
                                  style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.navy, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600, padding: "4px 12px", cursor: "pointer", marginRight: 6 }}>
                                  Edit
                                </button>
                                {e.approvalId && (
                                  paymentEntry === e._id ? (
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                      <input
                                        autoFocus
                                        value={paymentInput}
                                        onChange={ev => setPaymentInput(ev.target.value)}
                                        onKeyDown={ev => { if (ev.key === "Enter") handleSavePayment(); if (ev.key === "Escape") { setPaymentEntry(null); setPaymentInput(""); } }}
                                        placeholder="Cheque/RTGS details"
                                        style={{ border: `1px solid ${colors.border}`, borderRadius: 4, padding: "4px 8px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, width: 200 }}
                                      />
                                      <button onClick={handleSavePayment} disabled={!paymentInput.trim()}
                                        style={{ background: paymentInput.trim() ? colors.green : "#e8ecf6", color: paymentInput.trim() ? "white" : colors.textLight, border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: paymentInput.trim() ? "pointer" : "not-allowed", fontFamily: "'Source Sans 3', sans-serif" }}>Save</button>
                                      <button onClick={() => { setPaymentEntry(null); setPaymentInput(""); }}
                                        style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMid, padding: "4px 8px", fontSize: 12, cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>✕</button>
                                    </span>
                                  ) : (
                                    <button onClick={() => { setPaymentEntry(e._id); setPaymentInput(e.paymentDetails || ""); }}
                                      style={{ background: "none", border: `1px solid ${e.paymentDetails ? "#86efac" : "#bfdbfe"}`, borderRadius: 4, color: e.paymentDetails ? "#166534" : "#1d4ed8", fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600, padding: "4px 12px", cursor: "pointer" }}>
                                      {e.paymentDetails ? "Edit Payment" : "Add Payment"}
                                    </button>
                                  )
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* ---- Pending Approval sub-tab ---- */}
                  {ledgerSubTab === "pending" && (
                    <div>
                      {pendingEntries.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "60px 24px" }}>
                          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 17, color: colors.text, marginBottom: 6 }}>No Pending Entries</div>
                          <div style={{ fontSize: 13, color: colors.textLight }}>All entries have been approved. New entries will appear here.</div>
                        </div>
                      ) : (
                        <>
                          {/* Generate ID / Accept bar */}
                          <div style={{ background: "#fffbeb", borderBottom: `1px solid #fde68a`, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 }}>
                                {pendingEntries.length} {pendingEntries.length === 1 ? "entry" : "entries"} awaiting approval
                                {selectedPending.size > 0 && <span style={{ marginLeft: 8, color: colors.navy }}>— {selectedPending.size} selected</span>}
                              </div>
                              {generatedApprovalId && (
                                <div style={{ fontSize: 13, color: "#78350f", marginTop: 4 }}>
                                  Generated ID: <strong style={{ fontFamily: "monospace", background: "#fef3c7", padding: "2px 8px", borderRadius: 4 }}>{generatedApprovalId}</strong>
                                </div>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 10 }}>
                              {!generatedApprovalId ? (
                                <button onClick={handleGenerateId} disabled={selectedPending.size === 0}
                                  style={{ background: selectedPending.size > 0 ? colors.gold : "#e8ecf6", color: selectedPending.size > 0 ? "white" : colors.textLight, border: "none", borderRadius: 5, padding: "8px 20px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 600, cursor: selectedPending.size > 0 ? "pointer" : "not-allowed" }}>
                                  Generate ID for {selectedPending.size > 0 ? `${selectedPending.size} Selected` : "Selected"}
                                </button>
                              ) : (
                                <>
                                  <button onClick={() => setGeneratedApprovalId(null)}
                                    style={{ background: colors.white, color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 5, padding: "8px 16px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, cursor: "pointer" }}>
                                    Cancel
                                  </button>
                                  <button onClick={handleAcceptPending} disabled={loading}
                                    style={{ background: colors.green, color: "white", border: "none", borderRadius: 5, padding: "8px 20px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
                                    {loading ? "Processing…" : "Accept & Download Excel"}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Pending table */}
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                              <thead>
                                <tr>
                                  <th style={{ background: "#fffbeb", borderBottom: `1px solid #fde68a`, padding: "10px 14px" }}>
                                    <input type="checkbox"
                                      checked={pendingEntries.length > 0 && pendingEntries.every(e => selectedPending.has(e._id))}
                                      onChange={ev => setSelectedPending(ev.target.checked ? new Set(pendingEntries.map(e => e._id)) : new Set())}
                                      style={{ cursor: "pointer" }} />
                                  </th>
                                  {["#", "Date", "Cluster", "Village", "Khasra No.", "Jn. From", "Jn. To", "Chainage", "Length", "ROW", "Land Owner", "Farmer / Lessee", "Crop", "Area (Ha)", "Mandi Rate", "Yield", "Compensation", "Bank", "Account No.", "IFSC", ""].map(h => (
                                    <th key={h} style={{ background: "#fffbeb", color: "#92400e", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, padding: "10px 14px", textAlign: "left", borderBottom: `1px solid #fde68a`, whiteSpace: "nowrap" }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {pendingEntries.map((e, i) => (
                                  <tr key={i} className="trow" style={{ borderBottom: `1px solid #f0f2f8`, background: selectedPending.has(e._id) ? "#fffbeb" : undefined }}>
                                    <td style={{ padding: "11px 14px" }}>
                                      <input type="checkbox" checked={selectedPending.has(e._id)}
                                        onChange={ev => setSelectedPending(prev => { const s = new Set(prev); ev.target.checked ? s.add(e._id) : s.delete(e._id); return s; })}
                                        style={{ cursor: "pointer" }} />
                                    </td>
                                    <td style={{ padding: "11px 14px", color: colors.textLight, fontWeight: 600, fontSize: 12 }}>{e.srNo}</td>
                                    <td style={{ padding: "11px 14px", color: colors.textMid }}>{e.date}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.cluster}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.village}</td>
                                    <td style={{ padding: "11px 14px", color: colors.navy, fontWeight: 600 }}>{e.khasraNo}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.junctionFrom}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.junctionTo}</td>
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
                                    <td style={{ padding: "11px 14px" }}>
                                      <button onClick={() => handleEdit(e)}
                                        style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.navy, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600, padding: "4px 12px", cursor: "pointer" }}>
                                        Edit
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
