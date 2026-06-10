import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ToolFilterConfig {
  services: string;
  tools: string;
  disabledTools: string;
  readOnly?: boolean;
}

export interface ToolFilter {
  services: Set<string> | null;
  tools: string[];
  disabledTools: string[];
  readOnly: boolean;
}

export interface RegisteredToolSummary {
  name: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  inputKeys: string[];
  hasOutputSchema: boolean;
}

export interface ToolRegistry {
  tools: RegisteredToolSummary[];
}

export function createToolRegistry(): ToolRegistry {
  return { tools: [] };
}

export function profileToFilterConfig(profile: string | undefined): ToolFilterConfig | null {
  const normalized = profile?.trim().toLowerCase();
  if (!normalized) return null;

  switch (normalized) {
    case "mail":
      return { services: "mail", tools: "", disabledTools: "", readOnly: false };
    case "files":
      return { services: "kdrive,kpaste", tools: "", disabledTools: "", readOnly: false };
    case "calendar":
      return { services: "calendar,tasks,contacts", tools: "", disabledTools: "", readOnly: false };
    case "assistant":
      return { services: "mail,kdrive,calendar,contacts,tasks,ai,kpaste,chk,kmeet,kchat", tools: "", disabledTools: "", readOnly: false };
    case "safe-cleanup":
      return {
        services: "mail",
        tools: "mail_list_mailboxes,mail_list_folders,mail_query,mail_read_message,mail_find_by_sender,mail_bulk_delete_preview,mail_bulk_delete_confirm,mail_spam_settings,mail_spam_cleanup_preview,mail_spam_cleanup_confirm,mail_filters_list,sender_cleanup_plan,mail_triage_summary",
        disabledTools: "mail_send",
        readOnly: false,
      };
    default:
      return null;
  }
}

export function createToolFilter(config: ToolFilterConfig): ToolFilter {
  const services = parseList(config.services);
  return {
    services: services.length > 0 ? new Set(services.map((service) => service.toLowerCase())) : null,
    tools: parseList(config.tools),
    disabledTools: parseList(config.disabledTools),
    readOnly: config.readOnly === true,
  };
}

export function isServiceEnabled(filter: ToolFilter, service: string): boolean {
  return filter.services === null || filter.services.has(service.toLowerCase());
}

export function shouldRegisterTool(filter: ToolFilter, toolName: string, toolConfig?: unknown): boolean {
  if (matchesAny(toolName, filter.disabledTools)) {
    return false;
  }

  if (filter.readOnly && !isReadOnlyToolConfig(toolConfig)) {
    return false;
  }

  if (filter.tools.length === 0) {
    return true;
  }

  return matchesAny(toolName, filter.tools);
}

export function createToolFilteredServer(server: McpServer, filter: ToolFilter, registry?: ToolRegistry): McpServer {
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "registerTool") {
        return Reflect.get(target, property, receiver);
      }

      return (name: string, config: unknown, callback: unknown) => {
        if (!shouldRegisterTool(filter, name, config)) {
          console.error(`[infomaniak-mcp] Tool disabled by filter: ${name}`);
          return disabledRegistration(name);
        }

        registry?.tools.push(summarizeRegisteredTool(name, config));
        const registerTool = Reflect.get(target, property, receiver) as (toolName: string, toolConfig: unknown, toolCallback: unknown) => unknown;
        return registerTool.call(target, name, config, callback);
      };
    },
  }) as McpServer;
}

function summarizeRegisteredTool(name: string, config: unknown): RegisteredToolSummary {
  const typed = typeof config === "object" && config !== null
    ? config as { description?: unknown; annotations?: unknown; inputSchema?: unknown; outputSchema?: unknown }
    : {};
  const annotations = typeof typed.annotations === "object" && typed.annotations !== null
    ? typed.annotations as { readOnlyHint?: unknown; destructiveHint?: unknown }
    : {};
  return {
    name,
    description: typeof typed.description === "string" ? typed.description : "",
    readOnly: annotations.readOnlyHint === true,
    destructive: annotations.destructiveHint === true,
    inputKeys: summarizeInputKeys(typed),
    hasOutputSchema: hasOwnProperty(typed, "outputSchema"),
  };
}

function summarizeInputKeys(config: { inputSchema?: unknown }): string[] {
  if (!config.inputSchema || typeof config.inputSchema !== "object") {
    return [];
  }
  return Object.keys(config.inputSchema as Record<string, unknown>).sort((left, right) => left.localeCompare(right));
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(value, pattern));
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === value) return true;
  if (!pattern.includes("*")) return false;

  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function isReadOnlyToolConfig(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  const annotations = (config as { annotations?: unknown }).annotations;
  if (!annotations || typeof annotations !== "object") return false;
  const typed = annotations as { readOnlyHint?: unknown; destructiveHint?: unknown };
  return typed.readOnlyHint === true && typed.destructiveHint !== true;
}

function disabledRegistration(name: string) {
  return {
    name,
    enabled: false,
    enable() {},
    disable() {},
    remove() {},
    update() {},
  };
}
