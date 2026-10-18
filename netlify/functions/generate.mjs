import { GoogleGenAI } from "@google/genai";
import { createGeminiImageHandler } from "../../services/geminiImageApi.ts";

const handler = createGeminiImageHandler({
  getApiKey: () => Netlify.env.get("GEMINI_API_KEY"),
  generateContent: (parameters, apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    return ai.models.generateContent(parameters);
  },
});

export default handler;
