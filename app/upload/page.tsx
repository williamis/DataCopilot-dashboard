"use client";

import { useState, type ChangeEvent } from "react";
import Papa, { ParseResult } from "papaparse";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type CsvRow = string[];

type ColumnType = "number" | "date" | "string";

type ColumnSummary = {
  name: string;
  type: ColumnType;
  missing: number;
};

type DatasetSummary = {
  rowCount: number;
  columnCount: number;
  numericColumns: number;
  categoricalColumns: number;
  dateColumns: number;
  totalMissing: number;
};

type AiInsightResponse = {
  overview: string;
  keyFindings: string;
  recommendations: string;
};

type ChartDataItem = {
  category: string;
  value: number;
};

function inferColumnType(values: string[]): ColumnType {
  const nonEmpty = values.filter((v) => v.trim() !== "").slice(0, 50);
  if (nonEmpty.length === 0) return "string";

  const isNumber = nonEmpty.every((v) =>
    /^-?\d+(\.\d+)?$/.test(v.replace(",", "."))
  );
  if (isNumber) return "number";

  const isDate = nonEmpty.every((v) => !Number.isNaN(Date.parse(v)));
  if (isDate) return "date";

  return "string";
}

function analyzeData(headers: string[], rows: CsvRow[]): {
  columns: ColumnSummary[];
  summary: DatasetSummary;
} {
  const columnCount = headers.length;
  const rowCount = rows.length;

  const columns: ColumnSummary[] = [];
  let numericColumns = 0;
  let categoricalColumns = 0;
  let dateColumns = 0;
  let totalMissing = 0;

  for (let col = 0; col < columnCount; col++) {
    const colValues = rows.map((r) => (r[col] ?? "").toString());
    const missing = colValues.filter((v) => v.trim() === "").length;
    totalMissing += missing;

    const type = inferColumnType(colValues);

    if (type === "number") numericColumns++;
    else if (type === "date") dateColumns++;
    else categoricalColumns++;

    columns.push({
      name: headers[col] ?? `Column ${col + 1}`,
      type,
      missing,
    });
  }

  return {
    columns,
    summary: {
      rowCount,
      columnCount,
      numericColumns,
      categoricalColumns,
      dateColumns,
      totalMissing,
    },
  };
}

function buildCategoryChartData(
  rows: CsvRow[],
  headers: string[],
  columnName: string
): ChartDataItem[] {
  const colIndex = headers.indexOf(columnName);
  if (colIndex === -1) return [];

  const counts: Record<string, number> = {};

  for (const row of rows) {
    const raw = row[colIndex];
    const key = (raw ?? "").toString().trim() || "(empty)";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const items = Object.entries(counts).map(([category, value]) => ({
    category,
    value,
  }));

  // Top 15 categories by count
  items.sort((a, b) => b.value - a.value);
  return items.slice(0, 15);
}

export default function UploadPage() {
  const [csvPreview, setCsvPreview] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<CsvRow[]>([]);
  const [columnSummaries, setColumnSummaries] = useState<ColumnSummary[]>([]);
  const [datasetSummary, setDatasetSummary] = useState<DatasetSummary | null>(
    null
  );

  const [insights, setInsights] = useState<AiInsightResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const [selectedCategoryCol, setSelectedCategoryCol] = useState<string>("");
  const [chartData, setChartData] = useState<ChartDataItem[]>([]);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setInsights(null);
    setInsightsError(null);
    setSelectedCategoryCol("");
    setChartData([]);

    Papa.parse<CsvRow>(file, {
      skipEmptyLines: true,
      complete: (results: ParseResult<CsvRow>) => {
        const rows = results.data;
        if (!rows || rows.length === 0) return;

        const [headerRow, ...dataRowsRaw] = rows;
        const limitedRows = dataRowsRaw.slice(0, 5000); // rajoitetaan, ettei muistia pala liikaa

        setHeaders(headerRow);
        setDataRows(limitedRows);
        setCsvPreview([headerRow, ...limitedRows.slice(0, 19)]); // header + 19 riviä

        const { columns, summary } = analyzeData(headerRow, limitedRows);
        setColumnSummaries(columns);
        setDatasetSummary(summary);

        // Valitaan oletuksena ensimmäinen kategorinen sarake charttiin
        const firstCategorical = columns.find((c) => c.type === "string");
        if (firstCategorical) {
          setSelectedCategoryCol(firstCategorical.name);
          setChartData(buildCategoryChartData(limitedRows, headerRow, firstCategorical.name));
        }
      },
    });
  };

  const handleGenerateInsights = async () => {
    if (!datasetSummary || columnSummaries.length === 0) return;

    setInsightsLoading(true);
    setInsightsError(null);
    setInsights(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetSummary,
          columnSummaries,
          sampleRows: csvPreview,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
  console.error("AI API error:", data);

  // Groq-virheiden siistimpi näyttö
  const apiMessage =
    typeof data?.error === "string"
      ? data.error
      : data?.error?.message ||
        `Server returned an error (status ${res.status}).`;

  setInsightsError(apiMessage);
  return;
}

      setInsights(data as AiInsightResponse);
    } catch (err) {
      console.error(err);
      setInsightsError(
        "Failed to contact AI analysis service. Please try again."
      );
    } finally {
      setInsightsLoading(false);
    }
  };

  const handleCategoryColumnChange = (newCol: string) => {
    setSelectedCategoryCol(newCol);
    if (!newCol || dataRows.length === 0 || headers.length === 0) {
      setChartData([]);
      return;
    }
    setChartData(buildCategoryChartData(dataRows, headers, newCol));
  };

  const categoricalColumns = columnSummaries.filter(
    (c) => c.type === "string"
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold mb-2">DataCopilot Dashboard</h1>
          <p className="text-slate-400">
            Upload a CSV file to get an automatic overview, visualizations and
            AI-powered insights.
          </p>
        </header>

        {/* FILE INPUT */}
        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
          <label
            htmlFor="csv-file"
            className="block mb-3 font-semibold"
          >
            Select CSV File
          </label>

          <input
            id="csv-file"
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="block w-full text-sm file:bg-sky-700 file:hover:bg-sky-600 
                       file:text-white file:px-4 file:py-2 file:rounded-lg"
          />

          {fileName && (
            <p className="text-slate-400 text-sm mt-3">
              Selected file:{" "}
              <span className="text-slate-200 font-medium">{fileName}</span>
            </p>
          )}
        </div>

        {/* SUMMARY CARDS */}
        {datasetSummary && (
          <section className="bg-slate-900 p-6 rounded-xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold mb-2">Dataset summary</h2>
              <button
                onClick={handleGenerateInsights}
                disabled={insightsLoading}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 
                           disabled:opacity-60 disabled:cursor-not-allowed text-sm font-semibold"
              >
                {insightsLoading ? "Analyzing with AI..." : "Generate AI insights"}
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-slate-400">Rows</div>
                <div className="text-lg font-semibold">
                  {datasetSummary.rowCount}
                </div>
              </div>
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-slate-400">Columns</div>
                <div className="text-lg font-semibold">
                  {datasetSummary.columnCount}
                </div>
              </div>
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-slate-400">Numeric columns</div>
                <div className="text-lg font-semibold">
                  {datasetSummary.numericColumns}
                </div>
              </div>
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-slate-400">Categorical columns</div>
                <div className="text-lg font-semibold">
                  {datasetSummary.categoricalColumns}
                </div>
              </div>
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-slate-400">Date columns</div>
                <div className="text-lg font-semibold">
                  {datasetSummary.dateColumns}
                </div>
              </div>
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-slate-400">Missing values</div>
                <div className="text-lg font-semibold">
                  {datasetSummary.totalMissing}
                </div>
              </div>
            </div>

            {insightsError && (
              <p className="text-sm text-red-400 mt-2">{insightsError}</p>
            )}
          </section>
        )}

        {/* DISTRIBUTION CHART */}
        {dataRows.length > 0 && categoricalColumns.length > 0 && (
          <section className="bg-slate-900 p-6 rounded-xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">Category distribution</h2>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">Column:</span>
                <select
                  value={selectedCategoryCol}
                  onChange={(e) => handleCategoryColumnChange(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {categoricalColumns.map((col) => (
                    <option key={col.name} value={col.name}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {chartData.length > 0 ? (
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis
                      dataKey="category"
                      tick={{ fontSize: 11, fill: "#cbd5f5" }}
                      interval={0}
                      angle={-35}
                      textAnchor="end"
                      height={70}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: "#cbd5f5" }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#020617",
                        border: "1px solid #1e293b",
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="value" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Not enough data to build a chart for this column.
              </p>
            )}
          </section>
        )}

        {/* AI INSIGHTS */}
        {insights && (
          <section className="bg-slate-900 p-6 rounded-xl border border-slate-800 space-y-4">
            <h2 className="text-xl font-semibold">AI insights</h2>

            <div>
              <h3 className="text-sky-400 font-semibold mb-1">Overview</h3>
              <p className="text-sm text-slate-200 whitespace-pre-line">
                {insights.overview}
              </p>
            </div>

            <div>
              <h3 className="text-sky-400 font-semibold mb-1">Key findings</h3>
              <p className="text-sm text-slate-200 whitespace-pre-line">
                {insights.keyFindings}
              </p>
            </div>

            <div>
              <h3 className="text-sky-400 font-semibold mb-1">
                Recommendations
              </h3>
              <p className="text-sm text-slate-200 whitespace-pre-line">
                {insights.recommendations}
              </p>
            </div>
          </section>
        )}

        {/* COLUMN DETAILS */}
        {columnSummaries.length > 0 && (
          <section className="bg-slate-900 p-6 rounded-xl border border-slate-800 overflow-x-auto space-y-3">
            <h2 className="text-xl font-semibold">Columns</h2>
            <table className="table-auto border-collapse text-sm min-w-full">
              <thead>
                <tr className="border-b border-slate-800 text-slate-300">
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Missing</th>
                </tr>
              </thead>
              <tbody>
                {columnSummaries.map((col) => (
                  <tr
                    key={col.name}
                    className="border-b border-slate-900 hover:bg-slate-950/60"
                  >
                    <td className="px-3 py-2">{col.name}</td>
                    <td className="px-3 py-2 capitalize">{col.type}</td>
                    <td className="px-3 py-2">{col.missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* CSV PREVIEW */}
        {csvPreview.length > 0 && (
          <section className="bg-slate-900 p-6 rounded-xl border border-slate-800 overflow-x-auto">
            <h2 className="text-xl font-semibold mb-4">
              CSV Preview (header + first rows)
            </h2>

            <table className="table-auto border-collapse text-sm">
              <tbody>
                {csvPreview.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-slate-800">
                    {row.map((cell, colIndex) => (
                      <td key={colIndex} className="px-3 py-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}
