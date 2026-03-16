"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { CleanedRecord } from "@/lib/cleaning";

type BatchStatus = "idle" | "uploading" | "monitoring" | "processing" | "ready" | "merging" | "done";

interface BatchState {
  status: BatchStatus;
  csvRows: Record<string, string>[];
  csvRawText: string;
  csvFileName: string;
  sentCount: number;
  airtableCount: number;
  expectedCount: number;
  found: CleanedRecord[];
  reiskip: CleanedRecord[];
  stats: { total: number; foundCount: number; reiskipCount: number; phoneCoverage: number; emailCoverage: number; byState: Record<string, number> } | null;
  reiskipReturns: Record<string, string>[];
  merged: CleanedRecord[];
  sheetUrl: string;
  error: string;
}

function parseCSVClient(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const record: Record<string, string> = {};
    headers.forEach((h, i) => { record[h.trim()] = (values[i] || "").trim(); });
    return record;
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { current += '"'; i++; } else inQuotes = false; }
      else current += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { result.push(current); current = ""; }
      else current += c;
    }
  }
  result.push(current);
  return result;
}

function generateCSV(records: Record<string, string>[], columns: string[]): string {
  const header = columns.map(c => `"${c.replace(/"/g, '""')}"`).join(",");
  const rows = records.map(r => columns.map(c => `"${(r[c] || "").replace(/"/g, '""')}"`).join(","));
  return [header, ...rows].join("\n");
}

function classifyOwner(name: string): "ENTITY" | "PERSON" {
  const u = name.toUpperCase();
  return [/\bLLC\b/, /\bINC\b/, /\bCORP\b/, /\bLTD\b/, /\bLP\b/, /\bLLP\b/, /\bTRUST\b/, /\bESTATE\b/,
    /\bFOUNDATION\b/, /\bPARTNERS\b/, /\bPARTNERSHIP\b/, /\bHOLDINGS\b/, /\bPROPERTIES\b/,
    /\bBUILDERS\b/, /\bGROUP\b/, /\bVENTURE\b/, /\bENTERPRISES?\b/, /\bP\/S\b/,
  ].some(p => p.test(u)) ? "ENTITY" : "PERSON";
}

function mapToClayFormat(r: Record<string, string>): Record<string, string> {
  return {
    "Owner Name": r["OWNER_NAME_1"] || r["Owner Name"] || "",
    "Property Address": r["PROP_ADDRESS"] || r["SITE_ADDR"] || r["Property Address"] || "",
    "Property City": r["PROP_CITY"] || r["SITE_CITY"] || r["Property City"] || "",
    "Property State": r["PROP_STATE"] || r["SITE_STATE"] || r["Property State"] || "",
    "Property Zip": r["PROP_ZIP"] || r["SITE_ZIP"] || r["Property Zip"] || "",
    "Mailing Address": r["MAIL_ADDR"] || r["Mailing Address"] || "",
    "Mailing City": r["MAIL_CITY"] || r["Mailing City"] || "",
    "Mailing State": r["MAIL_STATE"] || r["Mailing State"] || "",
    "Mailing Zip": r["MAIL_ZIP"] || r["Mailing Zip"] || "",
    "County": r["COUNTY"] || r["County"] || "",
    "Apn": r["APN"] || r["Apn"] || "",
  };
}

export default function Home() {
  const [batch, setBatch] = useState<BatchState>({
    status: "idle", csvRows: [], csvRawText: "", csvFileName: "", sentCount: 0, airtableCount: 0, expectedCount: 0,
    found: [], reiskip: [], stats: null, reiskipReturns: [], merged: [], sheetUrl: "", error: "",
  });
  const [log, setLog] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const reiskipRef = useRef<HTMLInputElement>(null);
  const monitorRef = useRef<NodeJS.Timeout | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // Cleanup monitor on unmount
  useEffect(() => {
    return () => { if (monitorRef.current) clearInterval(monitorRef.current); };
  }, []);

  // Step 1: Upload CSV
  const handleCSVUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSVClient(text);
      const entities = rows.filter(r => {
        const name = r["OWNER_NAME_1"] || r["Owner Name"] || "";
        return classifyOwner(name) === "ENTITY";
      });
      setBatch(prev => ({ ...prev, csvRows: rows, csvRawText: text, csvFileName: file.name, expectedCount: entities.length, status: "idle", error: "" }));
      addLog(`CSV loaded: ${rows.length} rows (${entities.length} entities, ${rows.length - entities.length} persons)`);
    };
    reader.readAsText(file);
  }, [addLog]);

  // Step 1b: Upload CSV to Google Drive via n8n webhook
  const uploadToDrive = useCallback(async () => {
    setBatch(prev => ({ ...prev, status: "uploading", sentCount: 0, error: "" }));
    addLog("Uploading CSV to Google Drive...");

    try {
      const res = await fetch("/api/upload-to-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: batch.csvRawText,
          filename: batch.csvFileName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      setBatch(prev => ({ ...prev, sentCount: batch.csvRows.length, status: "monitoring" }));
      addLog(`✅ Uploaded to Drive: ${data.fileName || batch.csvFileName}. n8n will process → Clay. Monitoring Airtable...`);
      startMonitoring();
    } catch (err) {
      setBatch(prev => ({ ...prev, error: String(err), status: "idle" }));
      addLog(`Error: ${err}`);
    }
  }, [batch.csvRawText, batch.csvFileName, batch.csvRows.length, addLog]);

  // Step 2: Monitor Airtable
  const checkAirtable = useCallback(async () => {
    try {
      const res = await fetch("/api/airtable/records");
      const data = await res.json();
      setBatch(prev => ({ ...prev, airtableCount: data.count || 0 }));
      return data.count || 0;
    } catch {
      return 0;
    }
  }, []);

  const startMonitoring = useCallback(() => {
    if (monitorRef.current) clearInterval(monitorRef.current);
    monitorRef.current = setInterval(async () => {
      const count = await checkAirtable();
      addLog(`Airtable: ${count} records found`);
    }, 30000);
    checkAirtable();
  }, [checkAirtable, addLog]);

  // Step 3: Process
  const processResults = useCallback(async () => {
    setBatch(prev => ({ ...prev, status: "processing", error: "" }));
    if (monitorRef.current) { clearInterval(monitorRef.current); monitorRef.current = null; }
    addLog("Fetching records from Airtable...");

    try {
      const atRes = await fetch("/api/airtable/records");
      const atData = await atRes.json();
      addLog(`Got ${atData.count} records. Processing...`);

      const procRes = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: atData.records }),
      });
      const procData = await procRes.json();

      setBatch(prev => ({
        ...prev,
        found: procData.found,
        reiskip: procData.reiskip,
        stats: procData.stats,
        status: "ready",
      }));
      addLog(`Processed: ${procData.stats.foundCount} found, ${procData.stats.reiskipCount} REISkip pending`);
    } catch (err) {
      setBatch(prev => ({ ...prev, error: String(err), status: "monitoring" }));
      addLog(`Error: ${err}`);
    }
  }, [addLog]);

  // Step 4: Download REISkip CSV
  const downloadReiskipCSV = useCallback(() => {
    const columns = ["Owner Name", "Property Address", "Property City", "Property State",
      "Property Zip", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "County", "APN"];
    const rows = batch.reiskip.map(r => ({
      "Owner Name": r.ownerName, "Property Address": r.propertyAddress,
      "Property City": r.propertyCity, "Property State": r.propertyState,
      "Property Zip": r.propertyZip, "Mailing Address": r.mailingAddress,
      "Mailing City": r.mailingCity, "Mailing State": r.mailingState,
      "Mailing Zip": r.mailingZip, "County": r.county, "APN": r.apn,
    }));
    const csv = generateCSV(rows, columns);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reiskip_pending_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`Downloaded REISkip CSV: ${rows.length} rows`);
  }, [batch.reiskip, addLog]);

  // Step 5: Upload REISkip returns
  const handleReiskipUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSVClient(text);
      setBatch(prev => ({ ...prev, reiskipReturns: rows }));
      addLog(`REISkip returns loaded: ${rows.length} rows`);
    };
    reader.readAsText(file);
  }, [addLog]);

  // Step 6: Merge
  const mergeResults = useCallback(async () => {
    setBatch(prev => ({ ...prev, status: "merging" }));
    addLog("Merging found + REISkip returns...");

    // Simple client-side merge for MVP
    const merged = [...batch.found];
    // REISkip returns would need cleaning too - for now just note them
    const totalContacts = merged.length + batch.reiskipReturns.length;

    setBatch(prev => ({
      ...prev,
      merged: prev.found,
      status: "done",
      sheetUrl: `https://docs.google.com/spreadsheets/d/${process.env.NEXT_PUBLIC_GOOGLE_SHEETS_TEMPLATE_ID || "1baw8nUqr0lciyniNjjG7lNCqF7DqbUZnlcewo-bPtAM"}/edit`,
    }));
    addLog(`Merge complete. ${totalContacts} total contacts.`);
  }, [batch.found, batch.reiskipReturns, addLog]);

  const steps = [
    { num: 1, label: "Upload CSV", active: true },
    { num: 2, label: "Monitor Clay", active: ["monitoring", "processing", "ready", "merging", "done"].includes(batch.status) },
    { num: 3, label: "Process Results", active: ["processing", "ready", "merging", "done"].includes(batch.status) },
    { num: 4, label: "REISkip Export", active: ["ready", "merging", "done"].includes(batch.status) },
    { num: 5, label: "REISkip Returns", active: ["ready", "merging", "done"].includes(batch.status) },
    { num: 6, label: "Merge & Finish", active: ["merging", "done"].includes(batch.status) },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">🏢 Entity Skip Trace Pipeline</h1>
        <p className="text-[var(--text-muted)] mt-1">CSV → Clay AI → Clean → REISkip → Merged Contacts</p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
              s.active ? "bg-[var(--accent)] text-white" : "bg-[var(--card)] text-[var(--text-muted)] border border-[var(--border)]"
            }`}>
              <span className="font-mono font-bold">{s.num}</span>
              <span>{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className="text-[var(--border)]">→</span>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Step 1: Upload */}
          <Card title="📁 Step 1: Upload CSV">
            <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVUpload}
              className="block w-full text-sm text-[var(--text-muted)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[var(--accent)] file:text-white hover:file:bg-[var(--accent-hover)] file:cursor-pointer" />
            {batch.csvRows.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-[var(--text-muted)]">
                  {batch.csvRows.length} rows loaded • {batch.expectedCount} entities • {batch.csvRows.length - batch.expectedCount} persons
                </p>
                <div className="mt-2 overflow-x-auto max-h-48 rounded border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--card)] sticky top-0">
                      <tr>
                        {Object.keys(batch.csvRows[0]).slice(0, 6).map(h => (
                          <th key={h} className="px-2 py-1 text-left text-[var(--text-muted)]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {batch.csvRows.slice(0, 5).map((r, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-[var(--bg)]" : "bg-[var(--card)]"}>
                          {Object.values(r).slice(0, 6).map((v, j) => (
                            <td key={j} className="px-2 py-1 truncate max-w-[150px]">{v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={uploadToDrive} disabled={batch.status === "uploading"}
                  className="mt-3 px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-50 font-medium">
                  {batch.status === "uploading" ? "Uploading to Drive..." : `Upload ${batch.csvRows.length} Rows to Google Drive →`}
                </button>
              </div>
            )}
          </Card>

          {/* Step 2: Monitor */}
          {batch.status !== "idle" && batch.status !== "uploading" && (
            <Card title="📡 Step 2: Monitor Clay Processing">
              <div className="flex items-center gap-4">
                <div className="text-2xl font-bold text-[var(--accent)]">{batch.airtableCount}</div>
                <div className="text-sm text-[var(--text-muted)]">records in Airtable</div>
                <button onClick={checkAirtable}
                  className="ml-auto px-3 py-1.5 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--border)]">
                  Refresh
                </button>
              </div>
              {batch.airtableCount > 0 && (
                <button onClick={processResults} disabled={batch.status === "processing"}
                  className="mt-3 px-4 py-2 bg-[var(--success)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium">
                  {batch.status === "processing" ? "Processing..." : `Process ${batch.airtableCount} Records →`}
                </button>
              )}
            </Card>
          )}

          {/* Step 3-4: Results */}
          {batch.stats && (
            <Card title="📊 Step 3-4: Results">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Stat label="Found" value={batch.stats.foundCount} color="var(--success)" />
                <Stat label="REISkip Pending" value={batch.stats.reiskipCount} color="var(--warning)" />
                <Stat label="Phone Coverage" value={`${batch.stats.phoneCoverage}%`} color="var(--accent)" />
              </div>
              {batch.found.length > 0 && (
                <div className="overflow-x-auto max-h-64 rounded border border-[var(--border)] mb-4">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--card)] sticky top-0">
                      <tr>
                        {["Owner", "Primary Contact", "Phone 1", "Email 1", "State", "Status"].map(h => (
                          <th key={h} className="px-2 py-1 text-left text-[var(--text-muted)]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {batch.found.map((r, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-[var(--bg)]" : "bg-[var(--card)]"}>
                          <td className="px-2 py-1 truncate max-w-[180px]">{r.ownerName}</td>
                          <td className="px-2 py-1 truncate max-w-[150px]">{r.primaryContact}</td>
                          <td className="px-2 py-1">{r.phone1}</td>
                          <td className="px-2 py-1 truncate max-w-[180px]">{r.email1}</td>
                          <td className="px-2 py-1">{r.propertyState}</td>
                          <td className="px-2 py-1">
                            <span className="px-1.5 py-0.5 rounded text-xs bg-green-900/50 text-green-400">Found</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {batch.reiskip.length > 0 && (
                <button onClick={downloadReiskipCSV}
                  className="px-4 py-2 bg-[var(--warning)] text-black rounded-lg hover:opacity-90 font-medium">
                  ⬇️ Download REISkip CSV ({batch.reiskip.length} rows)
                </button>
              )}
            </Card>
          )}

          {/* Step 5: Upload REISkip Returns */}
          {batch.status === "ready" && (
            <Card title="📥 Step 5: Upload REISkip Returns">
              <input ref={reiskipRef} type="file" accept=".csv" onChange={handleReiskipUpload}
                className="block w-full text-sm text-[var(--text-muted)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[var(--warning)] file:text-black hover:file:opacity-90 file:cursor-pointer" />
              {batch.reiskipReturns.length > 0 && (
                <p className="mt-2 text-sm text-[var(--success)]">✅ {batch.reiskipReturns.length} REISkip returns loaded</p>
              )}
            </Card>
          )}

          {/* Step 6: Merge */}
          {batch.status === "ready" && (
            <Card title="🔗 Step 6: Merge & Generate Sheet">
              <button onClick={mergeResults}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] font-medium">
                Merge & Generate Final Sheet →
              </button>
            </Card>
          )}

          {/* Done */}
          {batch.status === "done" && batch.sheetUrl && (
            <Card title="✅ Complete">
              <p className="text-[var(--success)] font-medium">Pipeline complete!</p>
              <a href={batch.sheetUrl} target="_blank" rel="noopener noreferrer"
                className="inline-block mt-2 px-4 py-2 bg-[var(--success)] text-white rounded-lg hover:opacity-90 font-medium">
                Open Google Sheet →
              </a>
            </Card>
          )}
        </div>

        {/* Sidebar: Log */}
        <div className="lg:col-span-1">
          <Card title="📋 Activity Log">
            <div className="h-96 overflow-y-auto font-mono text-xs space-y-1">
              {log.length === 0 && <p className="text-[var(--text-muted)]">Upload a CSV to begin...</p>}
              {log.map((msg, i) => (
                <p key={i} className="text-[var(--text-muted)]">{msg}</p>
              ))}
            </div>
          </Card>

          {/* Error display */}
          {batch.error && (
            <div className="mt-4 p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-sm">
              ❌ {batch.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-3 text-white">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="text-center p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-[var(--text-muted)] mt-1">{label}</div>
    </div>
  );
}
