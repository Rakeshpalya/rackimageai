import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";

export const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

type GenerateImageHandlerOptions = {
  getApiKey: () => string | undefined;
  generateContent: (
    parameters: GenerateContentParameters,
    apiKey: string,
  ) => Promise<GenerateContentResponse>;
};

type GeminiError = {
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  error?: {
    message?: unknown;
  };
  response?: {
    status?: unknown;
  };
};

function getHttpStatus(error: unknown): number {
  if (typeof error !== "object" || error === null) {
    return 500;
  }

  const details = error as GeminiError;
  const status = details.status ?? details.statusCode ?? details.response?.status;
  return typeof status === "number" && status >= 400 && status <= 599 ? status : 500;
}

function getSanitizedErrorMessage(error: unknown): string {
  const details = typeof error === "object" && error !== null ? (error as GeminiError) : undefined;
  const message = typeof details?.error?.message === "string"
    ? details.error.message
    : error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown Gemini API error";

  return message
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "[image data]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted API key]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(api[_-]?key|authorization)\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function getGeminiHttpErrorMessage(status: number, details = ""): string {
  const suffix = details ? ` Details: ${details}` : "";

  if (status === 400) {
    return `Gemini rejected the image request. Check that the uploaded image and request are valid.${suffix}`;
  }
  if (status === 401) {
    return "Gemini rejected the server API key. Check the GEMINI_API_KEY setting.";
  }
  if (status === 403) {
    return "Gemini denied access. Check the API key's project permissions and model access.";
  }
  if (status === 404) {
    return `The Gemini image model or API endpoint was not found (HTTP ${status}). Check model availability and deployment configuration.${suffix}`;
  }
  if (status === 429) {
    return `Gemini rate limit or quota was reached (HTTP ${status}). Check your quota and try again later.${suffix}`;
  }
  if (status >= 500) {
    return `Gemini is temporarily unavailable (HTTP ${status}). Try again later.${suffix}`;
  }
  return `Image generation failed (HTTP ${status}).${suffix}`;
}

export function buildGeminiImageRequest(
  imageDataUrl: string,
  decade: string,
): GenerateContentParameters {
  const match = imageDataUrl.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    throw new Error("Invalid image format. Upload a valid base64 image data URL.");
  }

  const [, mimeType, base64Data] = match;
  const prompt = `Reimagine the person in this photo in the style of the ${decade}. This includes clothing, hairstyle, photo quality, and the overall aesthetic of that decade. The output must be a photorealistic image showing the person clearly.`;

  return {
    model: GEMINI_IMAGE_MODEL,
    contents: {
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: prompt },
      ],
    },
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };
}

export function createGeminiImageHandler(options: GenerateImageHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { imageDataUrl, decade } = body as Record<string, unknown>;
    if (typeof imageDataUrl !== "string" || imageDataUrl.length === 0) {
      return Response.json({ error: "No image source uploaded." }, { status: 400 });
    }
    if (typeof decade !== "string" || decade.length === 0) {
      return Response.json({ error: "No decade specified." }, { status: 400 });
    }

    let parameters: GenerateContentParameters;
    try {
      parameters = buildGeminiImageRequest(imageDataUrl, decade);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid image format.";
      return Response.json({ error: message }, { status: 400 });
    }

    const apiKey = options.getApiKey();
    if (!apiKey) {
      return Response.json(
        { error: "API key is not configured. Set GEMINI_API_KEY in the server environment." },
        { status: 503 },
      );
    }

    try {
      const response = await options.generateContent(parameters, apiKey);
      const imagePart = response.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .find((part) => part.inlineData?.data && part.inlineData.mimeType);

      if (!imagePart?.inlineData) {
        const error = "Gemini returned no image content.";
        console.error("[Gemini] Image generation failed", {
          status: 200,
          model: GEMINI_IMAGE_MODEL,
          message: error,
        });
        return Response.json(
          { error: "Gemini did not return an image. Try again with a different photo or prompt." },
          { status: 502 },
        );
      }

      const { mimeType, data } = imagePart.inlineData;
      return Response.json({ url: `data:${mimeType};base64,${data}` });
    } catch (error) {
      const status = getHttpStatus(error);
      const message = getSanitizedErrorMessage(error);
      console.error("[Gemini] Image generation failed", {
        status,
        model: GEMINI_IMAGE_MODEL,
        message,
      });
      return Response.json(
        { error: getGeminiHttpErrorMessage(status, message) },
        { status },
      );
    }
  };
}
