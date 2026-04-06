import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AIService } from "../services/ai.js";
import { safeHandler, textResult, jsonResult } from "../tool-handler.js";

export function registerAITools(server: McpServer, ai: AIService) {
  server.tool(
    "ai_list_models",
    "List available AI models on Infomaniak AI Tools (Euria)",
    {},
    safeHandler(async () => {
      const models = await ai.listModels();
      return jsonResult(models);
    })
  );

  server.tool(
    "ai_chat",
    "Send a chat completion request to Infomaniak AI (Euria). Useful for summarization, translation, text processing using sovereign Swiss AI. All processing stays in Swiss data centers.",
    {
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]).describe("Message role"),
        content: z.string().describe("Message content"),
      })).describe("Chat messages"),
      model: z.string().optional().describe("Model name (e.g. llama3, mistral, mixtral)"),
      temperature: z.number().optional().describe("Temperature (0-1)"),
      max_tokens: z.number().optional().describe("Max tokens to generate"),
    },
    safeHandler(async ({ messages, model, temperature, max_tokens }) => {
      const result = await ai.chatCompletion({
        messages, model, temperature, maxTokens: max_tokens,
      });
      const reply = result.choices?.[0]?.message?.content ?? "(no response)";
      const usage = result.usage
        ? `\n\n[Tokens: ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total]`
        : "";
      return textResult(reply + usage);
    })
  );

  server.tool(
    "ai_embeddings",
    "Generate vector embeddings using Infomaniak AI. Useful for semantic search across emails, files, and contacts.",
    {
      input: z.union([
        z.string().describe("Single text to embed"),
        z.array(z.string()).describe("Multiple texts to embed"),
      ]).describe("Text(s) to generate embeddings for"),
      model: z.string().optional().describe("Embedding model name"),
    },
    safeHandler(async ({ input, model }) => {
      const result = await ai.generateEmbeddings({ input, model });
      return jsonResult(result);
    })
  );

  server.tool(
    "ai_transcribe",
    "Transcribe audio to text using Infomaniak AI (Whisper). Pass base64-encoded audio content. Works with files downloaded from kDrive via kdrive_download_file.",
    {
      audio_base64: z.string().describe("Base64-encoded audio file content"),
      filename: z.string().describe("Original filename (e.g. meeting.mp3, voicemail.wav)"),
    },
    safeHandler(async ({ audio_base64, filename }) => {
      const text = await ai.transcribeAudio(audio_base64, filename);
      return { content: [{ type: "text", text }] };
    })
  );
}
