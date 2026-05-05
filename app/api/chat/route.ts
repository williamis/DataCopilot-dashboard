import { NextRequest, NextResponse } from "next/server";
import { groqClient } from "@/lib/groqClient";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, datasetSummary, columnSummaries, topCategories, sampleRows } = body;

    const systemPrompt = `
You are an expert Data Analyst. You have been provided with pre-calculated statistics of a large dataset.
STRICT RULES:
1. Always use the "TOP CATEGORY STATS" provided below to answer questions about counts or "most frequent" items.
2. If a user asks for the "most common" or "highest" in a category, look at the counts provided.
3. Be concise, professional, and use Markdown.
`.trim();

    const userPrompt = `
USER QUESTION: ${question}

DATASET OVERVIEW:
- Total Rows: ${datasetSummary.rowCount}
- Columns: ${datasetSummary.columnCount}

TOP CATEGORY STATS (Frequency counts of values):
${JSON.stringify(topCategories, null, 2)}

COLUMN METADATA:
${JSON.stringify(columnSummaries)}

SAMPLE DATA (First few rows):
${JSON.stringify(sampleRows)}
`.trim();

    const completion = await groqClient.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1000,
    });

    return NextResponse.json({ answer: completion.choices[0]?.message?.content });
  } catch (error) {
    return NextResponse.json({ error: "API Error" }, { status: 500 });
  }
}