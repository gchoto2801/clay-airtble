"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { CleanedRecord } from "@/lib/cleaning";

type PipelinePhase = "upload" | "clay-processing" | "results" | "done";

interface Stats {
  total: number;
  dedupedTotal: number;
  duplicatesRemoved: number;
  foundCount: number;
  reiskipCount: number;
  phoneCoverage: number;
  emailCoverage: number;
  byState: Record<string, number>;
}

interface PipelineState {
  phase: PipelinePhase;
  csvRows: Record<string, string>[];
  csvRawText: string;
  csvFileName: string;
  entityCount: number;
  personCount: number;
  expectedCount: number;
  airtableCount: number;
  found: CleanedRecord[];
  reiskip: CleanedRecord[];
  stats: Stats | null;
  reiskipReturns: Record<string, string>[];
  loading: boolean;
  error: string;
}

const INITIAL: PipelineState = {
  phase: "upload",
  csvRows: [], csvRawText: "", csvFileName: "",
  entityCount: 0, personCount: 0,
  expectedCount: 0, airtableCount: 0,
  found: [], reiskip: [], stats: null,
  reiskipReturns: [],
  loading: false, error: "",
};

// ── CSV helpers ──────────────────────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"') { if (line[i+1]==='"') { cur+='"'; i++; } else inQ=false; } else cur+=c; }
    else { if (c==='"') inQ=true; else if (c===',') { result.push(cur); cur=""; } else cur+=c; }
  }
  result.push(cur); return result;
}
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h.trim()] = (vals[i] || "").trim(); });
    return rec;
  });
}
function toCSV(records: Record<string, string>[], cols: string[]): string {
  const hdr = cols.map(c => `"${c.replace(/"/g,'""')}"`).join(",");
  const rows = records.map(r => cols.map(c => `"${(r[c]||"").replace(/"/g,'""')}"`).join(","));
  return [hdr, ...rows].join("\n");
}
function download(csv: string, name: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=name; a.click();
  URL.revokeObjectURL(url);
}

// ── Classification ───────────────────────────────────────────────────────────
function isEntity(name: string): boolean {
  const u = name.toUpperCase();
  return [/\bLLC\b/,/\bINC\b/,/\bCORP\b/,/\bLTD\b/,/\bLP\b/,/\bLLP\b/,/\bLLLP\b/,
    /\bTRUST\b/,/\bESTATE\b/,/\bFOUNDATION\b/,/\bPARTNERS\b/,/\bPARTNERSHIP\b/,
    /\bHOLDINGS\b/,/\bPROPERTIES\b/,/\bBUILDERS\b/,/\bGROUP\b/,/\bVENTURE\b/,
    /\bENTERPRISES?\b/,/\bP\/S\b/,
  ].some(p => p.test(u));
}
function mapToClayFormat(r: Record<string, string>): Record<string, string> {
  return {
    "Owner Name":      r["OWNER_NAME_1"]||r["Owner Name"]||"",
    "Property Address":r["PROP_ADDRESS"]||r["SITE_ADDR"]||r["Property Address"]||"",
    "Property City":   r["PROP_CITY"]||r["SITE_CITY"]||r["Property City"]||"",
    "Property State":  r["PROP_STATE"]||r["SITE_STATE"]||r["Property State"]||"",
    "Property Zip":    r["PROP_ZIP"]||r["SITE_ZIP"]||r["Property Zip"]||"",
    "Mailing Address": r["MAIL_ADDR"]||r["Mailing Address"]||"",
    "Mailing City":    r["MAIL_CITY"]||r["Mailing City"]||"",
    "Mailing State":   r["MAIL_STATE"]||r["Mailing State"]||"",
    "Mailing Zip":     r["MAIL_ZIP"]||r["Mailing Zip"]||"",
    "County":          r["COUNTY"]||r["County"]||"",
    "Apn":             r["APN"]||r["Apn"]||"",
  };
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Home() {
  const [s, setS] = useState<PipelineState>(INITIAL);
  const [log, setLog] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const reiskipRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);
  const setError = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    setS(prev => ({ ...prev, error: msg, loading: false }));
    addLog(`❌ ${msg}`);
  }, [addLog]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── STEP 1: Parse CSV ────────────────────────────────────────────────────
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      const entities = rows.filter(r => isEntity(r["OWNER_NAME_1"]||r["Owner Name"]||""));
      setS(prev => ({ ...prev, csvRows: rows, csvRawText: text, csvFileName: file.name,
        entityCount: entities.length, personCount: rows.length - entities.length, error: "" }));
      addLog(`CSV loaded: ${rows.length} rows → ${entities.length} entities, ${rows.length-entities.length} persons`);
    };
    reader.readAsText(file);
  }, [addLog]);

  // ── STEP 2: Upload to Drive → n8n → Clay ────────────────────────────────
  const startPipeline = useCallback(async () => {
    if (!s.csvRawText) return;
    setS(prev => ({ ...prev, loading: true, error: "" }));

    try {
      // Count entities for expectedCount
      const entities = s.csvRows.filter(r => isEntity(r["OWNER_NAME_1"]||r["Owner Name"]||""));
      const expectedCount = entities.length;

      // Clear old Airtable records first
      addLog("🗑️ Clearing old records from Airtable...");
      const clearRes = await fetch("/api/airtable/clear", { method: "DELETE" });
      const clearData = await clearRes.json();
      if (clearRes.ok) {
        addLog(`✅ Cleared ${clearData.deleted} old records from Airtable`);
      } else {
        addLog(`⚠️ Could not clear Airtable: ${clearData.error} — continuing anyway`);
      }

      addLog(`Uploading CSV to Google Drive (${s.csvRows.length} rows)...`);
      const driveRes = await fetch("/api/upload-to-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: s.csvRawText, filename: s.csvFileName }),
      });
      const driveData = await driveRes.json();
      if (!driveRes.ok) throw new Error(driveData.error || "Drive upload failed");
      addLog(`✅ Uploaded: ${driveData.fileName} → n8n will classify & send ${expectedCount} entities to Clay`);

      // Store expected count in Airtable Batch Config
      try {
        const batchId = `batch_${new Date().toISOString().slice(0,16).replace(/[:-]/g,"")}`;
        await fetch("/api/batch-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedCount, batchId, status: "processing" }),
        });
        addLog(`📋 Batch config saved: expecting ${expectedCount} records`);
      } catch { addLog("⚠️ Could not save batch config (Batch Config table may not exist yet)"); }

      setS(prev => ({ ...prev, expectedCount, phase: "clay-processing", loading: false }));
      startPolling(expectedCount);
    } catch (err) { setError(err); }
  }, [s.csvRawText, s.csvFileName, s.csvRows, addLog, setError]);

  // ── STEP 3: Poll Airtable ────────────────────────────────────────────────
  const fetchAirtableCount = useCallback(async () => {
    try {
      const res = await fetch("/api/airtable/records");
      const data = await res.json();
      return data.count || 0;
    } catch { return 0; }
  }, []);

  const startPolling = useCallback((expected: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      const count = await fetchAirtableCount();
      setS(prev => ({ ...prev, airtableCount: count }));
      if (count > 0) addLog(`📡 Airtable: ${count}/${expected} records received`);
      if (count >= expected && expected > 0) {
        clearInterval(pollRef.current!); pollRef.current = null;
        addLog("✅ All records received from Clay! Ready to process.");
      }
    };
    tick();
    pollRef.current = setInterval(tick, 30000);
  }, [fetchAirtableCount, addLog]);

  const manualRefresh = useCallback(async () => {
    const count = await fetchAirtableCount();
    setS(prev => ({ ...prev, airtableCount: count }));
    addLog(`📡 Airtable: ${count}/${s.expectedCount} records`);
  }, [fetchAirtableCount, s.expectedCount, addLog]);

  // ── STEP 4: Process & Classify ───────────────────────────────────────────
  const processResults = useCallback(async () => {
    setS(prev => ({ ...prev, loading: true, error: "" }));
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    addLog("📊 Fetching all records from Airtable...");

    try {
      const atRes = await fetch("/api/airtable/records");
      const atData = await atRes.json();
      addLog(`Got ${atData.count} raw records. Running dedup + classify...`);

      const procRes = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: atData.records }),
      });
      const procData = await procRes.json();
      const st: Stats = procData.stats;

      setS(prev => ({ ...prev, found: procData.found, reiskip: procData.reiskip,
        stats: st, phase: "results", loading: false }));

      addLog(`✅ Dedup: ${st.total} raw → ${st.dedupedTotal} unique (${st.duplicatesRemoved} dupes removed)`);
      addLog(`   🟢 Found: ${st.foundCount}  🟡 Not Found: ${st.reiskipCount}`);
      addLog(`   📞 Phone: ${st.phoneCoverage}%  📧 Email: ${st.emailCoverage}%`);
    } catch (err) { setError(err); }
  }, [addLog, setError]);

  // ── STEP 5: Downloads ────────────────────────────────────────────────────
  const downloadFound = useCallback(() => {
    const cols = ["Owner Name","Property Address","Property City","Property State","Property Zip",
      "Mailing Address","Mailing City","Mailing State","Mailing Zip","County","APN",
      "Primary Contact","Contact Name 2","Contact Name 3","Agent Name",
      "Phone 1","Phone 2","Phone 3","Email 1","Email 2","Email 3",
      "Entity Status","Filing Number","Formation Date","All Names"];
    const rows = s.found.map(r => ({
      "Owner Name":r.ownerName,"Property Address":r.propertyAddress,"Property City":r.propertyCity,
      "Property State":r.propertyState,"Property Zip":r.propertyZip,"Mailing Address":r.mailingAddress,
      "Mailing City":r.mailingCity,"Mailing State":r.mailingState,"Mailing Zip":r.mailingZip,
      "County":r.county,"APN":r.apn,"Primary Contact":r.primaryContact,
      "Contact Name 2":r.contactName2,"Contact Name 3":r.contactName3,"Agent Name":r.agentName,
      "Phone 1":r.phone1,"Phone 2":r.phone2,"Phone 3":r.phone3,
      "Email 1":r.email1,"Email 2":r.email2,"Email 3":r.email3,
      "Entity Status":r.entityStatus,"Filing Number":r.filingNumber,
      "Formation Date":r.formationDate,"All Names":r.allNames,
    }));
    download(toCSV(rows, cols), `found_contacts_${today()}.csv`);
    addLog(`⬇️ Found CSV downloaded: ${rows.length} rows`);
  }, [s.found, addLog]);

  const downloadNotFound = useCallback(() => {
    const cols = ["Owner Name","Property Address","Property City","Property State","Property Zip",
      "Mailing Address","Mailing City","Mailing State","Mailing Zip","County","APN"];
    const rows = s.reiskip.map(r => ({
      "Owner Name":r.ownerName,"Property Address":r.propertyAddress,"Property City":r.propertyCity,
      "Property State":r.propertyState,"Property Zip":r.propertyZip,"Mailing Address":r.mailingAddress,
      "Mailing City":r.mailingCity,"Mailing State":r.mailingState,"Mailing Zip":r.mailingZip,
      "County":r.county,"APN":r.apn,
    }));
    download(toCSV(rows, cols), `not_found_reiskip_${today()}.csv`);
    addLog(`⬇️ Not Found CSV downloaded: ${rows.length} rows → run through REISkip`);
  }, [s.reiskip, addLog]);

  // ── STEP 6: Upload REISkip returns ───────────────────────────────────────
  const handleReiskipFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target?.result as string);
      setS(prev => ({ ...prev, reiskipReturns: rows }));
      addLog(`📥 REISkip returns loaded: ${rows.length} rows`);
    };
    reader.readAsText(file);
  }, [addLog]);

  // ── STEP 7: Consolidated Report ──────────────────────────────────────────
  const generateReport = useCallback(async () => {
    setS(prev => ({ ...prev, loading: true }));
    addLog("🔗 Generating consolidated report...");

    try {
      const reiskipFound = s.reiskipReturns.filter(r =>
        r["Phone 1"]||r["phone1"]||r["Phone"]||r["Email 1"]||r["email1"]||r["Email"]
      );

      const cols = ["Owner Name","Property Address","Property City","Property State","Property Zip",
        "Mailing Address","Mailing City","Mailing State","Mailing Zip","County","APN",
        "Primary Contact","Contact Name 2","Contact Name 3","Agent Name",
        "Phone 1","Phone 2","Phone 3","Email 1","Email 2","Email 3",
        "Entity Status","Filing Number","Formation Date","All Names","Source"];

      const rows: Record<string, string>[] = [
        ...s.found.map(r => ({
          "Owner Name":r.ownerName,"Property Address":r.propertyAddress,"Property City":r.propertyCity,
          "Property State":r.propertyState,"Property Zip":r.propertyZip,"Mailing Address":r.mailingAddress,
          "Mailing City":r.mailingCity,"Mailing State":r.mailingState,"Mailing Zip":r.mailingZip,
          "County":r.county,"APN":r.apn,"Primary Contact":r.primaryContact,
          "Contact Name 2":r.contactName2,"Contact Name 3":r.contactName3,"Agent Name":r.agentName,
          "Phone 1":r.phone1,"Phone 2":r.phone2,"Phone 3":r.phone3,
          "Email 1":r.email1,"Email 2":r.email2,"Email 3":r.email3,
          "Entity Status":r.entityStatus,"Filing Number":r.filingNumber,
          "Formation Date":r.formationDate,"All Names":r.allNames,"Source":"Clay Claygent",
        })),
        ...reiskipFound.map(r => ({
          "Owner Name":r["Owner Name"]||r["OWNER_NAME_1"]||"",
          "Property Address":r["Property Address"]||r["PROP_ADDRESS"]||"",
          "Property City":r["Property City"]||r["PROP_CITY"]||"",
          "Property State":r["Property State"]||r["PROP_STATE"]||"",
          "Property Zip":r["Property Zip"]||r["PROP_ZIP"]||"",
          "Mailing Address":r["Mailing Address"]||r["MAIL_ADDR"]||"",
          "Mailing City":r["Mailing City"]||r["MAIL_CITY"]||"",
          "Mailing State":r["Mailing State"]||r["MAIL_STATE"]||"",
          "Mailing Zip":r["Mailing Zip"]||r["MAIL_ZIP"]||"",
          "County":r["County"]||"","APN":r["APN"]||r["Apn"]||"",
          "Primary Contact":r["First Name"]?`${r["First Name"]} ${r["Last Name"]||""}`.trim():"",
          "Contact Name 2":"","Contact Name 3":"","Agent Name":"",
          "Phone 1":r["Phone 1"]||r["phone1"]||r["Phone"]||"",
          "Phone 2":r["Phone 2"]||r["phone2"]||"",
          "Phone 3":r["Phone 3"]||r["phone3"]||"",
          "Email 1":r["Email 1"]||r["email1"]||r["Email"]||"",
          "Email 2":r["Email 2"]||r["email2"]||"",
          "Email 3":r["Email 3"]||r["email3"]||"",
          "Entity Status":"","Filing Number":"","Formation Date":"","All Names":"",
          "Source":"REISkip",
        })),
      ];

      const csv = toCSV(rows, cols);
      download(csv, `consolidated_${today()}.csv`);

      // Also upload to Drive
      try {
        await fetch("/api/upload-to-drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv, filename: `consolidated_${today()}.csv` }),
        });
        addLog("☁️ Consolidated report uploaded to Drive");
      } catch { addLog("⚠️ Drive upload failed, but file was downloaded locally"); }

      const total = s.stats?.dedupedTotal || 0;
      const clayCnt = s.found.length;
      const reiskipCnt = reiskipFound.length;
      const notFoundCnt = s.reiskip.length - reiskipCnt;

      addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      addLog("📊 FINAL ANALYTICS");
      addLog(`   Total unique entities: ${total}`);
      addLog(`   Found by Clay:         ${clayCnt} (${pct(clayCnt, total)}%)`);
      addLog(`   Found by REISkip:      ${reiskipCnt} (${pct(reiskipCnt, total)}%)`);
      addLog(`   Total found:           ${clayCnt+reiskipCnt} (${pct(clayCnt+reiskipCnt, total)}%)`);
      addLog(`   Still not found:       ${notFoundCnt} (${pct(notFoundCnt, total)}%)`);
      addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      setS(prev => ({ ...prev, phase: "done", loading: false }));
    } catch (err) { setError(err); }
  }, [s.found, s.reiskip, s.reiskipReturns, s.stats, addLog, setError]);

  // ── Resume interrupted session ───────────────────────────────────────────
  const resumeSession = useCallback(async () => {
    try {
      const res = await fetch("/api/batch-config");
      const data = await res.json();
      if (data.config?.expectedCount) {
        setS(prev => ({ ...prev, expectedCount: data.config.expectedCount, phase: "clay-processing" }));
        startPolling(data.config.expectedCount);
        addLog(`▶️ Resumed: expecting ${data.config.expectedCount} records`);
      } else {
        addLog("No active batch config found");
      }
    } catch (err) { addLog(`Could not resume: ${err}`); }
  }, [startPolling, addLog]);

  // ── Render ───────────────────────────────────────────────────────────────
  const phases = ["upload","clay-processing","results","done"];
  const phaseIdx = phases.indexOf(s.phase);
  const batchComplete = s.airtableCount >= s.expectedCount && s.expectedCount > 0;
  const progress = s.expectedCount > 0 ? Math.min(100, Math.round((s.airtableCount/s.expectedCount)*100)) : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/allied-icon.png" alt="Allied Development" className="h-12 w-auto" />
          <div>
            <h1 className="text-4xl text-[var(--dark)]">Entity Skip Trace Pipeline</h1>
            <p className="text-[var(--text-muted)] mt-1 font-medium" style={{ fontFamily: 'Inter, sans-serif', textTransform: 'none', letterSpacing: 'normal' }}>Upload CSV → Clay AI → Classify → REISkip → Consolidated Report</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={resumeSession}
            className="px-3 py-1.5 text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg hover:bg-[var(--border)]">
            ▶️ Resume Session
          </button>
          <button onClick={() => { setS(INITIAL); setLog([]); if(pollRef.current) clearInterval(pollRef.current); }}
            className="px-3 py-1.5 text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg hover:bg-[var(--border)]">
            🔄 Reset
          </button>
        </div>
      </div>

      {/* Phase Progress */}
      <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
        {[
          { id:"upload", label:"1. Upload" },
          { id:"clay-processing", label:"2. Clay" },
          { id:"results", label:"3. Results" },
          { id:"done", label:"4. Done" },
        ].map((p, i) => (
          <div key={p.id} className="flex items-center gap-1">
            <div className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-all ${
              i <= phaseIdx ? "bg-[var(--dark)] text-white" : "bg-[var(--card)] text-[var(--text-muted)] border border-[var(--border)]"
            }`}>{p.label}</div>
            {i < 3 && <span className={i < phaseIdx ? "text-[var(--accent)]" : "text-[var(--border)]"}>→</span>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* ── UPLOAD ── */}
          {s.phase === "upload" && (
            <Card title="📁 Step 1 — Upload CSV">
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile}
                className="block w-full text-sm text-[var(--text-muted)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[var(--accent)] file:text-[var(--text)] hover:file:bg-[var(--accent-hover)] file:cursor-pointer" />
              {s.csvRows.length > 0 && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <MiniStat label="Total Rows" value={s.csvRows.length} />
                    <MiniStat label="Entities → Clay" value={s.entityCount} color="var(--accent)" />
                    <MiniStat label="Persons (skipped)" value={s.personCount} color="var(--text-muted)" />
                  </div>
                  <PreviewTable rows={s.csvRows} />
                  <button onClick={startPipeline} disabled={s.loading}
                    className="w-full py-3 bg-[var(--dark)] text-white rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 font-semibold text-lg">
                    {s.loading ? "⏳ Uploading..." : `🚀 Upload to Drive & Start (${s.entityCount} entities)`}
                  </button>
                </div>
              )}
            </Card>
          )}

          {/* ── CLAY PROCESSING ── */}
          {s.phase === "clay-processing" && (
            <Card title="⚙️ Step 2 — Clay Processing">
              <div className="mb-5">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[var(--text-muted)]">Records received from Clay → Airtable</span>
                  <span className="font-mono font-bold text-[var(--text)]">{s.airtableCount} / {s.expectedCount}</span>
                </div>
                <div className="w-full bg-[var(--bg)] rounded-full h-5 border border-[var(--border)] overflow-hidden">
                  <div className="bg-[var(--accent)] h-full rounded-full transition-all duration-500 flex items-center justify-center text-xs text-[var(--text)] font-bold"
                    style={{ width: `${progress}%` }}>
                    {progress > 15 ? `${progress}%` : ""}
                  </div>
                </div>
                {batchComplete
                  ? <p className="text-[var(--success)] text-sm mt-2 font-medium">✅ Batch complete — all records received!</p>
                  : <p className="text-[var(--text-muted)] text-xs mt-2">Auto-refreshing every 30s. Clay processes entities one-by-one with 3 Claygents.</p>
                }
              </div>
              <div className="flex gap-3">
                <button onClick={manualRefresh}
                  className="px-4 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg hover:bg-[var(--border)] font-medium">
                  🔄 Refresh Count
                </button>
                <button onClick={processResults} disabled={s.loading || s.airtableCount === 0}
                  className="flex-1 py-2 bg-[var(--success)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-semibold">
                  {s.loading ? "⏳ Processing..." : `📊 Process & Classify (${s.airtableCount} records)`}
                </button>
              </div>
              {!batchComplete && s.airtableCount > 0 && (
                <p className="text-xs text-[var(--warning)] mt-2">
                  ⚠️ Not all records received yet ({s.airtableCount}/{s.expectedCount}). You can process now or wait for more.
                </p>
              )}
            </Card>
          )}

          {/* ── RESULTS ── */}
          {(s.phase === "results" || s.phase === "done") && s.stats && (
            <>
              {/* Summary Stats */}
              <Card title="📊 Step 3 — Results Summary">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <Stat label="Unique Records" value={s.stats.dedupedTotal} />
                  <Stat label="✅ Found" value={s.stats.foundCount} color="var(--success)" />
                  <Stat label="🔍 Not Found" value={s.stats.reiskipCount} color="var(--warning)" />
                  <Stat label="🗑 Dupes Removed" value={s.stats.duplicatesRemoved} color="var(--text-muted)" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="📞 Phone Coverage" value={`${s.stats.phoneCoverage}%`} color="var(--accent)" />
                  <Stat label="📧 Email Coverage" value={`${s.stats.emailCoverage}%`} color="var(--accent)" />
                </div>
              </Card>

              {/* Found contacts */}
              {s.found.length > 0 && (
                <Card title={`✅ Found by Clay (${s.found.length})`}>
                  <ResultTable records={s.found} />
                  <button onClick={downloadFound}
                    className="mt-3 px-4 py-2 bg-[var(--success)] text-white rounded-lg hover:opacity-90 font-medium">
                    ⬇️ Download Found CSV ({s.found.length} rows)
                  </button>
                </Card>
              )}

              {/* Not Found — REISkip */}
              {s.reiskip.length > 0 && (
                <Card title={`🔍 Not Found — Send to REISkip (${s.reiskip.length})`}>
                  <NotFoundTable records={s.reiskip} />
                  <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                    <strong>Next step:</strong> Download this CSV → Upload to <a href="https://reiskip.com" target="_blank" className="underline">reiskip.com</a> → Upload the results below
                  </div>
                  <button onClick={downloadNotFound}
                    className="mt-3 px-4 py-2 bg-[var(--warning)] text-white rounded-lg hover:opacity-90 font-semibold">
                    ⬇️ Download for REISkip ({s.reiskip.length} rows)
                  </button>
                </Card>
              )}

              {/* REISkip Returns Upload */}
              <Card title="📥 Step 4 — Upload REISkip Returns">
                <p className="text-sm text-[var(--text-muted)] mb-3">
                  After running the Not Found CSV through REISkip, upload the results file here:
                </p>
                <input ref={reiskipRef} type="file" accept=".csv" onChange={handleReiskipFile}
                  className="block w-full text-sm text-[var(--text-muted)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[var(--warning)] file:text-black hover:file:opacity-90 file:cursor-pointer" />
                {s.reiskipReturns.length > 0 && (
                  <p className="mt-2 text-sm text-[var(--success)]">✅ {s.reiskipReturns.length} REISkip returns loaded</p>
                )}

                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <p className="text-sm text-[var(--text)] font-medium mb-2">
                    {s.reiskipReturns.length > 0
                      ? `Generate consolidated report: ${s.found.length} from Clay + up to ${s.reiskipReturns.length} from REISkip`
                      : "Skip REISkip and generate Clay-only report:"}
                  </p>
                  <button onClick={generateReport} disabled={s.loading}
                    className="w-full py-3 bg-[var(--dark)] text-white rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 font-semibold">
                    {s.loading ? "⏳ Generating..." : "🔗 Generate Consolidated Report + Analytics"}
                  </button>
                </div>
              </Card>
            </>
          )}

          {/* ── DONE ── */}
          {s.phase === "done" && (
            <Card title="✅ Pipeline Complete">
              <p className="text-[var(--success)] font-semibold mb-3">
                Consolidated report downloaded and uploaded to Google Drive!
              </p>
              <div className="flex flex-wrap gap-3">
                {s.found.length > 0 && (
                  <button onClick={downloadFound}
                    className="px-4 py-2 bg-[var(--success)] text-white rounded-lg hover:opacity-90">
                    ⬇️ Found CSV ({s.found.length})
                  </button>
                )}
                {s.reiskip.length > 0 && (
                  <button onClick={downloadNotFound}
                    className="px-4 py-2 bg-[var(--warning)] text-white rounded-lg hover:opacity-90">
                    ⬇️ Not Found CSV ({s.reiskip.length})
                  </button>
                )}
                <button onClick={() => { setS(INITIAL); setLog([]); }}
                  className="px-4 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg hover:bg-[var(--border)]">
                  Start New Batch
                </button>
              </div>
            </Card>
          )}
        </div>

        {/* Sidebar — Log */}
        <div className="lg:col-span-1 space-y-4">
          <Card title="📋 Activity Log">
            <div className="h-[520px] overflow-y-auto font-mono text-xs space-y-1">
              {log.length === 0 && <p className="text-[var(--text-muted)]">Upload a CSV to begin...</p>}
              {log.map((msg, i) => (
                <p key={i} className={
                  msg.includes("❌") ? "text-red-400" :
                  msg.includes("✅") || msg.includes("🟢") ? "text-green-400" :
                  msg.includes("⚠️") ? "text-amber-400" :
                  "text-[var(--text-muted)]"
                }>{msg}</p>
              ))}
            </div>
          </Card>
          {s.error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              ❌ {s.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
      <h2 className="text-xl font-semibold mb-3 text-[var(--dark)]">{title}</h2>
      {children}
    </div>
  );
}
function Stat({ label, value, color }: { label: string; value: string|number; color?: string }) {
  return (
    <div className="text-center p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
      <div className="text-2xl font-bold" style={{ color: color||"white" }}>{value}</div>
      <div className="text-xs text-[var(--text-muted)] mt-1">{label}</div>
    </div>
  );
}
function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
      <div className="text-xl font-bold" style={{ color: color||"white" }}>{value}</div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}
function PreviewTable({ rows }: { rows: Record<string, string>[] }) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]).slice(0, 5);
  return (
    <div className="overflow-x-auto max-h-40 rounded border border-[var(--border)]">
      <table className="w-full text-xs"><thead className="bg-[var(--card)] sticky top-0">
        <tr>{cols.map(h => <th key={h} className="px-2 py-1.5 text-left text-[var(--text-muted)]">{h}</th>)}</tr>
      </thead><tbody>
        {rows.slice(0,5).map((r,i) => (
          <tr key={i} className={i%2===0?"bg-[var(--bg)]":""}>
            {cols.map(c => <td key={c} className="px-2 py-1 truncate max-w-[130px]">{r[c]}</td>)}
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}
function ResultTable({ records }: { records: CleanedRecord[] }) {
  return (
    <div className="overflow-x-auto max-h-64 rounded border border-[var(--border)]">
      <table className="w-full text-xs"><thead className="bg-[var(--card)] sticky top-0">
        <tr>{["Owner","Contact","Phone","Email","State"].map(h=>(
          <th key={h} className="px-2 py-1.5 text-left text-[var(--text-muted)]">{h}</th>
        ))}</tr>
      </thead><tbody>
        {records.map((r,i) => (
          <tr key={i} className={i%2===0?"bg-[var(--bg)]":""}>
            <td className="px-2 py-1 truncate max-w-[180px]">{r.ownerName}</td>
            <td className="px-2 py-1 truncate max-w-[150px]">{r.primaryContact}</td>
            <td className="px-2 py-1 font-mono">{r.phone1}</td>
            <td className="px-2 py-1 truncate max-w-[180px]">{r.email1}</td>
            <td className="px-2 py-1">{r.propertyState}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}
function NotFoundTable({ records }: { records: CleanedRecord[] }) {
  return (
    <div className="overflow-x-auto max-h-48 rounded border border-[var(--border)]">
      <table className="w-full text-xs"><thead className="bg-[var(--card)] sticky top-0">
        <tr>{["Owner Name","Address","City","State","APN"].map(h=>(
          <th key={h} className="px-2 py-1.5 text-left text-[var(--text-muted)]">{h}</th>
        ))}</tr>
      </thead><tbody>
        {records.map((r,i) => (
          <tr key={i} className={i%2===0?"bg-[var(--bg)]":""}>
            <td className="px-2 py-1 truncate max-w-[200px]">{r.ownerName}</td>
            <td className="px-2 py-1 truncate max-w-[160px]">{r.propertyAddress}</td>
            <td className="px-2 py-1">{r.propertyCity}</td>
            <td className="px-2 py-1">{r.propertyState}</td>
            <td className="px-2 py-1 font-mono text-xs">{r.apn}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}
function today(): string { return new Date().toISOString().slice(0,10); }
function pct(n: number, total: number): number { return total ? Math.round(n/total*100) : 0; }
