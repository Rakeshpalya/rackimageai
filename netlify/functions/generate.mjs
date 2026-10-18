import { GoogleGenAI } from "@google/genai";

export default async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const { imageDataUrl, decade } = body ?? {};
  if (typeof imageDataUrl !== "string" || !imageDataUrl) {
    return Response.json({ error: "No image source uploaded." }, { status: 400 });
  }
  if (typeof decade !== "string" || !decade) {
    return Response.json({ error: "No decade specified." }, { status: 400 });
  }

  const apiKey = Netlify.env.get("GEMINI_API_KEY") || Netlify.env.get("API_KEY");
  if (!apiKey) {
    return Response.json(
      { error: "API key is not configured. Set GEMINI_API_KEY in your Netlify site environment variables." },
      { status: 503 },
    );
  }

  const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!match) {
    return Response.json(
      { error: "Invalid image format. Must be a valid image Data URL." },
      { status: 400 },
    );
  }

  const [, mimeType, base64Data] = match;
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
  const imagePart = { inlineData: { mimeType, data: base64Data } };
  const prompts = [
    `Reimagine the person in this photo in the style of the ${decade}. This includes clothing, hairstyle, photo quality, and the overall aesthetic of that decade. The output must be a photorealistic image showing the person clearly.`,
    `Create a photograph of the person in this image as if they were living in the ${decade}. The photograph should capture the distinct fashion, hairstyles, and overall atmosphere of that time period. Ensure the final image is a clear photograph that looks authentic to the era.`,
  ];

  const callGeminiWithRetry = async (prompt) => {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: { parts: [imagePart, { text: prompt }] },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Netlify Function] Gemini request failed (attempt ${attempt}/${maxRetries}):`, error);
        const isAuthOrValidationIssue = [
          "API_KEY_INVALID",
          "INVALID_ARGUMENT",
          "PERMISSION_DENIED",
        ].some((code) => message.includes(code));

        if (isAuthOrValidationIssue || attempt === maxRetries) {
          throw error;
        }

        const delay = 1000 * 2.5 ** (attempt - 1) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error("Gemini API call failed after retries.");
  };

  for (let index = 0; index < prompts.length; index++) {
    try {
      const response = await callGeminiWithRetry(prompts[index]);
      const outputImage = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
      if (outputImage?.inlineData) {
        const { mimeType: outputMimeType, data } = outputImage.inlineData;
        return Response.json({ url: `data:${outputMimeType};base64,${data}` });
      }

      const text = response.text || "";
      console.error("[Netlify Function] API returned text instead of an image:", text);
      throw new Error(`Model returned text: "${text.substring(0, 100)}..."`);
    } catch (error) {
      console.error(`[Netlify Function] Prompt ${index + 1} failed for ${decade}:`, error);
      if (index === prompts.length - 1) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return Response.json(
          { error: `Failed to generate image. Details: ${message}` },
          { status: 500 },
        );
      }
    }
  }

  return Response.json({ error: "Failed to generate image." }, { status: 500 });
};
