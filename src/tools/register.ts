import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeHandler, type ToolResult } from "../tool-handler.js";

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolInputSchema = Record<string, z.ZodTypeAny>;
export type ToolOutputSchema = ToolInputSchema | z.ZodTypeAny;
export interface ToolRegistrationOptions {
  strictExternalSend?: boolean;
}

export const readOnlyTool: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
};

export const mutatingTool: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};

export const destructiveTool: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
};

export const arrayOutputSchema = {
  data: z.array(z.unknown()),
};

export const objectOutputSchema = z.object({}).passthrough();

export const textOutputSchema = {
  message: z.string(),
};

export function registerStructuredTool<T extends ToolInputSchema>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: T,
  annotations: ToolAnnotations,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<ToolResult>,
  outputSchema: ToolOutputSchema = objectOutputSchema
): void {
  server.registerTool(
    name,
    { description, inputSchema, outputSchema, annotations },
    safeHandler(handler as never, { name, annotations }) as never
  );
}

export function requireConfirmation(actual: string | undefined, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Confirmation must exactly equal: ${expected}`);
  }
}

export function requireExternalConfirmation(
  options: ToolRegistrationOptions | undefined,
  actual: string | undefined,
  expected: string
): void {
  if (!options?.strictExternalSend) return;
  requireConfirmation(actual, expected);
}
