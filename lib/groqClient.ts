import Groq from "groq-sdk";

if (!process.env.GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY is not set in environment");
}

export const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});