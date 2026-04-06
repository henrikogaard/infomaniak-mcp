/**
 * Wraps an MCP tool handler with error handling.
 * Returns { isError: true } with the error message instead of crashing.
 */
type ToolContent = Array<{ type: "text"; text: string }>;
type ToolResult = { content: ToolContent; isError?: boolean };

export function safeHandler<T>(
  handler: (args: T) => Promise<ToolResult>
): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    try {
      return await handler(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${message}` }],
      };
    }
  };
}

/** Helper to create a text content response */
export function textResult(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }] };
}

export function jsonResult(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2));
}
