import type { Config } from "../config.js";
import { InfomaniakAPI } from "./infomaniak-api.js";

interface ApiResponse {
  data?: unknown;
}

interface AIModel {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens: number; total_tokens: number };
}

export class AIService {
  private api: InfomaniakAPI;
  private productId: string;
  private token: string;

  constructor(config: Config) {
    this.api = new InfomaniakAPI(config);
    this.productId = config.aiProductId;
    this.token = config.infomaniakToken;
  }

  async listModels(): Promise<AIModel[]> {
    const res = (await this.api.get("/1/ai/models")) as ApiResponse;
    return (res.data ?? []) as AIModel[];
  }

  async chatCompletion(params: {
    model?: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<ChatCompletionResponse> {
    const body: Record<string, unknown> = {
      messages: params.messages,
    };
    if (params.model) body.model = params.model;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens) body.max_tokens = params.maxTokens;

    const res = await this.api.post(
      `/1/ai/${this.productId}/openai/chat/completions`,
      body
    );
    return res as ChatCompletionResponse;
  }

  async generateEmbeddings(params: {
    input: string | string[];
    model?: string;
  }): Promise<EmbeddingResponse> {
    const body: Record<string, unknown> = {
      input: params.input,
    };
    if (params.model) body.model = params.model;

    const res = await this.api.post(
      `/1/ai/${this.productId}/openai/v1/embeddings`,
      body
    );
    return res as EmbeddingResponse;
  }

  async transcribeAudio(audioBase64: string, filename: string): Promise<string> {
    // Audio transcription uses multipart/form-data, so we need a custom request
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const boundary = `----FormBoundary${Date.now()}`;

    const parts: Buffer[] = [];

    // Add the file part
    const fileHeader = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: application/octet-stream`,
      "",
      "",
    ].join("\r\n");
    parts.push(Buffer.from(fileHeader));
    parts.push(audioBuffer);
    parts.push(Buffer.from("\r\n"));

    // Add model part
    const modelPart = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="model"`,
      "",
      "faster-whisper-large-v3-turbo",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    parts.push(Buffer.from(modelPart));

    const body = Buffer.concat(parts);

    const url = `https://api.infomaniak.com/1/ai/${this.productId}/openai/audio/transcriptions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`AI transcription ${res.status}: ${await res.text()}`);
    }

    const result = (await res.json()) as { text: string };
    return result.text;
  }
}
