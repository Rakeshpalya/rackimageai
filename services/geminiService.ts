/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { getGeminiHttpErrorMessage } from "./geminiImageApi";

/**
 * Extracts the decade (e.g., "1950s") from a prompt string.
 * @param prompt The original prompt.
 * @returns The decade string or a fallback if not found.
 */
function extractDecade(prompt: string): string {
    const match = prompt.match(/(\d{4}s)/);
    return match ? match[1] : "1950s";
}

/**
 * Generates a decade-styled image from a source image by proxying the request which passes
 * through our robust, secure backend API endpoint. Keeping API keys hidden and safely operated.
 * @param imageDataUrl A data URL string of the source image (e.g., 'data:image/png;base64,...').
 * @param prompt The prompt containing the decade info.
 * @returns A promise that resolves to a base64-encoded image data URL of the generated image.
 */
export async function generateDecadeImage(imageDataUrl: string, prompt: string): Promise<string> {
    const decade = extractDecade(prompt);

    const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            imageDataUrl,
            decade,
        }),
    });

    let data: { error?: unknown; url?: unknown };
    try {
        data = await response.json() as { error?: unknown; url?: unknown };
    } catch {
        throw new Error(getGeminiHttpErrorMessage(response.status));
    }

    if (!response.ok) {
        const message = typeof data.error === "string"
            ? data.error
            : getGeminiHttpErrorMessage(response.status);
        throw new Error(message);
    }

    if (typeof data.url !== "string" || !data.url.startsWith("data:image/")) {
        throw new Error("No image URL returned from the generation server.");
    }

    return data.url;
}
