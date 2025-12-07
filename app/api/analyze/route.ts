import { NextRequest, NextResponse } from "next/server";
import { groqClient } from "@/lib/groqClient";

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

const SYSTEM_PROMPT = `
You are a senior data analyst. You receive:
- a dataset summary (rows, columns, numeric/categorical/date columns, missing values)
- column-level information
- a small sample of rows

Your job is to:
1) Explain in plain English what this dataset looks like.
2) Highlight the most interesting patterns, trends, or anomalies.
3) Suggest 3–5 practical recommendations or next steps for someone analysing this data.

You MUST return ONLY valid JSON with this exact shape:

{
  "overview": string,
  "keyFindings": string,
  "recommendations": string
}

STRICT RULES:
- All values MUST be valid JSON strings.
- If you want bullet points, put them INSIDE the string, for example:
  "- point one\\n- point two\\n- point three"
- Do NOT write any "*" or "-" or bullet markers outside of quoted strings.
- Do NOT include backticks, markdown, code blocks or any text outside the JSON object.
- Do NOT add extra fields.
`.trim();

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      datasetSummary?: DatasetSummary;
      columnSummaries?: ColumnSummary[];
      sampleRows?: string[][];
    } | null;

    if (!body?.datasetSummary || !body?.columnSummaries) {
      return NextResponse.json(
        { error: "Missing datasetSummary or columnSummaries" },
        { status: 400 }
      );
    }

    const { datasetSummary, columnSummaries, sampleRows } = body;

    const userPrompt = `
DATASET SUMMARY (JSON):
${JSON.stringify(datasetSummary, null, 2)}

COLUMNS (JSON):
${JSON.stringify(columnSummaries, null, 2)}

SAMPLE ROWS (first rows, JSON):
${JSON.stringify(sampleRows ?? [], null, 2)}
    `.trim();

    const completion = await groqClient.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 700,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "No content from Groq model" },
        { status: 500 }
      );
    }

    let parsed: AiInsightResponse;
    try {
      parsed = JSON.parse(content) as AiInsightResponse;
    } catch (err) {
      console.error("JSON parse error from Groq response:", content);
      return NextResponse.json(
        { error: "Failed to parse model response from Groq" },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed, { status: 200 });
  } catch (error) {
    console.error("Analyze API error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}