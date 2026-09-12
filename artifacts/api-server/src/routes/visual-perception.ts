import { Router, type IRouter } from "express";
import { ProcessVisualContextBody, ProcessVisualContextResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LIVE_MODEL = process.env.VLM_MODEL || "gpt-4o-mini";
const DEMO_MODEL = "local-demo";

type ProcessingMode = "demo" | "live";

type ImagePayload = {
  dataUrl: string;
  bytes: Buffer;
};

function decodeImage(input: string): ImagePayload {
  const trimmed = input.trim();
  const match = trimmed.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  const encoded = (match?.[2] ?? trimmed).replace(/\s/g, "");

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error("Invalid Base64 image");
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(bytes.length > MAX_IMAGE_BYTES ? "Image payload is too large" : "Invalid Base64 image");
  }

  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  const isGif = bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a";
  const isWebp = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";

  if (!isPng && !isJpeg && !isGif && !isWebp) {
    throw new Error("Unsupported image format");
  }

  const detectedMime = isPng ? "image/png" : isJpeg ? "image/jpeg" : isGif ? "image/gif" : "image/webp";
  return {
    bytes,
    dataUrl: `data:${detectedMime};base64,${bytes.toString("base64")}`,
  };
}

function parseModelCommands(content: string) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  const result = ProcessVisualContextResponse.safeParse({
    success: true,
    commands: parsed,
    model: LIVE_MODEL,
    source: "live",
    error: null,
  });

  if (result.success) {
    return result.data.commands;
  }

  const commands = typeof parsed === "object" && parsed !== null && "commands" in parsed
    ? (parsed as { commands?: unknown }).commands
    : undefined;
  const retry = ProcessVisualContextResponse.safeParse({
    success: true,
    commands,
    model: LIVE_MODEL,
    source: "live",
    error: null,
  });

  if (!retry.success) {
    throw new Error("Vision model returned invalid commands");
  }

  return retry.data.commands;
}

function buildDemoCommands(taskPrompt: string) {
  const task = taskPrompt.toLowerCase();

  if (task.includes("scroll")) {
    return [
      {
        action: "scroll" as const,
        direction: "down" as const,
        amount: 480,
        confidence: 0.94,
      },
    ];
  }

  if (task.includes("type") || task.includes("search")) {
    return [
      {
        action: "click" as const,
        target: "visible text field",
        confidence: 0.9,
      },
      {
        action: "type" as const,
        target: "visible text field",
        text: "demo input",
        confidence: 0.86,
      },
    ];
  }

  return [
    {
      action: "click" as const,
      target: "primary visible action",
      confidence: 0.88,
    },
    {
      action: "wait" as const,
      milliseconds: 500,
      confidence: 0.98,
    },
  ];
}

async function analyzeWithVisionModel(image: ImagePayload, taskPrompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Vision model is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LIVE_MODEL,
      response_format: { type: "json_object" },
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: [
            "You are a privacy-first browser perception model.",
            "The image is pre-redacted and must be used only to locate visible UI controls for the requested task.",
            "Never invent or reveal personal information. Return JSON only.",
            "Return an object with a commands array. Each command must use exactly one allowed action: click, type, scroll, keypress, select, wait, navigate.",
            "Use x and y only for click targets. Use text for type, direction and amount for scroll, key for keypress, value for select, milliseconds for wait, and url for navigate.",
            "Every command must include a confidence number from 0 to 1. If the task cannot be completed from the image, return an empty commands array.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Task: ${taskPrompt}` },
            { type: "image_url", image_url: { url: image.dataUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision model processing failed (provider response ${response.status})`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Vision model returned no commands");
  }

  return parseModelCommands(content);
}

router.post("/process-visual-context", async (req, res) => {
  const parsedBody = ProcessVisualContextBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ success: false, error: "image_base64 and task_prompt are required" });
    return;
  }

  try {
    const image = decodeImage(parsedBody.data.image_base64);
    const mode: ProcessingMode = parsedBody.data.mode ?? "live";
    const commands = mode === "demo"
      ? buildDemoCommands(parsedBody.data.task_prompt)
      : await analyzeWithVisionModel(image, parsedBody.data.task_prompt);
    const result = ProcessVisualContextResponse.parse({
      success: true,
      commands,
      model: mode === "demo" ? DEMO_MODEL : LIVE_MODEL,
      source: mode,
      error: null,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Visual processing failed";
    const status = message.includes("Invalid") || message.includes("Unsupported") || message.includes("too large")
      ? 400
      : 502;
    req.log.warn({ status, reason: message }, "Visual perception request failed");
    const mode = parsedBody.data.mode ?? "live";
    res.status(status).json({
      success: false,
      error: message,
      commands: [],
      model: mode === "demo" ? DEMO_MODEL : LIVE_MODEL,
      source: mode,
    });
  }
});

export default router;