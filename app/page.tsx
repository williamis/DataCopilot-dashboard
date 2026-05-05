"use client";

import { useState, useMemo, useEffect, type ChangeEvent } from "react";
import Papa from "papaparse";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";

type CsvRow = string[];
type ColumnType = "number" | "date" | "string";

interface ColumnSummary {
  name: string;
  type: ColumnType;
  missing: number;
}

interface DatasetSummary {
  rowCount: number;
  columnCount: number;
  numericColumns: number;
  categoricalColumns: number;
  totalMissing: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const PREMIUM_COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#10b981", "#f59e0b", "#06b6d4"];

export default function DataCopilot() {
  const [mounted, setMounted] = useState(false);
  const [dataState, setDataState] = useState<{
    fileName: string;
    headers: string[];
    rows: CsvRow[];
    summaries: ColumnSummary[];
    datasetSummary: DatasetSummary | null;
  }>({ fileName: "", headers: [], rows: [], summaries: [], datasetSummary: null });

  const [uiState, setUiState] = useState<{
    selectedCol: string;
    activeTab: "visualize" | "table";
    chartType: "bar" | "area";
    notification: string | null;
  }>({ selectedCol: "", activeTab: "visualize", chartType: "bar", notification: null });

  const [messages, setMessages] = useState<Message[]>([]);
  const [userQuestion, setUserQuestion] = useState("");
  const [loading, setLoading] = useState({ chat: false, file: false });

  useEffect(() => {
    setMounted(true);
  }, []);

  const showNotification = (msg: string) => {
    setUiState(prev => ({ ...prev, notification: msg }));
    setTimeout(() => setUiState(prev => ({ ...prev, notification: null })), 4000);
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(prev => ({ ...prev, file: true }));

    Papa.parse<CsvRow>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const [rawHeader, ...rawRows] = results.data;
        if (!rawHeader) {
          setLoading(prev => ({ ...prev, file: false }));
          showNotification("Error: Empty file.");
          return;
        }

        const validIdx = rawHeader.map((h, i) => (h?.trim() ? i : -1)).filter(i => i !== -1);
        const cleanHeaders = validIdx.map(i => rawHeader[i]);
        const cleanRows = rawRows.map(row => validIdx.map(i => row[i]));

        const summaries: ColumnSummary[] = cleanHeaders.map((name, i) => {
          const values = cleanRows.map(r => r[i] || "");
          const isNum = values.slice(0, 50).every(v => !v || !isNaN(Number(v.replace(",", "."))));
          return { name, type: isNum ? "number" : "string", missing: values.filter(v => !v.trim()).length };
        });

        setDataState({
          fileName: file.name,
          headers: cleanHeaders,
          rows: cleanRows,
          summaries,
          datasetSummary: {
            rowCount: cleanRows.length,
            columnCount: cleanHeaders.length,
            numericColumns: summaries.filter(s => s.type === "number").length,
            categoricalColumns: summaries.filter(s => s.type === "string").length,
            totalMissing: summaries.reduce((acc, s) => acc + s.missing, 0)
          },
        });

        setUiState(prev => ({ 
          ...prev, 
          selectedCol: summaries.find(s => s.type === "string")?.name || cleanHeaders[0] 
        }));
        
        setMessages([
          { role: "assistant", content: `Hello! I've loaded **${file.name}**. How can I help you analyze it?` }
        ]);

        setLoading(prev => ({ ...prev, file: false }));
        showNotification("Dataset loaded successfully.");
      }
    });
  };

  const chartData = useMemo(() => {
    if (!uiState.selectedCol || !dataState.rows.length) return [];
    const colIdx = dataState.headers.indexOf(uiState.selectedCol);
    if (colIdx === -1) return [];

    // Etsitään numerosarake summatavaksi (esim. "value" tai "amount")
    const valueIdx = dataState.headers.findIndex(h => 
      h.toLowerCase().includes('value') || h.toLowerCase().includes('amount')
    );

    const totals: Record<string, number> = {};

    dataState.rows.forEach(r => {
      const key = r[colIdx]?.trim() || "(empty)";
      // Jos löytyy numerosarake, summataan se. Jos ei, lasketaan rivit (count).
      const rawValue = valueIdx !== -1 ? r[valueIdx]?.replace(",", ".") : null;
      const val = rawValue ? parseFloat(rawValue) || 0 : 1;
      
      totals[key] = (totals[key] || 0) + val;
    });

    return Object.entries(totals)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [uiState.selectedCol, dataState.rows, dataState.headers]);

  const askAI = async (overrideQuestion?: string) => {
    const query = overrideQuestion || userQuestion;
    if (!query || !dataState.datasetSummary) return;

    setLoading(prev => ({ ...prev, chat: true }));
    setUserQuestion("");

    const newMessages = [...messages, { role: "user", content: query } as Message];
    setMessages(newMessages);

    const topCategories: Record<string, any> = {};
    dataState.summaries.filter(s => s.type === 'string').slice(0, 3).forEach(col => {
      const idx = dataState.headers.indexOf(col.name);
      const counts: Record<string, number> = {};
      dataState.rows.forEach(r => { counts[r[idx] || "N/A"] = (counts[r[idx] || "N/A"] || 0) + 1; });
      topCategories[col.name] = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          question: query, 
          datasetSummary: dataState.datasetSummary, 
          columnSummaries: dataState.summaries, 
          topCategories,
          sampleRows: dataState.rows.slice(0, 5)
        }),
      });
      const data = await res.json();
      setMessages([...newMessages, { role: "assistant", content: data.answer }]);
    } catch {
      showNotification("Failed to connect with Copilot.");
    } finally {
      setLoading(prev => ({ ...prev, chat: false }));
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen text-zinc-100 p-4 md:p-8 flex flex-col">
      
      {uiState.notification && (
        <div className="fixed top-6 right-6 z-50 bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 px-5 py-3 rounded-2xl shadow-2xl">
          <p className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            {uiState.notification}
          </p>
        </div>
      )}

      <div className="max-w-7xl mx-auto w-full space-y-10">
        
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-zinc-900">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-600 bg-clip-text text-transparent">
              DataCopilot
            </h1>
            <p className="text-zinc-500 text-sm font-medium mt-1">Autonomous exploratory data analysis.</p>
          </div>
          {dataState.fileName && (
            <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800/80 px-4 py-2 rounded-full text-xs text-zinc-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {dataState.fileName}
            </div>
          )}
        </header>

        {!dataState.datasetSummary ? (
          <div className="max-w-2xl mx-auto py-20">
            <div className="border border-dashed border-zinc-800 bg-zinc-950/30 backdrop-blur-lg hover:border-zinc-700/80 transition-all rounded-[32px] p-12 text-center flex flex-col items-center justify-center group relative overflow-hidden">
              <div className="w-16 h-16 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-2">Import your dataset</h2>
              <p className="text-zinc-500 text-sm max-w-sm mb-8">Select a CSV file to begin analysis. Processing happens locally in your browser.</p>
              
              <input 
                type="file" 
                onChange={handleFile} 
                className="hidden" 
                id="file-drop-selector" 
                accept=".csv"
                key={dataState.fileName || 'empty'}
              />
              <label htmlFor="file-drop-selector" className="cursor-pointer bg-zinc-100 text-zinc-950 px-8 py-3.5 rounded-full font-bold hover:bg-white transition-all shadow-xl active:scale-95 text-sm">
                Choose CSV File
              </label>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            <div className="lg:col-span-8 space-y-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total Rows", value: dataState.datasetSummary.rowCount },
                  { label: "Columns", value: dataState.datasetSummary.columnCount },
                  { label: "Missing Values", value: dataState.datasetSummary.totalMissing },
                  { label: "Categorical", value: dataState.datasetSummary.categoricalColumns }
                ].map((stat, i) => (
                  <div key={i} className="bg-zinc-950/40 border border-zinc-900/80 p-5 rounded-2xl">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{stat.label}</p>
                    <p className="text-3xl font-light tracking-tight text-white mt-2">{stat.value.toLocaleString()}</p>
                  </div>
                ))}
              </div>

              <div className="bg-zinc-950/40 border border-zinc-900/80 rounded-[28px] overflow-hidden">
                <div className="flex justify-between items-center px-6 py-4 border-b border-zinc-900 bg-zinc-900/20">
                  <div className="flex gap-2 bg-zinc-900/60 p-1 rounded-full">
                    <button 
                      onClick={() => setUiState(p => ({ ...p, activeTab: "visualize" }))}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${uiState.activeTab === "visualize" ? "bg-zinc-800 text-white" : "text-zinc-500"}`}
                    >
                      Visualization
                    </button>
                    <button 
                      onClick={() => setUiState(p => ({ ...p, activeTab: "table" }))}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${uiState.activeTab === "table" ? "bg-zinc-800 text-white" : "text-zinc-500"}`}
                    >
                      Data Explorer
                    </button>
                  </div>

                  {uiState.activeTab === "visualize" && (
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col">
                        <label htmlFor="col-select" className="sr-only">Select column</label>
                        <select 
                          id="col-select"
                          name="col-select"
                          aria-label="Select column to visualize"
                          title="Select column to visualize"
                          value={uiState.selectedCol} 
                          onChange={(e) => setUiState(prev => ({ ...prev, selectedCol: e.target.value }))} 
                          className="bg-zinc-900 text-xs border border-zinc-800 rounded-full px-4 py-1.5 text-zinc-300 focus:outline-none"
                        >
                          {dataState.summaries.filter(s => s.type === 'string').map(s => (
                            <option key={s.name} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-8">
                  {uiState.activeTab === "visualize" ? (
                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#121214" vertical={false} />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#52525b' }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#52525b' }} />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#18181b', 
                              border: '1px solid #3f3f46', 
                              borderRadius: '8px',
                              color: '#ffffff' 
                            }} 
                            itemStyle={{ color: '#ffffff' }}
                          />
                          <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={40}>
                            {chartData.map((_, i) => (
                              <Cell key={i} fill={PREMIUM_COLORS[i % PREMIUM_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-zinc-900 max-h-80">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-zinc-900/60 text-zinc-400 border-b border-zinc-900">
                            {dataState.headers.map((h, i) => (
                              <th key={i} className="p-3.5 font-mono">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-900/40">
                          {dataState.rows.slice(0, 10).map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-zinc-900/20">
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="p-3 text-zinc-300 font-mono text-[11px]">{cell || "N/A"}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-4">
              <div className="bg-zinc-950/40 border border-zinc-900/80 rounded-[32px] h-[600px] flex flex-col shadow-2xl overflow-hidden">
                <div className="px-6 py-5 border-b border-zinc-900/80 bg-zinc-900/10">
                  <h3 className="text-sm font-semibold text-white">Copilot Chat</h3>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {messages.map((msg, idx) => (
                    <div 
                      key={idx} 
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs ${
                        msg.role === "user" 
                          ? "bg-zinc-900 text-zinc-200 ml-auto border border-zinc-800" 
                          : "bg-zinc-900/30 text-zinc-300 border border-zinc-900"
                      }`}
                    >
                      <p className="whitespace-pre-line">{msg.content}</p>
                    </div>
                  ))}
                </div>

                <div className="p-4 border-t border-zinc-900 bg-zinc-950/60">
                  <div className="relative flex items-center">
                    <input 
                      value={userQuestion} 
                      onChange={(e) => setUserQuestion(e.target.value)} 
                      onKeyDown={(e) => e.key === 'Enter' && askAI()} 
                      placeholder="Ask about your data..." 
                      className="w-full bg-zinc-900/40 border border-zinc-900 rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-zinc-700"
                    />
                    <button 
                      onClick={() => askAI()} 
                      disabled={loading.chat || !userQuestion} 
                      className="absolute right-2 px-3 py-1.5 bg-zinc-100 text-zinc-950 rounded-lg text-[10px] font-bold disabled:opacity-30"
                    >
                      Ask
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {dataState.datasetSummary && (
          <div className="flex justify-center pt-8 border-t border-zinc-900/60">
            <input type="file" onChange={handleFile} className="hidden" id="file-helper-bottom" accept=".csv" />
            <label htmlFor="file-helper-bottom" className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-300 transition-all font-semibold uppercase flex items-center gap-2">
              Upload Different CSV File
            </label>
          </div>
        )}

      </div>
    </div>
  );
}