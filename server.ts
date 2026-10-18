/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import express from "express";
import path from "path";
import { createServer as createViteServer, loadEnv } from "vite";
import { GoogleGenAI } from "@google/genai";
import { createGeminiImageHandler } from "./services/geminiImageApi";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const serverEnv = loadEnv(process.env.NODE_ENV || "development", process.cwd(), "");

  // Increase payload limit for base64 image uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  const generateImage = createGeminiImageHandler({
    getApiKey: () => process.env.GEMINI_API_KEY || serverEnv.GEMINI_API_KEY,
    generateContent: (parameters, apiKey) => {
      const ai = new GoogleGenAI({ apiKey });
      return ai.models.generateContent(parameters);
    },
  });

  app.post("/api/generate", async (req, res) => {
    const request = new Request(`http://${req.headers.host || "localhost"}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body ?? null),
    });
    const response = await generateImage(request);
    res.status(response.status).type("application/json").send(await response.text());
  });

  // Vite middleware setup in development, static serve in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Backend] Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer();
