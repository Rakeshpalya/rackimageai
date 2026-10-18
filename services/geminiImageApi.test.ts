import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleGenAI } from "@google/genai";
import {
  buildGeminiImageRequest,
  createGeminiImageHandler,
  GEMINI_IMAGE_MODEL,
  getGeminiHttpErrorMessage,
} from "./geminiImageApi";

const imageDataUrl = "data:image/jpeg;base64,YWJj";
const decade = "1950s";

function createRequest(body: unknown): Request {
  return new Request("https://example.test/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("builds the Gemini image-edit request with explicit image output modality", () => {
  const request = buildGeminiImageRequest(imageDataUrl, decade);
  const contents = request.contents as { parts: Array<Record<string, unknown>> };

  assert.equal(request.model, GEMINI_IMAGE_MODEL);
  assert.deepEqual(request.config?.responseModalities, ["TEXT", "IMAGE"]);
  assert.deepEqual(contents.parts[0], {
    inlineData: { mimeType: "image/jpeg", data: "YWJj" },
  });
  assert.match(String(contents.parts[1].text), /1950s/);
});

test("the installed SDK serializes the verified image-generation endpoint and payload", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl: URL | undefined;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = new URL(String(input));
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType: "image/png", data: "Z2VuZXJhdGVk" } }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const ai = new GoogleGenAI({ apiKey: "test-only-not-a-real-key" });
    const response = await ai.models.generateContent(
      buildGeminiImageRequest(imageDataUrl, decade),
    );
    const requestContents = requestBody?.contents as Array<{
      parts: Array<Record<string, unknown>>;
    }>;
    const requestConfig = requestBody?.generationConfig as {
      responseModalities: string[];
    };

    assert.equal(requestUrl?.pathname, `/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`);
    assert.deepEqual(requestConfig.responseModalities, ["TEXT", "IMAGE"]);
    assert.equal(requestContents[0].parts[0].inlineData !== undefined, true);
    assert.equal(Boolean(response.candidates?.[0]?.content?.parts?.[0]?.inlineData), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns generated image data from the Gemini response", async () => {
  let requestModel: string | undefined;
  let requestModalities: string[] | undefined;
  const handler = createGeminiImageHandler({
    getApiKey: () => "server-only-test-key",
    generateContent: async (parameters) => {
      requestModel = parameters.model;
      requestModalities = parameters.config?.responseModalities;
      return {
        candidates: [{
          content: {
            parts: [{ inlineData: { mimeType: "image/png", data: "Z2VuZXJhdGVk" } }],
          },
        }],
      };
    },
  });

  const response = await handler(createRequest({ imageDataUrl, decade }));
  const result = await response.json() as { url?: string };

  assert.equal(response.status, 200);
  assert.equal(requestModel, GEMINI_IMAGE_MODEL);
  assert.deepEqual(requestModalities, ["TEXT", "IMAGE"]);
  assert.equal(result.url, "data:image/png;base64,Z2VuZXJhdGVk");
});

test("returns useful upstream errors without retrying invalid or quota requests", async () => {
  for (const [status, expectedText] of [
    [400, "rejected the image request"],
    [401, "rejected the server api key"],
    [403, "denied access"],
    [404, "not found"],
    [429, "rate limit or quota"],
    [503, "temporarily unavailable"],
  ] as const) {
    let callCount = 0;
    const logOutput: string[] = [];
    const handler = createGeminiImageHandler({
      getApiKey: () => "server-only-test-key",
      generateContent: async () => {
        callCount++;
        throw Object.assign(new Error("upstream error"), {
          status,
          error: { message: `Failure with data:image/jpeg;base64,YWJj and API_KEY=secret` },
        });
      },
    });
    const originalConsoleError = console.error;
    console.error = (...values) => logOutput.push(
      values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" "),
    );

    try {
      const response = await handler(createRequest({ imageDataUrl, decade }));
      const result = await response.json() as { error: string };

      assert.equal(response.status, status);
      assert.match(result.error.toLowerCase(), new RegExp(expectedText));
      assert.equal(callCount, 1);
      assert.equal(result.error.includes("YWJj"), false);
      assert.equal(result.error.includes("secret"), false);
      assert.equal(logOutput.join(" ").includes("YWJj"), false);
      assert.equal(logOutput.join(" ").includes("secret"), false);
      assert.match(logOutput.join(" "), new RegExp(`status.*${status}`));
      assert.match(logOutput.join(" "), new RegExp(GEMINI_IMAGE_MODEL));
    } finally {
      console.error = originalConsoleError;
    }
  }
});

test("maps non-JSON HTTP failures to actionable messages", () => {
  assert.match(getGeminiHttpErrorMessage(400), /request are valid/);
  assert.match(getGeminiHttpErrorMessage(401), /GEMINI_API_KEY/);
  assert.match(getGeminiHttpErrorMessage(403), /permissions/);
  assert.match(getGeminiHttpErrorMessage(404), /not found/);
  assert.match(getGeminiHttpErrorMessage(429), /quota/);
  assert.match(getGeminiHttpErrorMessage(503), /Try again later/);
});

test("rejects malformed image data before calling Gemini", async () => {
  let called = false;
  const handler = createGeminiImageHandler({
    getApiKey: () => "server-only-test-key",
    generateContent: async () => {
      called = true;
      return {};
    },
  });

  const response = await handler(createRequest({ imageDataUrl: "not-an-image", decade }));
  const result = await response.json() as { error: string };

  assert.equal(response.status, 400);
  assert.match(result.error, /valid base64 image data URL/);
  assert.equal(called, false);
});
