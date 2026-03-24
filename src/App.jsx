import React, { useState, useRef, useCallback, useEffect } from "react";
import Anthropic from "@anthropic-ai/sdk";
import Login from "./Login";
import { supabase } from "./supabaseClient";

const CLUSTERS = ["A", "B", "C", "D1", "D2", "E"];

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
  { key: "remarks", label: "Remarks", group: "pipeline", type: "textarea" },
  { key: "landOwnerName", label: "Land Owner Name", group: "parties" },
  { key: "farmerName", label: "Farmer / Lessee Name", group: "parties" },
  { key: "crop", label: "Crop", group: "compensation" },
  { key: "affectedArea", label: "Affected Area (Ha)", group: "compensation" },
  { key: "mandiRate", label: "Mandi Rate (Rs/quintal)", group: "compensation" },
  { key: "yield", label: "Yield (quintals/ha)", group: "compensation" },
  { key: "compensationAmount", label: "Compensation Amount (Rs)", group: "compensation" },
  { key: "paymentMode", label: "Payment Mode", group: "banking", type: "select", options: ["", "Account Pay Cheque", "RTGS"] },
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
    const sameCluster = !form.cluster || !entry.cluster || entry.cluster === form.cluster;
    if (
      sameCluster &&
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
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
        { type: "text", text: `This crop compensation document has two key pages:
- Annexure-1 (summary sheet): contains land owner name, bank details, crop, mandi rate, yield per hectare, and the TOTAL compensation amount for all segments combined.
- Annexure-2 (measurement table): contains one row per pipeline segment, each with its own Khasra No., junction range (From/To), chainage range (From/To), length in metres, pipe diameter (MM), ROW width (m), area in SQM, and affected area in hectares.

Extract one entry per row in the Annexure-2 measurement table. Return ONLY a valid JSON object with no preamble or markdown:

{
  "pdfTotalAmount": <total compensation amount numeric from Annexure-1>,
  "entries": [
    {
      "village": "",
      "cluster": "<one of: A, B, C, D1, D2, E>",
      "khasraNo": "<from this Annexure-2 row>",
      "junctionFrom": "<from this row, e.g. J-67>",
      "junctionTo": "<from this row, e.g. J-71>",
      "chainageFrom": <numeric from this row>,
      "chainageTo": <numeric from this row>,
      "length": <metres numeric from this row>,
      "dia": <MM numeric from this row>,
      "row": <ROW metres numeric from this row>,
      "landOwnerName": "<from Annexure-1>",
      "farmerName": "<lessee who receives compensation, from Annexure-1>",
      "crop": "<from Annexure-1>",
      "affectedArea": <hectares numeric — THIS ROW'S affected area from Annexure-2, NOT the Annexure-1 total>,
      "mandiRate": <per quintal numeric from Annexure-1>,
      "yield": <quintals per hectare numeric from Annexure-1>,
      "bankName": "<from Annexure-1>",
      "accountNo": "<from Annexure-1>",
      "ifscCode": "<from Annexure-1>"
    }
  ]
}

Use empty string for any text field not found. Use 0 for any numeric field not found. Return only the JSON object.` }
      ]
    }]
  });
  const text = response.content.map(b => b.type === "text" ? b.text : "").join("");
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  // Normalise: accept both { pdfTotalAmount, entries } and a bare array
  if (Array.isArray(parsed)) return { pdfTotalAmount: null, entries: parsed };
  if (parsed.entries) return parsed;
  return { pdfTotalAmount: null, entries: [parsed] };
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

function getDocumentUrl(path) {
  const { data } = supabase.storage.from('entry-documents').getPublicUrl(path);
  return data.publicUrl;
}

function parseChainageVal(val) {
  if (!val) return 0;
  const s = String(val).trim();
  if (s.includes('+')) {
    const parts = s.split('+');
    return parseFloat(parts[0]) * 1000 + parseFloat(parts[1] || 0);
  }
  return parseFloat(s) || 0;
}

function downloadJunctionExcel(jFrom, jTo, entries) {
  const headers = ["#", "Chainage From", "Chainage To", "Length (m)", "Amount (Rs.)", "Farmer Name", "Top Sheet No", "Remarks"];
  const rows = entries.map((e, i) => [i + 1, e.chainageFrom || "", e.chainageTo || "", e.length || "", e.compensationAmount || "", e.farmerName || "", e.approvalId || "Pending", e.remarks || ""]);
  const tableHTML = `<html><head><meta charset="UTF-8"></head><body><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  const blob = new Blob([tableHTML], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `junction_${jFrom}_${jTo}_${new Date().toISOString().split("T")[0]}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

const PROJECT_NAME = "CHINKI BORAS BARRAGE COMBINED MULTIPURPOSE PROJECT";

function downloadTopSheetExcel(entries, approvalId, cluster) {
  const rowWidth = entries[0]?.row || "";
  const date = entries[0]?.date || new Date().toLocaleDateString("en-IN");
  const headers = ["S.NO", "PIPE DIA (MM)", "VILLAGE NAME", "JUNCTION", "CHAINAGE FROM", "CHAINAGE TO", "LENGTH (RMT)", "ROW (M)", "LAND AREA (M2)", "REQUIRED AREA (HA)", "KHASRA NO.", "CROP / PLANT", "PRODUCTIVITY/HA (QUINTAL) (B)", "PRODUCTIVITY IN REQUIRED AREA (C=AxB)", "RATE/QUINTAL (\u20b9) (D)", "AMOUNT (E=CxD)", "FARMER / LESSEE NAME", "PAYMENT MODE", "REMARKS"];
  const rows = entries.map((e, i) => {
    const area = parseFloat(e.affectedArea) || 0;
    const yld = parseFloat(e.yield) || 0;
    const prodInArea = area && yld ? parseFloat((area * yld).toFixed(3)) : "";
    const landArea = area ? Math.round(area * 10000) : "";
    return [i + 1, e.dia || "", e.village || "", `${e.junctionFrom || ""}${e.junctionTo ? "-" + e.junctionTo : ""}`, e.chainageFrom || "", e.chainageTo || "", e.length || "", e.row || "", landArea, area || "", e.khasraNo || "", e.crop || "", yld || "", prodInArea, e.mandiRate || "", e.compensationAmount || "", e.farmerName || "", e.paymentMode || "", e.remarks || ""];
  });
  const totalLength = entries.reduce((s, e) => s + (parseFloat(e.length) || 0), 0);
  const totalArea = entries.reduce((s, e) => s + (parseFloat(e.affectedArea) || 0), 0);
  const totalAmount = entries.reduce((s, e) => s + (parseFloat(e.compensationAmount) || 0), 0);
  const rtgsEntries = entries.filter(e => e.paymentMode === "RTGS");
  const rtgsSection = rtgsEntries.length > 0 ? `
    <br/>
    <table style="border:none;width:100%">
      ${rtgsEntries.map((e, i) => i % 2 === 0 ? `<tr>
        <td style="border:1px solid #ccc;padding:10px;width:50%;vertical-align:top">
          <b>Bank details for RTGS :</b><br/>
          <b>${i + 1})</b><br/>
          Account Name - <b>${e.landOwnerName || e.farmerName || ""}</b><br/>
          Bank Name - <b>${e.bankName || ""}</b><br/>
          A/c No. - <b>${e.accountNo || ""}</b><br/>
          IFSC No. - <b>${e.ifscCode || ""}</b>
        </td>
        ${rtgsEntries[i + 1] ? `<td style="border:1px solid #ccc;padding:10px;width:50%;vertical-align:top">
          <b>Bank details for RTGS :</b><br/>
          <b>${i + 2})</b><br/>
          Account Name - <b>${rtgsEntries[i + 1].landOwnerName || rtgsEntries[i + 1].farmerName || ""}</b><br/>
          Bank Name - <b>${rtgsEntries[i + 1].bankName || ""}</b><br/>
          A/c No. - <b>${rtgsEntries[i + 1].accountNo || ""}</b><br/>
          IFSC No. - <b>${rtgsEntries[i + 1].ifscCode || ""}</b>
        </td>` : "<td></td>"}
      </tr>` : "").filter(Boolean).join("")}
    </table>` : "";
  const tableHTML = `<html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;font-size:10pt}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #000;padding:4px 6px;text-align:center;vertical-align:middle}
    .nh{border:none;text-align:center}
  </style></head><body>
    <p style="text-align:center;font-weight:bold;font-size:12pt;margin:2px 0">${PROJECT_NAME}</p>
    <table style="border:none;margin-bottom:6px">
      <tr><td class="nh" colspan="2" style="text-align:left">CLUSTER ${cluster}</td></tr>
      <tr><td class="nh" colspan="2" style="text-align:center;font-weight:bold">CROP COMPENSATION ABSTRACT</td></tr>
      <tr><td class="nh" style="text-align:left">S.No: ${approvalId}</td><td class="nh" style="text-align:right">Date: ${date}</td></tr>
    </table>
    <table>
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}
        <tr><td colspan="6" style="font-weight:bold;text-align:right">TOTAL</td><td style="font-weight:bold">${totalLength}</td><td></td><td style="font-weight:bold">${totalArea.toFixed(3)}</td><td colspan="5"></td><td style="font-weight:bold">${totalAmount.toLocaleString("en-IN")}</td><td colspan="3"></td></tr>
      </tbody>
    </table>
    ${rtgsSection}
  </body></html>`;
  const blob = new Blob([tableHTML], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `TopSheet_${approvalId}_Cluster${cluster}_${new Date().toISOString().split("T")[0]}.xls`;
  a.click();
  URL.revokeObjectURL(url);
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
  const [clusterJunctions, setClusterJunctions] = useState({});
  const [selectedJunctionCluster, setSelectedJunctionCluster] = useState("A");
  const [selectedTopsheetCluster, setSelectedTopsheetCluster] = useState("A");
  const [topsheetSearch, setTopsheetSearch] = useState("");
  const [topsheetSelected, setTopsheetSelected] = useState(null);
  const [expandedJunctions, setExpandedJunctions] = useState(new Set()); // indices of expanded junction rows (empty = all collapsed)
  const [junctionEdit, setJunctionEdit] = useState(null); // index of row being edited
  const [junctionEditForm, setJunctionEditForm] = useState({ from: "", to: "", length: "", dia: "" });
  const [newJunction, setNewJunction] = useState({ from: "", to: "", length: "", dia: "" });
  const [junctionDeleteConfirm, setJunctionDeleteConfirm] = useState(null);
  const [selectedPending, setSelectedPending] = useState(new Set());
  const [selectedLedgerCluster, setSelectedLedgerCluster] = useState("A");
  const [paymentEntry, setPaymentEntry] = useState(null); // _id of record being paid
  const [paymentInput, setPaymentInput] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null); // _id of record pending delete
  const [uploadFile, setUploadFile] = useState(null); // document to attach to entry
  // Batch extraction state
  const [extractedEntries, setExtractedEntries] = useState([]); // all rows extracted from PDF
  const [currentEntryIndex, setCurrentEntryIndex] = useState(0); // which one is being reviewed
  const [batchEntries, setBatchEntries] = useState([]); // confirmed entries not yet committed to DB
  const [batchPdfTotal, setBatchPdfTotal] = useState(null); // total compensation from PDF Annexure-1
  const fileRef = useRef();
  const docFileRef = useRef();

  // Load junctions from Supabase when user logs in or switches to junctions tab
  useEffect(() => {
    if (!loggedIn) return;
    const fetchAllJunctions = async () => {
      const pageSize = 1000;
      let allData = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from("junctions").select("*").order("id", { ascending: true }).range(from, from + pageSize - 1);
        if (error) { console.error("Failed to load junctions:", error.message); return; }
        if (!data || data.length === 0) break;
        allData = [...allData, ...data];
        if (data.length < pageSize) break;
        from += pageSize;
      }
      const grouped = Object.fromEntries(CLUSTERS.map(c => [c, []]));
      allData.forEach(row => {
        if (grouped[row.cluster]) grouped[row.cluster].push({ id: row.id, from: row.junction_from, to: row.junction_to, length: row.length, dia: row.pipe_dia ?? 0 });
      });
      setClusterJunctions(grouped);
    };
    fetchAllJunctions();
  }, [loggedIn, activeTab === "junctions"]);

  // Load ledger from Supabase when user logs in
  useEffect(() => {
    if (!loggedIn) return;
    const fetchAllLedger = async () => {
      const pageSize = 1000;
      let allData = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from("ledger").select("*").order("id", { ascending: true }).range(from, from + pageSize - 1);
        if (error) { console.error("Failed to load ledger:", error.message); return; }
        if (!data || data.length === 0) break;
        allData = [...allData, ...data];
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setLedger(allData.map(row => ({
        _id: row.id,
        srNo: row.id,
        date: row.date || '',
        approvalId: row.approval_id || null,
        cluster: row.cluster || '',
        village: row.village || '',
        khasraNo: row.khasra_no || '',
        junctionFrom: row.junction_from || '',
        junctionTo: row.junction_to || '',
        chainageFrom: row.chainage_from || '',
        chainageTo: row.chainage_to || '',
        length: row.length != null ? String(row.length) : '',
        dia: row.pipe_dia != null ? String(row.pipe_dia) : '',
        row: row.row_width != null ? String(row.row_width) : '',
        landOwnerName: row.land_owner_name || '',
        farmerName: row.farmer_name || '',
        crop: row.crop || '',
        affectedArea: row.affected_area != null ? String(row.affected_area) : '',
        mandiRate: row.mandi_rate != null ? String(row.mandi_rate) : '',
        yield: row.yield != null ? String(row.yield) : '',
        compensationAmount: row.compensation_amount != null ? String(row.compensation_amount) : '',
        paymentMode: row.payment_mode || '',
        bankName: row.bank_name || '',
        accountNo: row.account_no || '',
        ifscCode: row.ifsc_code || '',
        paymentDetails: row.payment_details || '',
        remarks: row.remarks || '',
        documentPath: row.document_path || null,
      })));
    };
    fetchAllLedger();
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
      const result = await extractFromPDF(base64);
      const rawEntries = result.entries || [];
      const pdfTotal = result.pdfTotalAmount || null;
      const enriched = rawEntries.map(e => {
        // Auto-calculate length and affectedArea from formulas
        const chainFrom = parseFloat(e.chainageFrom) || 0;
        const chainTo = parseFloat(e.chainageTo) || 0;
        const row = parseFloat(e.row) || 0;
        const calcLength = parseFloat((chainTo - chainFrom).toFixed(3));
        const calcArea = row ? parseFloat((calcLength * row / 10000).toFixed(6)) : 0;
        // Keep AI-extracted values for mismatch comparison
        const _docLength = parseFloat(e.length) || 0;
        const _docAffectedArea = parseFloat(e.affectedArea) || 0;
        // Calculate compensationAmount from formula: affectedArea × mandiRate × yield
        const mandi = parseFloat(e.mandiRate) || 0;
        const yld = parseFloat(e.yield) || 0;
        const calcComp = calcArea && mandi && yld ? parseFloat((calcArea * mandi * yld).toFixed(2)) : 0;
        return {
          ...EMPTY_FORM, ...e,
          length: calcLength ? String(calcLength) : "",
          affectedArea: calcArea ? String(calcArea) : "",
          compensationAmount: calcComp ? String(calcComp) : "",
          _docLength, _docAffectedArea,
        };
      });
      setExtractedEntries(enriched);
      setBatchPdfTotal(pdfTotal);
      setBatchEntries([]);
      setCurrentEntryIndex(0);
      setForm(enriched[0] || EMPTY_FORM);
      setCalcFlags(verifyCalculations(enriched[0] || EMPTY_FORM));
      setUploadFile(file);
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
    // Auto-recalculate affectedArea and compensationAmount when relevant fields change
    if (["length", "row", "mandiRate", "yield"].includes(key)) {
      const length = parseFloat(key === "length" ? val : updated.length) || 0;
      const row = parseFloat(key === "row" ? val : updated.row) || 0;
      const mandi = parseFloat(key === "mandiRate" ? val : updated.mandiRate) || 0;
      const yld = parseFloat(key === "yield" ? val : updated.yield) || 0;
      if (length && row) {
        const calcArea = parseFloat((length * row / 10000).toFixed(6));
        updated.affectedArea = String(calcArea);
        if (mandi && yld) {
          updated.compensationAmount = String(parseFloat((calcArea * mandi * yld).toFixed(2)));
        }
      }
    }
    setForm(updated);
    setCalcFlags(verifyCalculations(updated));
  };

  const handleSave = () => {
    if (editingEntry) {
      // Edit mode: check against ledger minus the entry being edited
      const ledgerToCheck = ledger.filter(e => e.srNo !== editingEntry.srNo);
      const dups = checkDuplicates(form, ledgerToCheck);
      const cFlags = calcFlags.map(f => ({ ...f, severity: "medium" }));
      const all = [...dups, ...cFlags];
      if (all.length > 0) { setWarnings(all); setPendingEntry(form); setStep("warning"); }
      else commitEntry(form);
    } else {
      // Batch new-entry mode: check against existing ledger + already-confirmed batch entries
      const dups = checkDuplicates(form, [...ledger, ...batchEntries]);
      const cFlags = calcFlags.map(f => ({ ...f, severity: "medium" }));
      const all = [...dups, ...cFlags];
      if (all.length > 0) { setWarnings(all); setPendingEntry(form); setStep("warning"); }
      else confirmBatchEntry(form);
    }
  };

  const confirmBatchEntry = (data) => {
    const newBatch = [...batchEntries, data];
    setBatchEntries(newBatch);
    setWarnings([]);
    setPendingEntry(null);
    if (currentEntryIndex < extractedEntries.length - 1) {
      // Advance to next entry
      const nextIdx = currentEntryIndex + 1;
      setCurrentEntryIndex(nextIdx);
      setForm(extractedEntries[nextIdx]);
      setCalcFlags(verifyCalculations(extractedEntries[nextIdx]));
      setStep("reviewing");
    } else {
      // All entries confirmed — go to summary
      setStep("batch-summary");
    }
  };

  const commitEntry = async (data) => {
    if (editingEntry) {
      // UPDATE existing entry — approvalId editable via form
      const { _id, srNo, date } = editingEntry;
      const { _id: _a, srNo: _b, date: _c, approvalId, ...fields } = { ...data };
      let documentPath = editingEntry.documentPath || null;
      if (uploadFile) {
        const ext = uploadFile.name.split('.').pop();
        const storagePath = `${_id}/document.${ext}`;
        const { error: storageError } = await supabase.storage
          .from('entry-documents')
          .upload(storagePath, uploadFile, { upsert: true });
        if (!storageError) documentPath = storagePath;
        else setError(`Document upload failed: ${storageError.message}`);
      }
      const { error: dbError } = await supabase
        .from("ledger")
        .update({
          approval_id: approvalId || null,
          cluster: fields.cluster || null,
          village: fields.village || null,
          khasra_no: fields.khasraNo || null,
          junction_from: fields.junctionFrom || null,
          junction_to: fields.junctionTo || null,
          chainage_from: fields.chainageFrom || null,
          chainage_to: fields.chainageTo || null,
          length: parseFloat(fields.length) || null,
          pipe_dia: parseFloat(fields.dia) || null,
          row_width: parseFloat(fields.row) || null,
          land_owner_name: fields.landOwnerName || null,
          farmer_name: fields.farmerName || null,
          crop: fields.crop || null,
          affected_area: parseFloat(fields.affectedArea) || null,
          mandi_rate: parseFloat(fields.mandiRate) || null,
          yield: parseFloat(fields.yield) || null,
          compensation_amount: parseFloat(fields.compensationAmount) || null,
          payment_mode: fields.paymentMode || null,
          bank_name: fields.bankName || null,
          account_no: fields.accountNo || null,
          ifsc_code: fields.ifscCode || null,
          remarks: fields.remarks || null,
          ...(documentPath ? { document_path: documentPath } : {}),
        })
        .eq("id", _id);
      if (dbError) { setError(`Failed to update: ${dbError.message}`); return; }
      setLedger(prev => prev.map(e => e._id === _id ? { _id, srNo, date, approvalId: approvalId || null, ...fields, ...(documentPath ? { documentPath } : {}) } : e));
      setEditingEntry(null);
    } else {
      // INSERT new entry — no approvalId yet (pending)
      const date = new Date().toLocaleDateString("en-IN");
      const { srNo: _, date: __, approvalId: _d, ...fields } = { ...data };
      const { data: inserted, error: dbError } = await supabase
        .from("ledger")
        .insert({
          date,
          approval_id: null,
          cluster: fields.cluster || null,
          village: fields.village || null,
          khasra_no: fields.khasraNo || null,
          junction_from: fields.junctionFrom || null,
          junction_to: fields.junctionTo || null,
          chainage_from: fields.chainageFrom || null,
          chainage_to: fields.chainageTo || null,
          length: parseFloat(fields.length) || null,
          pipe_dia: parseFloat(fields.dia) || null,
          row_width: parseFloat(fields.row) || null,
          land_owner_name: fields.landOwnerName || null,
          farmer_name: fields.farmerName || null,
          crop: fields.crop || null,
          affected_area: parseFloat(fields.affectedArea) || null,
          mandi_rate: parseFloat(fields.mandiRate) || null,
          yield: parseFloat(fields.yield) || null,
          compensation_amount: parseFloat(fields.compensationAmount) || null,
          payment_mode: fields.paymentMode || null,
          bank_name: fields.bankName || null,
          account_no: fields.accountNo || null,
          ifsc_code: fields.ifscCode || null,
          remarks: fields.remarks || null,
          payment_details: null,
        })
        .select("id")
        .single();
      if (dbError) { setError(`Failed to save to database: ${dbError.message}`); return; }
      const srNo = inserted.id;
      let documentPath = null;
      if (uploadFile) {
        const ext = uploadFile.name.split('.').pop();
        const storagePath = `${inserted.id}/document.${ext}`;
        const { error: storageError } = await supabase.storage
          .from('entry-documents')
          .upload(storagePath, uploadFile, { upsert: true });
        if (!storageError) documentPath = storagePath;
        else setError(`Document upload failed: ${storageError.message}`);
      }
      if (documentPath) {
        await supabase.from("ledger").update({ document_path: documentPath }).eq("id", inserted.id);
      }
      setLedger(prev => [...prev, { ...data, _id: inserted.id, srNo, date, approvalId: null, ...(documentPath ? { documentPath } : {}) }]);
    }
    setForm(EMPTY_FORM); setCalcFlags([]); setWarnings([]); setPendingEntry(null);
    setUploadFile(null);
    if (docFileRef.current) docFileRef.current.value = "";
    setStep("saved");
    setTimeout(() => { setStep("idle"); if (fileRef.current) fileRef.current.value = ""; }, 2500);
  };

  const commitAllBatchEntries = async () => {
    setLoading(true);
    setError("");
    const date = new Date().toLocaleDateString("en-IN");

    // Upload document once for the whole batch, using a timestamp-based folder
    let sharedDocPath = null;
    if (uploadFile) {
      const ext = uploadFile.name.split('.').pop();
      const batchFolder = `batch_${Date.now()}`;
      const storagePath = `${batchFolder}/document.${ext}`;
      const { error: storageError } = await supabase.storage
        .from('entry-documents')
        .upload(storagePath, uploadFile, { upsert: true });
      if (!storageError) sharedDocPath = storagePath;
      else setError(`Document upload failed: ${storageError.message}`);
    }

    const newLedgerEntries = [];
    for (const data of batchEntries) {
      const { srNo: _, date: __, approvalId: _d, ...fields } = { ...data };
      const { data: inserted, error: dbError } = await supabase
        .from("ledger")
        .insert({
          date,
          approval_id: null,
          cluster: fields.cluster || null,
          village: fields.village || null,
          khasra_no: fields.khasraNo || null,
          junction_from: fields.junctionFrom || null,
          junction_to: fields.junctionTo || null,
          chainage_from: fields.chainageFrom || null,
          chainage_to: fields.chainageTo || null,
          length: parseFloat(fields.length) || null,
          pipe_dia: parseFloat(fields.dia) || null,
          row_width: parseFloat(fields.row) || null,
          land_owner_name: fields.landOwnerName || null,
          farmer_name: fields.farmerName || null,
          crop: fields.crop || null,
          affected_area: parseFloat(fields.affectedArea) || null,
          mandi_rate: parseFloat(fields.mandiRate) || null,
          yield: parseFloat(fields.yield) || null,
          compensation_amount: parseFloat(fields.compensationAmount) || null,
          payment_mode: fields.paymentMode || null,
          bank_name: fields.bankName || null,
          account_no: fields.accountNo || null,
          ifsc_code: fields.ifscCode || null,
          remarks: fields.remarks || null,
          payment_details: null,
          document_path: sharedDocPath,
        })
        .select("id")
        .single();
      if (dbError) { setError(`Failed to save entry: ${dbError.message}`); setLoading(false); return; }
      newLedgerEntries.push({ ...data, _id: inserted.id, srNo: inserted.id, date, approvalId: null, documentPath: sharedDocPath });
    }

    setLedger(prev => [...prev, ...newLedgerEntries]);
    // Reset all batch state
    setExtractedEntries([]);
    setBatchEntries([]);
    setBatchPdfTotal(null);
    setCurrentEntryIndex(0);
    setForm(EMPTY_FORM);
    setCalcFlags([]);
    setWarnings([]);
    setPendingEntry(null);
    setUploadFile(null);
    if (docFileRef.current) docFileRef.current.value = "";
    setLoading(false);
    setStep("saved");
    setTimeout(() => { setStep("idle"); if (fileRef.current) fileRef.current.value = ""; }, 2500);
  };

  const handleEdit = (entry) => {
    const { _id, srNo, date, ...fields } = entry;
    setEditingEntry(entry);
    setForm({ ...EMPTY_FORM, ...fields, approvalId: entry.approvalId || "" });
    setCalcFlags(verifyCalculations({ ...EMPTY_FORM, ...fields }));
    setActiveTab("entry");
    setStep("reviewing");
    setError("");
  };

  const cancelEdit = () => {
    setEditingEntry(null);
    setForm(EMPTY_FORM);
    setCalcFlags([]);
    setUploadFile(null);
    setStep("idle");
    setActiveTab("ledger");
  };

  const handleDeleteEntry = async (entry) => {
    setLoading(true);
    const { error: dbError } = await supabase.from("ledger").delete().eq("id", entry._id);
    if (dbError) { setError(`Failed to delete: ${dbError.message}`); setLoading(false); return; }
    setLedger(prev => prev.filter(e => e._id !== entry._id));
    setDeleteConfirm(null);
    setLoading(false);
  };

  const highWarnings = warnings.filter(w => w.severity === "high");
  const clusterLedger = ledger.filter(e => e.cluster === selectedLedgerCluster);
  const pendingEntries = clusterLedger.filter(e => !e.approvalId);
  const totalComp = clusterLedger.reduce((s, e) => s + (parseFloat(e.compensationAmount) || 0), 0);
  const junctionData = clusterJunctions[selectedJunctionCluster] || [];
  const totalJunctionLength = junctionData.reduce((s, j) => s + (parseFloat(j.length) || 0), 0);

  const updateClusterJunctions = (cluster, updater) =>
    setClusterJunctions(prev => ({ ...prev, [cluster]: updater(prev[cluster] || []) }));

  const saveJunctionEdit = async () => {
    if (!junctionEditForm.from.trim() || !junctionEditForm.to.trim()) return;
    const junction = (clusterJunctions[selectedJunctionCluster] || [])[junctionEdit];
    if (!junction?.id) return;
    const updated = { from: junctionEditForm.from.trim(), to: junctionEditForm.to.trim(), length: parseFloat(junctionEditForm.length) || 0, dia: parseFloat(junctionEditForm.dia) || 0 };
    const { error } = await supabase.from("junctions")
      .update({ junction_from: updated.from, junction_to: updated.to, length: updated.length, pipe_dia: updated.dia })
      .eq("id", junction.id);
    if (error) { console.error("Failed to update junction:", error.message); return; }
    updateClusterJunctions(selectedJunctionCluster, arr => arr.map((j, i) => i === junctionEdit ? { ...j, ...updated } : j));
    setJunctionEdit(null);
  };
  const deleteJunction = async (idx) => {
    const junction = (clusterJunctions[selectedJunctionCluster] || [])[idx];
    if (!junction?.id) return;
    const { error } = await supabase.from("junctions").delete().eq("id", junction.id);
    if (error) { console.error("Failed to delete junction:", error.message); return; }
    updateClusterJunctions(selectedJunctionCluster, arr => arr.filter((_, i) => i !== idx));
  };
  const addJunction = async () => {
    if (!newJunction.from.trim() || !newJunction.to.trim()) return;
    const { data: inserted, error } = await supabase.from("junctions")
      .insert({ cluster: selectedJunctionCluster, junction_from: newJunction.from.trim(), junction_to: newJunction.to.trim(), length: parseFloat(newJunction.length) || 0, pipe_dia: parseFloat(newJunction.dia) || 0 })
      .select("id").single();
    if (error) { console.error("Failed to add junction:", error.message); return; }
    updateClusterJunctions(selectedJunctionCluster, arr => [...arr, { id: inserted.id, from: newJunction.from.trim(), to: newJunction.to.trim(), length: parseFloat(newJunction.length) || 0, dia: parseFloat(newJunction.dia) || 0 }]);
    setNewJunction({ from: "", to: "", length: "" });
  };

  const handleAcceptPending = async () => {
    if (!generatedApprovalId || selectedPending.size === 0) return;
    setLoading(true);
    const toApprove = pendingEntries.filter(e => selectedPending.has(e._id));
    for (const entry of toApprove) {
      const { _id, srNo, date, approvalId: _old, ...fields } = entry;
      const { error: dbError } = await supabase
        .from("ledger")
        .update({ approval_id: generatedApprovalId })
        .eq("id", _id);
      if (dbError) { setError(`Failed to approve: ${dbError.message}`); setLoading(false); return; }
    }
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
      .update({ payment_details: paymentInput.trim() })
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
                onClick={() => editingEntry ? commitEntry(pendingEntry) : confirmBatchEntry(pendingEntry)}>
                {highWarnings.length === 0 ? "Confirm Entry" : "Override & Confirm (High Risk)"}
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
        {[["entry", "New Entry"], ["ledger", "Ledger"], ["junctions", "Junctions"], ["topsheets", "Top Sheets"]].map(([id, label]) => (
          <button key={id} className="nav-tab" onClick={() => setActiveTab(id)}
            style={{ background: "none", border: "none", borderBottom: activeTab === id ? `3px solid ${colors.navy}` : "3px solid transparent", color: activeTab === id ? colors.navy : colors.textLight, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: activeTab === id ? 700 : 500, padding: "13px 20px", cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {/* MAIN */}
      <div style={{ padding: "30px 24px" }}>

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
                      {editingEntry ? `Edit Entry #${editingEntry.srNo}` : extractedEntries.length > 1 ? `Review Entry ${currentEntryIndex + 1} of ${extractedEntries.length}` : "Review Extracted Data"}
                    </div>
                    <div style={{ fontSize: 13, color: colors.textLight, marginTop: 3 }}>
                      {editingEntry
                        ? "Make changes below. Validations will run again on submit."
                        : extractedEntries.length > 1
                          ? `This document has ${extractedEntries.length} land segments. Review and confirm each entry — nothing is saved until you commit all entries at the end.`
                          : "Verify all fields before saving. Edit directly if anything needs correction."}
                    </div>
                    {!editingEntry && extractedEntries.length > 1 && (
                      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        {extractedEntries.map((_, i) => (
                          <div key={i} style={{
                            width: 28, height: 6, borderRadius: 3,
                            background: i < currentEntryIndex ? colors.green : i === currentEntryIndex ? colors.navy : colors.border,
                          }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="btn-sec" style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.textLight, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, padding: "6px 13px", cursor: "pointer" }}
                    onClick={editingEntry ? cancelEdit : () => { setStep("idle"); setForm(EMPTY_FORM); setCalcFlags([]); }}>✕ {editingEntry ? "Cancel Edit" : "Clear"}</button>
                </div>

                {editingEntry && (
                  <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, marginBottom: 14, overflow: "hidden" }}>
                    <div style={{ background: "#fffbeb", borderBottom: `1px solid #fde68a`, padding: "11px 20px", display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ fontSize: 14 }}>✅</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.8 }}>Approval</span>
                    </div>
                    <div style={{ padding: "14px 20px" }}>
                      <label style={{ fontSize: 10.5, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6, display: "block" }}>Approval ID</label>
                      <input
                        value={form.approvalId || ""}
                        onChange={e => setForm(prev => ({ ...prev, approvalId: e.target.value }))}
                        placeholder="e.g. RVR-2025-1234"
                        style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: 5, padding: "7px 10px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, boxSizing: "border-box" }}
                      />
                    </div>
                  </div>
                )}
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
                            {f.type === "textarea" ? (
                              <textarea
                                value={form[f.key]}
                                onChange={e => handleFormChange(f.key, e.target.value)}
                                placeholder="—"
                                rows={3}
                                style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: 5, padding: "7px 10px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, resize: "vertical", boxSizing: "border-box" }}
                              />
                            ) : f.type === "select" ? (() => {
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
                            {!editingEntry && f.key === "length" && form._docLength !== undefined && parseFloat(form.length) !== form._docLength && (
                              <div style={{ color: "#dc2626", fontSize: 11, marginTop: 4, fontWeight: 600 }}>Mismatch with the document (doc: {form._docLength})</div>
                            )}
                            {!editingEntry && f.key === "affectedArea" && form._docAffectedArea !== undefined && parseFloat(form.affectedArea) !== form._docAffectedArea && (
                              <div style={{ color: "#dc2626", fontSize: 11, marginTop: 4, fontWeight: 600 }}>Mismatch with the document (doc: {form._docAffectedArea})</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Document Attachment */}
                <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, marginBottom: 14, overflow: "hidden" }}>
                  <div style={{ background: colors.formBg, borderBottom: `1px solid ${colors.border}`, padding: "11px 20px", display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ fontSize: 14 }}>📎</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#3a4566", textTransform: "uppercase", letterSpacing: 0.8 }}>Supporting Document</span>
                  </div>
                  <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    {uploadFile ? (
                      <>
                        <span style={{ fontSize: 13, color: colors.text }}>📄 {uploadFile.name}</span>
                        <button onClick={() => { setUploadFile(null); if (docFileRef.current) docFileRef.current.value = ""; }}
                          style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMid, fontSize: 12, padding: "4px 10px", cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>Remove</button>
                        <span style={{ fontSize: 12, color: colors.textLight }}>|</span>
                      </>
                    ) : editingEntry?.documentPath ? (
                      <>
                        <a href={getDocumentUrl(editingEntry.documentPath)} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 13, color: colors.navy, fontWeight: 600, textDecoration: "none" }}>📄 View Current Document</a>
                        <span style={{ fontSize: 12, color: colors.textLight }}>·</span>
                      </>
                    ) : null}
                    <button onClick={() => docFileRef.current.click()}
                      style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.navy, fontSize: 13, fontWeight: 600, padding: "7px 16px", cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>
                      {uploadFile ? "Replace" : editingEntry?.documentPath ? "Upload New" : "Attach Document"}
                    </button>
                    <input ref={docFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: "none" }}
                      onChange={e => e.target.files[0] && setUploadFile(e.target.files[0])} />
                    <span style={{ fontSize: 12, color: colors.textLight }}>PDF, JPG, PNG accepted</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button className="btn-sec" style={{ padding: "11px 20px", background: colors.white, color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, cursor: "pointer" }}
                    onClick={editingEntry ? cancelEdit : () => {
                      setStep("idle"); setForm(EMPTY_FORM); setCalcFlags([]);
                      setExtractedEntries([]); setBatchEntries([]); setBatchPdfTotal(null); setCurrentEntryIndex(0); setUploadFile(null);
                    }}>Cancel</button>
                  <button className="btn-primary" style={{ flex: 1, padding: "11px 0", background: colors.navy, color: colors.white, border: "none", borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                    onClick={handleSave}>
                    {editingEntry
                      ? "Run Checks & Update Entry →"
                      : extractedEntries.length > 1
                        ? currentEntryIndex < extractedEntries.length - 1
                          ? `Run Checks & Confirm Entry ${currentEntryIndex + 1} →`
                          : `Run Checks & Confirm Final Entry →`
                        : "Run Checks & Save Entry →"}
                  </button>
                </div>
              </div>
            )}

            {/* ---- Batch Summary ---- */}
            {step === "batch-summary" && (() => {
              const batchSum = batchEntries.reduce((s, e) => s + (parseFloat(e.compensationAmount) || 0), 0);
              const pdfTotal = parseFloat(batchPdfTotal) || 0;
              const diff = parseFloat((batchSum - pdfTotal).toFixed(2));
              const match = pdfTotal > 0 && Math.abs(diff) <= 2;
              return (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <div>
                      <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, color: colors.text }}>
                        Batch Summary — {batchEntries.length} {batchEntries.length === 1 ? "Entry" : "Entries"} Ready
                      </div>
                      <div style={{ fontSize: 13, color: colors.textLight, marginTop: 3 }}>
                        Review the summary below and commit all entries to the ledger at once.
                      </div>
                    </div>
                    <button className="btn-sec" style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.textLight, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, padding: "6px 13px", cursor: "pointer" }}
                      onClick={() => {
                        setStep("idle"); setForm(EMPTY_FORM); setCalcFlags([]);
                        setExtractedEntries([]); setBatchEntries([]); setBatchPdfTotal(null); setCurrentEntryIndex(0); setUploadFile(null);
                      }}>✕ Cancel Batch</button>
                  </div>

                  {/* Comparison card */}
                  <div style={{ background: match ? "#f0fdf4" : "#fff7ed", border: `1px solid ${match ? "#86efac" : "#fed7aa"}`, borderRadius: 10, padding: "16px 20px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: match ? "#166534" : "#92400e", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>Sum of Individual Entries</div>
                        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, color: match ? "#166534" : "#92400e" }}>Rs. {batchSum.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                      </div>
                      {pdfTotal > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>PDF Total (Annexure-1)</div>
                          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, color: colors.navy }}>Rs. {pdfTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: match ? "#166534" : "#b45309" }}>
                      {pdfTotal === 0
                        ? "PDF total not found — verify manually"
                        : match
                          ? "Totals match"
                          : `Difference: Rs. ${Math.abs(diff).toLocaleString("en-IN", { maximumFractionDigits: 2 })} — verify before committing`}
                    </div>
                  </div>

                  {/* Entry table */}
                  <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
                    <div style={{ background: colors.formBg, borderBottom: `1px solid ${colors.border}`, padding: "11px 20px" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#3a4566", textTransform: "uppercase", letterSpacing: 0.8 }}>Entries to be Committed</span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr>
                            {["#", "Khasra No.", "Junction", "Chainage", "Length (m)", "Dia (MM)", "ROW (m)", "Affected Area (Ha)", "Mandi Rate", "Yield (q/ha)", "Compensation (Rs)"].map(h => (
                              <th key={h} style={{ background: colors.formBg, color: "#6b7490", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, padding: "9px 14px", textAlign: "left", borderBottom: `1px solid ${colors.border}`, whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {batchEntries.map((e, i) => (
                            <tr key={i} className="trow" style={{ borderBottom: `1px solid #f0f2f8` }}>
                              <td style={{ padding: "10px 14px", color: colors.textLight, fontWeight: 600, fontSize: 12 }}>{i + 1}</td>
                              <td style={{ padding: "10px 14px", fontWeight: 600, color: colors.text }}>{e.khasraNo}</td>
                              <td style={{ padding: "10px 14px", color: colors.textMid }}>{e.junctionFrom} → {e.junctionTo}</td>
                              <td style={{ padding: "10px 14px", color: colors.textMid }}>{e.chainageFrom}–{e.chainageTo}</td>
                              <td style={{ padding: "10px 14px", color: colors.navy, fontWeight: 600 }}>{e.length}</td>
                              <td style={{ padding: "10px 14px", color: colors.textMid }}>{e.dia}</td>
                              <td style={{ padding: "10px 14px", color: colors.textMid }}>{e.row}</td>
                              <td style={{ padding: "10px 14px", color: colors.navy, fontWeight: 600 }}>{e.affectedArea}</td>
                              <td style={{ padding: "10px 14px", color: colors.textMid }}>{e.mandiRate}</td>
                              <td style={{ padding: "10px 14px", color: colors.textMid }}>{e.yield}</td>
                              <td style={{ padding: "10px 14px", fontFamily: "'Lora', Georgia, serif", fontWeight: 600, color: colors.gold }}>
                                {parseFloat(e.compensationAmount) ? parseFloat(e.compensationAmount).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: colors.formBg, borderTop: `1px solid ${colors.border}` }}>
                            <td colSpan={10} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: colors.textMid, textTransform: "uppercase", letterSpacing: 0.6 }}>Total</td>
                            <td style={{ padding: "10px 14px", fontFamily: "'Lora', Georgia, serif", fontSize: 15, fontWeight: 600, color: colors.gold }}>
                              Rs. {batchSum.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {loading ? (
                    <div style={{ textAlign: "center", padding: 24 }}><div className="spinner" /></div>
                  ) : (
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn-sec" style={{ padding: "11px 20px", background: colors.white, color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, cursor: "pointer" }}
                        onClick={() => {
                          // Go back to reviewing the last entry
                          const lastIdx = batchEntries.length - 1;
                          setBatchEntries(batchEntries.slice(0, lastIdx));
                          setCurrentEntryIndex(lastIdx);
                          setForm(extractedEntries[lastIdx] || EMPTY_FORM);
                          setCalcFlags(verifyCalculations(extractedEntries[lastIdx] || EMPTY_FORM));
                          setStep("reviewing");
                        }}>← Review Last Entry</button>
                      <button className="btn-primary" style={{ flex: 1, padding: "11px 0", background: colors.navy, color: colors.white, border: "none", borderRadius: 6, fontFamily: "'Source Sans 3', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                        onClick={commitAllBatchEntries}>
                        Commit All {batchEntries.length} {batchEntries.length === 1 ? "Entry" : "Entries"} to Ledger →
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
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
                      {[
                        { label: "#", align: "right" },
                        { label: "From", align: "left" },
                        { label: "To", align: "left" },
                        { label: "DIA (mm)", align: "right" },
                        { label: "Node Length (m)", align: "right" },
                        { label: "Complete (m)", align: "right" },
                        { label: "Ch. From", align: "right" },
                        { label: "Ch. To", align: "right" },
                        { label: "Length (m)", align: "right" },
                        { label: "Balance (m)", align: "right" },
                        { label: "Amount", align: "right" },
                        { label: "Farmer Name", align: "left" },
                        { label: "Top Sheet No", align: "left" },
                        { label: "Actions", align: "left" },
                        { label: "Remarks", align: "left" },
                        { label: "", align: "left" },
                      ].map((h, i) => (
                        <th key={i} style={{ background: colors.formBg, color: "#6b7490", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, padding: "10px 12px", textAlign: h.align, borderBottom: `1px solid ${colors.border}`, whiteSpace: "nowrap" }}>{h.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {junctionData.flatMap((j, idx) => {
                      const jEntries = ledger
                        .filter(e => e.cluster === selectedJunctionCluster && e.junctionFrom === j.from && e.junctionTo === j.to)
                        .sort((a, b) => parseChainageVal(a.chainageFrom) - parseChainageVal(b.chainageFrom));
                      const completedLength = jEntries.reduce((s, e) => s + (parseFloat(e.length) || 0), 0);
                      const balanceLength = (parseFloat(j.length) || 0) - completedLength;

                      const isCollapsed = !expandedJunctions.has(idx);
                      const toggleCollapse = () => setExpandedJunctions(prev => {
                        const next = new Set(prev);
                        if (next.has(idx)) next.delete(idx); else next.add(idx);
                        return next;
                      });

                      const junctionRow = (
                        <tr key={`j-${idx}`} onClick={jEntries.length > 0 ? toggleCollapse : undefined} style={{ background: "#eef2fb", borderBottom: `2px solid ${colors.border}`, cursor: jEntries.length > 0 ? "pointer" : "default" }}>
                          <td style={{ padding: "10px 12px", color: colors.textLight, fontWeight: 700, fontSize: 12, textAlign: "right" }}>
                            {jEntries.length > 0 && <span style={{ marginRight: 4, fontSize: 10, color: colors.textLight }}>{isCollapsed ? "▶" : "▼"}</span>}
                            {idx + 1}
                          </td>
                          {junctionEdit === idx ? (
                            <>
                              <td style={{ padding: "6px 12px" }}>
                                <input value={junctionEditForm.from} onChange={e => setJunctionEditForm(f => ({ ...f, from: e.target.value }))}
                                  style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "5px 8px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, width: "100%" }} />
                              </td>
                              <td style={{ padding: "6px 12px" }}>
                                <input value={junctionEditForm.to} onChange={e => setJunctionEditForm(f => ({ ...f, to: e.target.value }))}
                                  style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "5px 8px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, width: "100%" }} />
                              </td>
                              <td style={{ padding: "6px 12px" }}>
                                <input type="number" value={junctionEditForm.dia} onChange={e => setJunctionEditForm(f => ({ ...f, dia: e.target.value }))}
                                  style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "5px 8px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, width: "100%", textAlign: "right" }} />
                              </td>
                              <td style={{ padding: "6px 12px" }}>
                                <input type="number" value={junctionEditForm.length} onChange={e => setJunctionEditForm(f => ({ ...f, length: e.target.value }))}
                                  style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "5px 8px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, width: "100%", textAlign: "right" }} />
                              </td>
                              <td colSpan={8} />
                              <td style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
                                <button onClick={saveJunctionEdit} style={{ background: colors.navy, color: "white", border: "none", borderRadius: 4, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 6, fontFamily: "'Source Sans 3', sans-serif" }}>Save</button>
                                <button onClick={() => setJunctionEdit(null)} style={{ background: "none", color: colors.textMid, border: `1px solid ${colors.border}`, borderRadius: 4, padding: "5px 10px", fontSize: 12, cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>Cancel</button>
                              </td>
                              <td colSpan={2} />
                            </>
                          ) : (
                            <>
                              <td style={{ padding: "10px 12px", color: colors.text, fontWeight: 700 }}>{j.from}</td>
                              <td style={{ padding: "10px 12px", color: colors.text, fontWeight: 700 }}>{j.to}</td>
                              <td style={{ padding: "10px 12px", color: colors.navy, fontWeight: 600, textAlign: "right" }}>{j.dia ? parseFloat(j.dia).toLocaleString("en-IN") : "—"}</td>
                              <td style={{ padding: "10px 12px", color: colors.navy, fontWeight: 600, textAlign: "right" }}>{parseFloat(j.length).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                              <td style={{ padding: "10px 12px", color: completedLength > 0 ? colors.green : colors.textLight, fontWeight: 600, textAlign: "right" }}>{completedLength > 0 ? completedLength.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : "—"}</td>
                              <td colSpan={3} />
                              <td style={{ padding: "10px 12px", color: balanceLength < 0 ? "#dc2626" : balanceLength === 0 ? colors.textLight : colors.gold, fontWeight: 700, textAlign: "right" }}>
                                {balanceLength.toLocaleString("en-IN", { maximumFractionDigits: 3 })}
                              </td>
                              <td colSpan={3} />
                              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                <button onClick={(e) => { e.stopPropagation(); setJunctionEdit(idx); setJunctionEditForm({ from: j.from, to: j.to, length: String(j.length), dia: String(j.dia ?? "") }); }}
                                  style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.navy, fontSize: 11, fontWeight: 600, padding: "3px 10px", cursor: "pointer", marginRight: 4, fontFamily: "'Source Sans 3', sans-serif" }}>Edit</button>
                                {junctionDeleteConfirm === idx ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 600 }}>Confirm?</span>
                                    <button onClick={(e) => { e.stopPropagation(); deleteJunction(idx); setJunctionDeleteConfirm(null); }}
                                      style={{ background: "#dc2626", border: "none", borderRadius: 4, color: "#fff", fontSize: 11, fontWeight: 600, padding: "3px 8px", cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>Yes</button>
                                    <button onClick={(e) => { e.stopPropagation(); setJunctionDeleteConfirm(null); }}
                                      style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.text, fontSize: 11, fontWeight: 600, padding: "3px 8px", cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>No</button>
                                  </span>
                                ) : (
                                  <button onClick={(e) => { e.stopPropagation(); setJunctionDeleteConfirm(idx); }}
                                    style={{ background: "none", border: "1px solid #fca5a5", borderRadius: 4, color: "#dc2626", fontSize: 11, fontWeight: 600, padding: "3px 10px", cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>Delete</button>
                                )}
                              </td>
                              <td />
                              <td style={{ padding: "10px 12px" }}>
                                {jEntries.length > 0 && (
                                  <button onClick={(e) => { e.stopPropagation(); downloadJunctionExcel(j.from, j.to, jEntries); }}
                                    style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.navy, fontSize: 11, fontWeight: 600, padding: "3px 10px", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "'Source Sans 3', sans-serif" }}>↓ Excel</button>
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      );

                      const entryRows = jEntries.map((e, ei) => (
                        <tr key={`e-${idx}-${ei}`} className="trow" style={{ background: e.approvalId ? "#fafbff" : "#fef2f2", borderBottom: `1px solid ${e.approvalId ? "#f0f2f8" : "#fecaca"}` }}>
                          <td colSpan={6} />
                          <td style={{ padding: "9px 12px", color: colors.textMid, fontSize: 12, textAlign: "right" }}>{e.chainageFrom}</td>
                          <td style={{ padding: "9px 12px", color: colors.textMid, fontSize: 12, textAlign: "right" }}>{e.chainageTo}</td>
                          <td style={{ padding: "9px 12px", color: colors.text, fontWeight: 500, fontSize: 12, textAlign: "right" }}>{e.length}m</td>
                          <td />
                          <td style={{ padding: "9px 12px", color: colors.green, fontWeight: 600, fontSize: 12, textAlign: "right" }}>
                            {e.compensationAmount ? `Rs.${parseFloat(e.compensationAmount).toLocaleString("en-IN")}` : "—"}
                          </td>
                          <td style={{ padding: "9px 12px", fontSize: 12, color: e.approvalId ? colors.text : "#dc2626", fontWeight: e.approvalId ? 400 : 600 }}>{e.farmerName}</td>
                          <td style={{ padding: "9px 12px", fontSize: 12 }}>
                            {e.approvalId
                              ? <span style={{ background: "#dcfce7", color: "#166534", fontWeight: 700, padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{e.approvalId}</span>
                              : <span style={{ background: "#fee2e2", color: "#dc2626", fontWeight: 700, padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>Pending</span>}
                          </td>
                          <td />
                          <td style={{ padding: "9px 12px", maxWidth: 150, fontSize: 12, color: e.remarks ? colors.textMid : colors.textLight, fontStyle: e.remarks ? "normal" : "italic" }} title={e.remarks || ""}>
                            {e.remarks ? (e.remarks.length > 25 ? e.remarks.slice(0, 25) + "…" : e.remarks) : "—"}
                          </td>
                          <td />
                        </tr>
                      ));

                      return [junctionRow, ...(isCollapsed ? [] : entryRows)];
                    })}
                    {/* Add new junction row */}
                    <tr style={{ borderTop: `2px solid ${colors.border}`, background: "#f9fafb" }}>
                      <td style={{ padding: "10px 12px", color: colors.textLight, fontWeight: 600, fontSize: 12, textAlign: "right" }}>+</td>
                      <td style={{ padding: "8px 12px" }}>
                        <input value={newJunction.from} onChange={e => setNewJunction(f => ({ ...f, from: e.target.value }))}
                          placeholder="From (e.g. J-96)"
                          style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%" }}
                          onKeyDown={e => e.key === "Enter" && addJunction()} />
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <input value={newJunction.to} onChange={e => setNewJunction(f => ({ ...f, to: e.target.value }))}
                          placeholder="To (e.g. PH-2)"
                          style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%" }}
                          onKeyDown={e => e.key === "Enter" && addJunction()} />
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <input type="number" value={newJunction.dia} onChange={e => setNewJunction(f => ({ ...f, dia: e.target.value }))}
                          placeholder="Dia (mm)"
                          style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%", textAlign: "right" }}
                          onKeyDown={e => e.key === "Enter" && addJunction()} />
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <input type="number" value={newJunction.length} onChange={e => setNewJunction(f => ({ ...f, length: e.target.value }))}
                          placeholder="Length in m"
                          style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "6px 9px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, width: "100%", textAlign: "right" }}
                          onKeyDown={e => e.key === "Enter" && addJunction()} />
                      </td>
                      <td colSpan={10} />
                      <td style={{ padding: "8px 12px" }}>
                        <button onClick={addJunction} disabled={!newJunction.from.trim() || !newJunction.to.trim()}
                          style={{ background: (newJunction.from.trim() && newJunction.to.trim()) ? colors.gold : "#e8ecf6", color: (newJunction.from.trim() && newJunction.to.trim()) ? "white" : colors.textLight, border: "none", borderRadius: 4, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: (newJunction.from.trim() && newJunction.to.trim()) ? "pointer" : "not-allowed", fontFamily: "'Source Sans 3', sans-serif" }}>
                          Add Junction
                        </button>
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr style={{ background: colors.formBg, borderTop: `1px solid ${colors.border}` }}>
                      <td colSpan={4} style={{ padding: "10px 12px", fontSize: 12, fontWeight: 700, color: colors.textMid, textTransform: "uppercase", letterSpacing: 0.6 }}>Totals</td>
                      <td style={{ padding: "10px 12px", fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: colors.gold, textAlign: "right" }}>
                        {totalJunctionLength.toLocaleString("en-IN", { maximumFractionDigits: 3 })} m
                      </td>
                      <td style={{ padding: "10px 12px", fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: colors.green, textAlign: "right" }}>
                        {junctionData.reduce((s, j) => s + ledger.filter(e => e.cluster === selectedJunctionCluster && e.junctionFrom === j.from && e.junctionTo === j.to).reduce((a, e) => a + (parseFloat(e.length) || 0), 0), 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} m
                      </td>
                      <td colSpan={3} />
                      <td style={{ padding: "10px 12px", fontFamily: "'Lora', Georgia, serif", fontSize: 14, fontWeight: 600, color: colors.navy, textAlign: "right" }}>
                        {(totalJunctionLength - junctionData.reduce((s, j) => s + ledger.filter(e => e.cluster === selectedJunctionCluster && e.junctionFrom === j.from && e.junctionTo === j.to).reduce((a, e) => a + (parseFloat(e.length) || 0), 0), 0)).toLocaleString("en-IN", { maximumFractionDigits: 3 })} m
                      </td>
                      <td colSpan={6} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ---- TOP SHEETS TAB ---- */}
        {activeTab === "topsheets" && (() => {
          const allApproved = ledger.filter(e => e.approvalId);
          const grouped = allApproved.reduce((acc, e) => {
            (acc[e.approvalId] = acc[e.approvalId] || []).push(e);
            return acc;
          }, {});
          const allIds = Object.keys(grouped).sort();
          const filtered = topsheetSearch.trim()
            ? allIds.filter(id => id.toLowerCase().includes(topsheetSearch.trim().toLowerCase()))
            : allIds;
          const selectedEntries = topsheetSelected && grouped[topsheetSelected]
            ? grouped[topsheetSelected].sort((a, b) => parseChainageVal(a.chainageFrom) - parseChainageVal(b.chainageFrom))
            : null;
          const thStyle = { background: "#f0f4ff", color: "#3a4566", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, padding: "7px 8px", border: `1px solid ${colors.border}`, textAlign: "center", whiteSpace: "nowrap" };
          const tdStyle = { padding: "7px 8px", border: `1px solid ${colors.border}`, fontSize: 12, textAlign: "center", verticalAlign: "middle" };
          return (
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              {/* Left panel — search + list */}
              <div style={{ width: 260, flexShrink: 0 }}>
                <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ background: colors.formBg, borderBottom: `1px solid ${colors.border}`, padding: "12px 16px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: colors.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Top Sheet ID</div>
                    <input
                      type="text"
                      value={topsheetSearch}
                      onChange={e => setTopsheetSearch(e.target.value)}
                      placeholder="Search ID…"
                      style={{ width: "100%", border: `1px solid ${colors.border}`, borderRadius: 5, padding: "7px 10px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.text, background: colors.white, outline: "none" }}
                    />
                  </div>
                  <div style={{ maxHeight: 500, overflowY: "auto" }}>
                    {allIds.length === 0 ? (
                      <div style={{ padding: "24px 16px", color: colors.textLight, fontSize: 13, textAlign: "center" }}>No approved records yet.</div>
                    ) : filtered.length === 0 ? (
                      <div style={{ padding: "24px 16px", color: colors.textLight, fontSize: 13, textAlign: "center" }}>No match found.</div>
                    ) : (
                      filtered.map(id => (
                        <button key={id} onClick={() => setTopsheetSelected(id)}
                          style={{ display: "block", width: "100%", textAlign: "left", background: topsheetSelected === id ? "#eef2fb" : "none", border: "none", borderBottom: `1px solid ${colors.border}`, padding: "10px 16px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: topsheetSelected === id ? 700 : 500, color: topsheetSelected === id ? colors.navy : colors.textMid, cursor: "pointer" }}>
                          {id}
                          <span style={{ float: "right", fontSize: 11, color: colors.textLight }}>{grouped[id].length} entr{grouped[id].length === 1 ? "y" : "ies"}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Right panel — top sheet detail */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {!topsheetSelected ? (
                  <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, padding: "60px 24px", textAlign: "center", color: colors.textLight }}>
                    Select a Top Sheet ID from the list to view and download.
                  </div>
                ) : (() => {
                  const entries = selectedEntries;
                  const cluster = entries[0]?.cluster || "";
                  const rowWidth = entries[0]?.row || "—";
                  const date = new Date().toLocaleDateString("en-IN");
                  const totalLength = entries.reduce((s, e) => s + (parseFloat(e.length) || 0), 0);
                  const totalArea = entries.reduce((s, e) => s + (parseFloat(e.affectedArea) || 0), 0);
                  const totalAmount = entries.reduce((s, e) => s + (parseFloat(e.compensationAmount) || 0), 0);
                  return (
                    <div style={{ background: colors.white, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
                      {/* Sheet header */}
                      <div style={{ background: "#f0f4ff", borderBottom: `1px solid ${colors.border}`, padding: "14px 20px" }}>
                        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 15, fontWeight: 700, color: colors.navy, textAlign: "center", marginBottom: 8 }}>{PROJECT_NAME}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: colors.textMid, fontWeight: 600 }}>CLUSTER {cluster}</span>
                          <span style={{ fontSize: 12, color: colors.textMid, fontWeight: 600 }}>CROP COMPENSATION ABSTRACT</span>
                          <span style={{ fontSize: 12, color: colors.textMid }}>S.No: <strong>{topsheetSelected}</strong> &nbsp;&nbsp; Date: {date}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                          <button onClick={() => downloadTopSheetExcel(entries, topsheetSelected, cluster)}
                            style={{ background: colors.navy, color: "white", border: "none", borderRadius: 5, padding: "7px 20px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            ↓ Download Excel
                          </button>
                        </div>
                      </div>
                      {/* Table */}
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr>
                              {["S.NO", "PIPE DIA (MM)", "VILLAGE NAME", "JUNCTION", "CHAINAGE FROM", "CHAINAGE TO", "LENGTH (RMT)", "ROW (M)", "LAND AREA (M2)", "REQUIRED AREA (HA)", "KHASRA NO.", "CROP / PLANT", "PRODUCTIVITY/HA (QUINTAL) (B)", "PROD. IN REQ. AREA (C=AxB)", "RATE/QUINTAL (₹) (D)", "AMOUNT (E=CxD)", "FARMER / LESSEE NAME", "PAYMENT MODE", "REMARKS"]
                                .map(h => <th key={h} style={thStyle}>{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((e, i) => {
                              const area = parseFloat(e.affectedArea) || 0;
                              const yld = parseFloat(e.yield) || 0;
                              const prodInArea = area && yld ? parseFloat((area * yld).toFixed(3)) : "—";
                              const landArea = area ? Math.round(area * 10000).toLocaleString("en-IN") : "—";
                              return (
                                <tr key={i} style={{ background: i % 2 === 0 ? "#fafbff" : colors.white }}>
                                  <td style={tdStyle}>{i + 1}</td>
                                  <td style={tdStyle}>{e.dia || "—"}</td>
                                  <td style={{ ...tdStyle, textAlign: "left" }}>{e.village || "—"}</td>
                                  <td style={tdStyle}>{e.junctionFrom}{e.junctionTo ? "-" + e.junctionTo : ""}</td>
                                  <td style={tdStyle}>{e.chainageFrom || "—"}</td>
                                  <td style={tdStyle}>{e.chainageTo || "—"}</td>
                                  <td style={tdStyle}>{e.length || "—"}</td>
                                  <td style={tdStyle}>{e.row || "—"}</td>
                                  <td style={tdStyle}>{landArea}</td>
                                  <td style={tdStyle}>{area || "—"}</td>
                                  <td style={tdStyle}>{e.khasraNo || "—"}</td>
                                  <td style={tdStyle}>{e.crop || "—"}</td>
                                  <td style={tdStyle}>{yld || "—"}</td>
                                  <td style={tdStyle}>{prodInArea}</td>
                                  <td style={tdStyle}>{e.mandiRate ? parseFloat(e.mandiRate).toLocaleString("en-IN") : "—"}</td>
                                  <td style={{ ...tdStyle, fontWeight: 600, color: colors.green }}>{e.compensationAmount ? parseFloat(e.compensationAmount).toLocaleString("en-IN") : "—"}</td>
                                  <td style={{ ...tdStyle, textAlign: "left" }}>{e.farmerName || "—"}</td>
                                  <td style={tdStyle}>{e.paymentMode || "—"}</td>
                                  <td style={{ ...tdStyle, textAlign: "left", maxWidth: 180 }}>{e.remarks || "—"}</td>
                                </tr>
                              );
                            })}
                            <tr style={{ background: "#f0f4ff", fontWeight: 700 }}>
                              <td colSpan={6} style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>TOTAL</td>
                              <td style={tdStyle}>{totalLength.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                              <td style={tdStyle} />
                              <td style={tdStyle}>{totalArea.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                              <td colSpan={5} style={tdStyle} />
                              <td style={{ ...tdStyle, color: colors.green }}>{totalAmount.toLocaleString("en-IN")}</td>
                              <td colSpan={3} style={tdStyle} />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {/* RTGS Bank Details Section */}
                      {(() => {
                        const rtgsEntries = entries.filter(e => e.paymentMode === "RTGS");
                        if (rtgsEntries.length === 0) return null;
                        return (
                          <div style={{ padding: "20px 24px", borderTop: `2px solid ${colors.border}` }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
                              {rtgsEntries.map((e, i) => (
                                <div key={i} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: "14px 18px", background: "#fafbff" }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: colors.textMid, marginBottom: 10 }}>Bank details for RTGS :</div>
                                  <div style={{ fontSize: 13, marginBottom: 6 }}><strong>{i + 1})</strong></div>
                                  <div style={{ fontSize: 13, marginBottom: 4 }}>Account Name - <strong>{e.landOwnerName || e.farmerName || "—"}</strong></div>
                                  <div style={{ fontSize: 13, marginBottom: 4 }}>Bank Name - <strong>{e.bankName || "—"}</strong></div>
                                  <div style={{ fontSize: 13, marginBottom: 4 }}>A/c No. - <strong>{e.accountNo || "—"}</strong></div>
                                  <div style={{ fontSize: 13 }}>IFSC No. - <strong>{e.ifscCode || "—"}</strong></div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}

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
                            {["#", "Date", "Approval ID", "Cluster", "Village", "Khasra No.", "Jn. From", "Jn. To", "Chainage", "Length", "ROW", "Land Owner", "Farmer / Lessee", "Compensation", "Crop", "Area (Ha)", "Mandi Rate", "Yield", "Payment Mode", "Bank", "Account No.", "IFSC", "Cheque/RTGS Details", "Document", "Remarks", ""].map(h => (
                              <th key={h} style={{ background: colors.formBg, color: "#6b7490", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, padding: "10px 14px", textAlign: "left", borderBottom: `1px solid ${colors.border}`, whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {clusterLedger.filter(e => e.approvalId).map((e, i) => (
                            <tr key={i} className="trow" style={{ borderBottom: `1px solid #f0f2f8` }}>
                              <td style={{ padding: "11px 14px", color: colors.textLight, fontWeight: 600, fontSize: 12 }}>{i + 1}</td>
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
                              <td style={{ padding: "11px 14px", color: colors.green, fontWeight: 600 }}>{e.compensationAmount ? `Rs. ${parseFloat(e.compensationAmount).toLocaleString("en-IN")}` : "—"}</td>
                              <td style={{ padding: "11px 14px" }}>{e.crop}</td>
                              <td style={{ padding: "11px 14px" }}>{e.affectedArea}</td>
                              <td style={{ padding: "11px 14px" }}>Rs.{e.mandiRate}</td>
                              <td style={{ padding: "11px 14px" }}>{e.yield}</td>
                              <td style={{ padding: "11px 14px", fontWeight: e.paymentMode ? 500 : 400, color: e.paymentMode ? colors.text : colors.textLight }}>{e.paymentMode || "—"}</td>
                              <td style={{ padding: "11px 14px" }}>{e.bankName}</td>
                              <td style={{ padding: "11px 14px" }}>{e.accountNo}</td>
                              <td style={{ padding: "11px 14px" }}>{e.ifscCode}</td>
                              <td style={{ padding: "11px 14px", maxWidth: 200, color: e.paymentDetails ? colors.text : colors.textLight, fontStyle: e.paymentDetails ? "normal" : "italic" }}>{e.paymentDetails || "—"}</td>
                              <td style={{ padding: "11px 14px" }}>
                                {e.documentPath
                                  ? <a href={getDocumentUrl(e.documentPath)} target="_blank" rel="noopener noreferrer" style={{ color: colors.navy, fontWeight: 600, fontSize: 12, textDecoration: "none" }}>📎 View</a>
                                  : <span style={{ color: colors.textLight, fontSize: 12 }}>—</span>}
                              </td>
                              <td style={{ padding: "11px 14px", maxWidth: 160, color: e.remarks ? colors.text : colors.textLight, fontStyle: e.remarks ? "normal" : "italic" }} title={e.remarks || ""}>
                                {e.remarks ? (e.remarks.length > 30 ? e.remarks.slice(0, 30) + "…" : e.remarks) : "—"}
                              </td>
                              <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                                <button onClick={() => handleEdit(e)}
                                  style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.navy, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600, padding: "4px 12px", cursor: "pointer", marginRight: 6 }}>
                                  Edit
                                </button>
                                {deleteConfirm === e._id ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>Delete?</span>
                                    <button onClick={() => handleDeleteEntry(e)} disabled={loading}
                                      style={{ background: "#dc2626", color: "white", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>Yes</button>
                                    <button onClick={() => setDeleteConfirm(null)}
                                      style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMid, padding: "4px 8px", fontSize: 12, cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>No</button>
                                  </span>
                                ) : (
                                  <button onClick={() => setDeleteConfirm(e._id)}
                                    style={{ background: "none", border: `1px solid #fca5a5`, borderRadius: 4, color: "#dc2626", fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600, padding: "4px 12px", cursor: "pointer", marginRight: 6 }}>
                                    Delete
                                  </button>
                                )}
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
                            </div>
                            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                              <input
                                type="text"
                                value={generatedApprovalId || ""}
                                onChange={e => setGeneratedApprovalId(e.target.value || null)}
                                placeholder="Enter Approval ID"
                                disabled={selectedPending.size === 0}
                                style={{ border: `1px solid ${colors.border}`, borderRadius: 5, padding: "8px 12px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, color: colors.navy, background: selectedPending.size > 0 ? colors.white : "#f3f4f6", outline: "none", width: 180 }}
                              />
                              <button onClick={handleAcceptPending} disabled={loading || !generatedApprovalId || selectedPending.size === 0}
                                style={{ background: generatedApprovalId && selectedPending.size > 0 ? colors.green : "#e8ecf6", color: generatedApprovalId && selectedPending.size > 0 ? "white" : colors.textLight, border: "none", borderRadius: 5, padding: "8px 20px", fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 600, cursor: generatedApprovalId && selectedPending.size > 0 && !loading ? "pointer" : "not-allowed", opacity: loading ? 0.7 : 1 }}>
                                {loading ? "Processing…" : "Accept"}
                              </button>
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
                                  {["#", "Date", "Cluster", "Village", "Khasra No.", "Jn. From", "Jn. To", "Chainage", "Length", "ROW", "Land Owner", "Farmer / Lessee", "Compensation", "Crop", "Area (Ha)", "Mandi Rate", "Yield", "Payment Mode", "Bank", "Account No.", "IFSC", "Document", "Remarks", ""].map(h => (
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
                                    <td style={{ padding: "11px 14px", color: colors.textLight, fontWeight: 600, fontSize: 12 }}>{clusterLedger.findIndex(ce => ce._id === e._id) + 1}</td>
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
                                    <td style={{ padding: "11px 14px", color: colors.green, fontWeight: 600 }}>{e.compensationAmount ? `Rs. ${parseFloat(e.compensationAmount).toLocaleString("en-IN")}` : "—"}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.crop}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.affectedArea}</td>
                                    <td style={{ padding: "11px 14px" }}>Rs.{e.mandiRate}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.yield}</td>
                                    <td style={{ padding: "11px 14px", fontWeight: e.paymentMode ? 500 : 400, color: e.paymentMode ? colors.text : colors.textLight }}>{e.paymentMode || "—"}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.bankName}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.accountNo}</td>
                                    <td style={{ padding: "11px 14px" }}>{e.ifscCode}</td>
                                    <td style={{ padding: "11px 14px" }}>
                                      {e.documentPath
                                        ? <a href={getDocumentUrl(e.documentPath)} target="_blank" rel="noopener noreferrer" style={{ color: colors.navy, fontWeight: 600, fontSize: 12, textDecoration: "none" }}>📎 View</a>
                                        : <span style={{ color: colors.textLight, fontSize: 12 }}>—</span>}
                                    </td>
                                    <td style={{ padding: "11px 14px", maxWidth: 160, color: e.remarks ? colors.text : colors.textLight, fontStyle: e.remarks ? "normal" : "italic" }} title={e.remarks || ""}>
                                      {e.remarks ? (e.remarks.length > 30 ? e.remarks.slice(0, 30) + "…" : e.remarks) : "—"}
                                    </td>
                                    <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                                      <button onClick={() => handleEdit(e)}
                                        style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.navy, fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600, padding: "4px 12px", cursor: "pointer", marginRight: 6 }}>
                                        Edit
                                      </button>
                                      {deleteConfirm === e._id ? (
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                          <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>Delete?</span>
                                          <button onClick={() => handleDeleteEntry(e)} disabled={loading}
                                            style={{ background: "#dc2626", color: "white", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>Yes</button>
                                          <button onClick={() => setDeleteConfirm(null)}
                                            style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMid, padding: "4px 8px", fontSize: 12, cursor: "pointer", fontFamily: "'Source Sans 3', sans-serif" }}>No</button>
                                        </span>
                                      ) : (
                                        <button onClick={() => setDeleteConfirm(e._id)}
                                          style={{ background: "none", border: `1px solid #fca5a5`, borderRadius: 4, color: "#dc2626", fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600, padding: "4px 12px", cursor: "pointer" }}>
                                          Delete
                                        </button>
                                      )}
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
