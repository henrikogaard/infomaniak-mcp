import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SwissTransferService } from "../services/swisstransfer.js";
import { jsonResult } from "../tool-handler.js";
import { mutatingTool, objectOutputSchema, readOnlyTool, registerStructuredTool, requireExternalConfirmation, type ToolRegistrationOptions } from "./register.js";

export function registerSwissTransferTools(server: McpServer, st: SwissTransferService, options: ToolRegistrationOptions = {}) {
  registerStructuredTool(
    server,
    "swisstransfer_send",
    "Experimental: send files via Swiss Transfer (encrypted, up to 50GB). Initializes a transfer and uploads files. Returns a download link.",
    {
      files: z.array(z.object({
        name: z.string().describe("Filename"),
        base64_content: z.string().describe("Base64-encoded file content"),
      })).describe("Files to transfer"),
      recaptcha_token: z.string().optional().describe("Experimental: browser-generated reCAPTCHA token from swisstransfer.com"),
      recaptcha_version: z.number().int().optional().describe("Experimental: reCAPTCHA version number used by the site, currently 3"),
      author_email: z.string().optional().describe("Experimental: sender email address if using mail mode"),
      message: z.string().optional().describe("Message to include with the transfer"),
      recipients: z.array(z.string()).optional().describe("Email addresses of recipients"),
      password: z.string().optional().describe("Password to protect the transfer"),
      expiration_days: z.number().optional().describe("Days until expiration (default: 30)"),
      download_limit: z.number().optional().describe("Max number of downloads (0 = unlimited)"),
      confirmation: z.string().optional().describe("Required when STRICT_CONFIRM_EXTERNAL_SEND=1. Exact phrase: CREATE SWISS TRANSFER"),
    },
    mutatingTool,
    async ({ files, recaptcha_token, recaptcha_version, author_email, message, recipients, password, expiration_days, download_limit, confirmation }) => {
      requireExternalConfirmation(options, confirmation, "CREATE SWISS TRANSFER");
      const result = await st.createTransfer({
        files: files.map((f) => ({ name: f.name, base64Content: f.base64_content })),
        recaptchaToken: recaptcha_token,
        recaptchaVersion: recaptcha_version,
        authorEmail: author_email,
        message, recipients, password,
        expirationDays: expiration_days,
        downloadLimit: download_limit,
      });
      return jsonResult(result);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "swisstransfer_info",
    "Experimental: get information about a Swiss Transfer (status, files, download count)",
    {
      transfer_id: z.string().describe("Transfer ID"),
      password: z.string().optional().describe("Password for password-protected transfers"),
    },
    readOnlyTool,
    async ({ transfer_id, password }) => {
      const info = await st.getTransferInfo(transfer_id, password);
      return jsonResult(info);
    },
    objectOutputSchema
  );
}
