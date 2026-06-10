import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KPasteService } from "../services/kpaste.js";
import { structuredResult, withUntrustedContent } from "../tool-handler.js";
import { destructiveTool, mutatingTool, registerStructuredTool, requireConfirmation } from "./register.js";

export function registerKPasteTools(server: McpServer, kpaste: KPasteService) {
  registerStructuredTool(
    server,
    "kpaste_create",
    "Create an encrypted, ephemeral paste on kPaste (zero-knowledge, AES-256-GCM). Returns a URL with the decryption key in the fragment; only use with a trusted transcript and MCP client.",
    {
      content: z.string().describe("The text/secret to share"),
      expiration: z
        .enum(["5min", "1hour", "1day", "1week", "1month"])
        .optional()
        .describe("When the paste expires (default: 1day)"),
      burn_after_reading: z
        .boolean()
        .optional()
        .describe("Auto-delete after first read (default: false)"),
      password: z
        .string()
        .optional()
        .describe("Optional extra paste password. Treat it as transcript-visible secret material; prefer sharing it through a different channel."),
    },
    mutatingTool,
    async ({ content, expiration, burn_after_reading, password }) => {
      const result = await kpaste.createPaste({
        content,
        expiration,
        burnAfterReading: burn_after_reading,
        password,
      });
      return structuredResult(
        { id: result.id, url: result.url },
        `Encrypted paste created.\n\nURL: ${result.url}\nID: ${result.id}\n\nTreat the full URL as a secret: the decryption key is in the URL fragment (#), and this MCP transcript now contains it.`
      );
    },
    {
      id: z.string(),
      url: z.string(),
    }
  );

  registerStructuredTool(
    server,
    "kpaste_read",
    "Read and decrypt a kPaste URL using the fragment key. This is marked destructive because burn-after-reading pastes may be consumed by the read. Requires exact confirmation: ACKNOWLEDGE KPASTE READ RISK.",
    {
      url: z.string().describe("Full kPaste URL including the # fragment decryption key"),
      password: z.string().optional().describe("Optional paste password when the paste is password-protected"),
      confirmation: z.string().describe("Exact confirmation phrase: ACKNOWLEDGE KPASTE READ RISK"),
    },
    destructiveTool,
    async ({ url, password, confirmation }) => {
      requireConfirmation(confirmation, "ACKNOWLEDGE KPASTE READ RISK");
      const result = await kpaste.readPaste({ url, password });
      return withUntrustedContent(structuredResult(
        result as unknown as Record<string, unknown>,
        `kPaste decrypted.\n\nID: ${result.id}\nBurn-after-reading: ${result.burnAfterReading ? "yes" : "no"}\nPassword-protected: ${result.passwordProtected ? "yes" : "no"}\n\n${result.content}`
      ), "kpaste", ["content"]);
    },
    {
      id: z.string(),
      content: z.string(),
      burnAfterReading: z.boolean(),
      passwordProtected: z.boolean(),
      expiresAt: z.string().optional(),
    }
  );
}
