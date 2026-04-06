#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(scriptDir, "..");
loadDotenv({ path: resolve(repoRoot, ".env"), override: false });

const serverPath = process.env.MCP_SERVER_PATH ?? resolve(repoRoot, "dist/index.js");
const mode = process.env.SMOKE_MODE ?? "full";

const rawServerEnv = {
  INFOMANIAK_TOKEN: process.env.INFOMANIAK_TOKEN ?? "",
  KDRIVE_ID: process.env.KDRIVE_ID ?? "",
  AI_PRODUCT_ID: process.env.AI_PRODUCT_ID ?? "",
  ENABLE_EXPERIMENTAL_SWISSTRANSFER: process.env.ENABLE_EXPERIMENTAL_SWISSTRANSFER ?? "",
  MAIL_USER: process.env.MAIL_USER ?? "",
  MAIL_PASSWORD: process.env.MAIL_PASSWORD ?? "",
  DAV_USER: process.env.DAV_USER ?? "",
  DAV_PASSWORD: process.env.DAV_PASSWORD ?? "",
  IMAP_HOST: process.env.IMAP_HOST ?? "",
  IMAP_PORT: process.env.IMAP_PORT ?? "",
  SMTP_HOST: process.env.SMTP_HOST ?? "",
  SMTP_PORT: process.env.SMTP_PORT ?? "",
  CARDDAV_URL: process.env.CARDDAV_URL ?? "",
  CALDAV_URL: process.env.CALDAV_URL ?? "",
};

const serverEnv = Object.fromEntries(
  Object.entries(rawServerEnv).filter(([, value]) => value !== "")
);

const swissTransferEnabled = ["1", "true", "yes", "on"].includes(
  (process.env.ENABLE_EXPERIMENTAL_SWISSTRANSFER ?? "").trim().toLowerCase()
);
const swissTransferRecaptchaToken = process.env.SWISSTRANSFER_RECAPTCHA_TOKEN ?? "";

const expectedTools = [
  "kdrive_search",
  "kdrive_list_files",
  "kdrive_get_file",
  "kdrive_download_file",
  "kdrive_upload_file",
  "kdrive_create_folder",
  "kdrive_delete",
  "kdrive_move",
  "kdrive_rename",
  "calendar_list_calendars",
  "calendar_list_events",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
  "mail_list_folders",
  "mail_list_messages",
  "mail_read_message",
  "mail_search",
  "mail_send",
  "mail_move",
  "mail_delete",
  "mail_flag",
  "contacts_list_address_books",
  "contacts_list",
  "contacts_search",
  "contacts_get",
  "contacts_create",
  "contacts_update",
  "contacts_delete",
  "kmeet_create_room",
  "kmeet_schedule_room",
  "chk_create_short_url",
  "chk_list_short_urls",
  "chk_delete_short_url",
  "kpaste_create",
];

if (swissTransferEnabled) {
  expectedTools.push("swisstransfer_send", "swisstransfer_info");
}

const optionalTools = [
  "ai_list_models",
  "ai_chat",
  "ai_embeddings",
  "ai_transcribe",
];

function nowIsoCompact() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function parseTextContent(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function parseJsonContent(result) {
  const text = parseTextContent(result);
  return JSON.parse(text);
}

function summarize(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

async function createClient() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: serverEnv,
    stderr: "pipe",
  });

  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

  const client = new Client({
    name: "infomaniak-live-smoke",
    version: "1.0.0",
  });

  client.onerror = (error) => {
    stderrChunks.push(`\n[client-error] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  };

  await client.connect(transport);
  return {
    client,
    transport,
    getStderr: () => stderrChunks.join(""),
  };
}

async function callTool(client, name, args = {}) {
  const result = await client.request(
    {
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
    CallToolResultSchema
  );

  if (result.isError) {
    throw new Error(parseTextContent(result) || `Tool ${name} returned isError`);
  }

  return result;
}

const results = [];

async function runCheck(name, fn, options = {}) {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? 30000;
  console.error(`[smoke] starting ${name}`);
  try {
    const details = await withTimeout(fn(), timeoutMs, name);
    results.push({
      name,
      status: "passed",
      durationMs: Date.now() - start,
      details: summarize(details),
      cleanup: options.cleanup ?? "n/a",
    });
    console.error(`[smoke] passed ${name}`);
    return details;
  } catch (error) {
    results.push({
      name,
      status: options.optional ? "skipped" : "failed",
      durationMs: Date.now() - start,
      details: error instanceof Error ? error.message : String(error),
      cleanup: options.cleanup ?? "n/a",
    });
    console.error(`[smoke] ${options.optional ? "skipped" : "failed"} ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main() {
  const { client, transport, getStderr } = await createClient();
  const temp = {
    kdriveFolders: [],
    kdriveFiles: [],
    calendarEventId: null,
    contactUrl: null,
    chkId: null,
    swissTransferId: null,
    mailSubject: `infomaniak-mcp smoke ${nowIsoCompact()} ${randomUUID().slice(0, 8)}`,
    mailUid: null,
    mailFolder: "INBOX",
    kmeetEventId: null,
  };

  try {
    const toolsResult = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
    const availableTools = new Set(toolsResult.tools.map((tool) => tool.name));

    await runCheck("tools/list", async () => ({
      count: toolsResult.tools.length,
      missingRequired: expectedTools.filter((tool) => !availableTools.has(tool)),
      missingOptional: optionalTools.filter((tool) => !availableTools.has(tool)),
    }));

    const privateRoot = await runCheck("kdrive_list_files(root)", async () => {
      const data = parseJsonContent(await callTool(client, "kdrive_list_files", {}));
      return data.slice(0, 5);
    });

    let privateFolder = null;
    if (Array.isArray(privateRoot)) {
      privateFolder = privateRoot.find((entry) => entry.name === "Private") ?? privateRoot[0] ?? null;
    }

    const kdriveSearch = await runCheck("kdrive_search", async () => {
      const data = parseJsonContent(await callTool(client, "kdrive_search", { query: "test", limit: 10 }));
      return data.slice(0, 4);
    });

    const sampleFile =
      Array.isArray(kdriveSearch) ? kdriveSearch.find((entry) => entry.type === "file" && Number(entry.size ?? 0) < 1024 * 1024) : null;

    if (sampleFile) {
      await runCheck("kdrive_get_file", async () => {
        const data = parseJsonContent(await callTool(client, "kdrive_get_file", { file_id: sampleFile.id }));
        return { id: data.id, name: data.name, size: data.size };
      });

      await runCheck("kdrive_download_file", async () => {
        const text = parseTextContent(await callTool(client, "kdrive_download_file", { file_id: sampleFile.id }));
        return text.slice(0, 120);
      });
    }

    let uploadedFileId = null;
    let movedFolderId = null;
    if (mode === "full" && privateFolder) {
      const folderA = await runCheck("kdrive_create_folder", async () => {
        const data = parseJsonContent(await callTool(client, "kdrive_create_folder", {
          parent_id: privateFolder.id,
          name: `mcp-smoke-${randomUUID().slice(0, 8)}`,
        }));
        temp.kdriveFolders.push(data.id);
        return { id: data.id, name: data.name };
      }, { cleanup: "delete" });

      const folderB = await runCheck("kdrive_create_folder(second)", async () => {
        const data = parseJsonContent(await callTool(client, "kdrive_create_folder", {
          parent_id: privateFolder.id,
          name: `mcp-smoke-dst-${randomUUID().slice(0, 8)}`,
        }));
        temp.kdriveFolders.push(data.id);
        return { id: data.id, name: data.name };
      }, { cleanup: "delete" });

      movedFolderId = folderB?.id ?? null;

      if (folderA) {
        const uploadPayload = Buffer.from(`infomaniak smoke ${temp.mailSubject}`, "utf8").toString("base64");
        const uploaded = await runCheck("kdrive_upload_file", async () => {
          const data = parseJsonContent(await callTool(client, "kdrive_upload_file", {
            folder_id: folderA.id,
            filename: "smoke-test.txt",
            base64_content: uploadPayload,
          }));
          temp.kdriveFiles.push(data.id);
          uploadedFileId = data.id;
          return { id: data.id, name: data.name, size: data.size };
        }, { cleanup: "delete" });

        if (uploaded) {
          await runCheck("kdrive_rename", async () => {
            const data = parseJsonContent(await callTool(client, "kdrive_rename", {
              file_id: uploaded.id,
              name: "smoke-test-renamed.txt",
            }));
            return { id: data.id, name: data.name };
          });

          if (movedFolderId) {
            await runCheck("kdrive_move", async () => {
              const data = parseJsonContent(await callTool(client, "kdrive_move", {
                file_id: uploaded.id,
                destination_folder_id: movedFolderId,
              }));
              return { id: data.id, parent_id: data.parent_id };
            });
          }
        }
      }
    }

    const calendars = await runCheck("calendar_list_calendars", async () => {
      const data = parseJsonContent(await callTool(client, "calendar_list_calendars", {}));
      return data.slice(0, 5);
    });

    const calendar = Array.isArray(calendars) ? calendars[0] ?? null : null;
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const startIso = start.toISOString().slice(0, 16);
    const endIso = end.toISOString().slice(0, 16);

    await runCheck("calendar_list_events", async () => {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const data = parseJsonContent(await callTool(client, "calendar_list_events", {
        from,
        to,
        calendar_id: calendar ? String(calendar.id) : undefined,
      }));
      return { count: data.length };
    });

    if (mode === "full" && calendar) {
      const createdEvent = await runCheck("calendar_create_event", async () => {
        const data = parseJsonContent(await callTool(client, "calendar_create_event", {
          title: `MCP Smoke ${temp.mailSubject}`,
          start: startIso,
          end: endIso,
          description: "Temporary event created by live smoke test",
          calendar_id: String(calendar.id),
        }));
        temp.calendarEventId = data.id;
        return { id: data.id, title: data.title };
      }, { cleanup: "delete" });

      if (createdEvent) {
        await runCheck("calendar_update_event", async () => {
          const data = parseJsonContent(await callTool(client, "calendar_update_event", {
            event_id: String(createdEvent.id),
            description: "Temporary event updated by live smoke test",
          }));
          return { id: data.id, description: data.description };
        }, { cleanup: "delete" });
      }
    }

    await runCheck("mail_list_folders", async () => {
      const data = parseJsonContent(await callTool(client, "mail_list_folders", {}));
      return data.slice(0, 6);
    });

    const inboxMessages = await runCheck("mail_list_messages", async () => {
      const data = parseJsonContent(await callTool(client, "mail_list_messages", { folder: "INBOX", limit: 5, page: 1 }));
      return { total: data.total, sample: data.messages.slice(0, 3) };
    });

    const firstInboxUid = inboxMessages?.sample?.[0]?.uid;
    if (firstInboxUid) {
      await runCheck("mail_read_message", async () => {
        const text = parseTextContent(await callTool(client, "mail_read_message", { folder: "INBOX", uid: firstInboxUid }));
        return text.slice(0, 180);
      });

      await runCheck("mail_search(existing)", async () => {
        const subject = inboxMessages.sample[0]?.subject?.split(" ").slice(0, 2).join(" ");
        const data = parseJsonContent(await callTool(client, "mail_search", { folder: "INBOX", query: subject, limit: 5 }));
        return data.slice(0, 3);
      });
    }

    if (mode === "full") {
      await runCheck("mail_send", async () => {
        const text = parseTextContent(await callTool(client, "mail_send", {
          to: [serverEnv.MAIL_USER],
          subject: temp.mailSubject,
          text: `Smoke test message ${temp.mailSubject}`,
        }));
        return text;
      }, { cleanup: "move to Trash then delete" });

      const delivered = await runCheck("mail_search(sent copy)", async () => {
        for (let attempt = 1; attempt <= 12; attempt += 1) {
          const data = parseJsonContent(await callTool(client, "mail_list_messages", {
            folder: "Sent",
            limit: 20,
            page: 1,
          }));
          const match = data.messages.find((message) => message.subject === temp.mailSubject);
          if (match) {
            temp.mailUid = match.uid;
            temp.mailFolder = "Sent";
            return { attempts: attempt, match };
          }
          await sleep(3000);
        }
        throw new Error("Sent smoke email did not appear in Sent within 36s");
      }, { cleanup: "move to Trash then delete", timeoutMs: 45000, optional: true });

      if (delivered && temp.mailUid) {
        await runCheck("mail_flag(add)", async () => {
          const text = parseTextContent(await callTool(client, "mail_flag", {
            folder: "INBOX",
            uid: temp.mailUid,
            flags: ["\\Flagged"],
            action: "add",
          }));
          return text;
        }, { cleanup: "remove flag" });

        await runCheck("mail_flag(remove)", async () => {
          const text = parseTextContent(await callTool(client, "mail_flag", {
            folder: "INBOX",
            uid: temp.mailUid,
            flags: ["\\Flagged"],
            action: "remove",
          }));
          return text;
        });

        await runCheck("mail_move", async () => {
          const text = parseTextContent(await callTool(client, "mail_move", {
            folder: "INBOX",
            uid: temp.mailUid,
            destination: "Trash",
          }));
          temp.mailFolder = "Trash";
          return text;
        }, { cleanup: "delete from Trash" });

        await runCheck("mail_delete", async () => {
          const text = parseTextContent(await callTool(client, "mail_delete", {
            folder: temp.mailFolder,
            uid: temp.mailUid,
          }));
          return text;
        });
      }
    }

    const addressBooks = await runCheck("contacts_list_address_books", async () => {
      const data = parseJsonContent(await callTool(client, "contacts_list_address_books", {}));
      return data.slice(0, 4);
    });

    const addressBookUrl = Array.isArray(addressBooks) ? addressBooks[0]?.url : null;

    const contacts = await runCheck("contacts_list", async () => {
      const data = parseJsonContent(await callTool(client, "contacts_list", addressBookUrl ? { address_book_url: addressBookUrl } : {}));
      return { count: data.length, sample: data.slice(0, 2) };
    });

    await runCheck("contacts_search", async () => {
      const query = contacts?.sample?.[0]?.displayName?.split(" ")[0] ?? "Henrik";
      const data = parseJsonContent(await callTool(client, "contacts_search", {
        query,
        ...(addressBookUrl ? { address_book_url: addressBookUrl } : {}),
      }));
      return data.slice(0, 3);
    });

    const sampleContactUrl = contacts?.sample?.[0]?.url;
    if (sampleContactUrl) {
      await runCheck("contacts_get", async () => {
        const data = parseJsonContent(await callTool(client, "contacts_get", { contact_url: sampleContactUrl }));
        return { url: data.url, displayName: data.displayName };
      });
    }

    if (mode === "full") {
      const createdContact = await runCheck("contacts_create", async () => {
        const text = parseTextContent(await callTool(client, "contacts_create", {
          display_name: `MCP Smoke ${randomUUID().slice(0, 8)}`,
          email: `smoke-${randomUUID().slice(0, 8)}@example.invalid`,
          organization: "MCP Smoke Test",
          ...(addressBookUrl ? { address_book_url: addressBookUrl } : {}),
        }));
        const match = text.match(/Contact created: (.+)$/m);
        if (!match) throw new Error(`Could not parse contact URL from response: ${text}`);
        temp.contactUrl = match[1];
        return text;
      }, { cleanup: "delete" });

      if (createdContact && temp.contactUrl) {
        await runCheck("contacts_update", async () => {
          const text = parseTextContent(await callTool(client, "contacts_update", {
            contact_url: temp.contactUrl,
            organization: "MCP Smoke Test Updated",
          }));
          return text;
        }, { cleanup: "delete" });

        await runCheck("contacts_delete", async () => {
          const text = parseTextContent(await callTool(client, "contacts_delete", {
            contact_url: temp.contactUrl,
          }));
          temp.contactUrl = null;
          return text;
        });
      }
    }

    await runCheck("chk_list_short_urls", async () => {
      const data = parseJsonContent(await callTool(client, "chk_list_short_urls", {}));
      return { count: data.length };
    });

    if (mode === "full") {
      const createdShort = await runCheck("chk_create_short_url", async () => {
        const data = parseJsonContent(await callTool(client, "chk_create_short_url", {
          url: "https://example.com/",
        }));
        temp.chkId = data.id;
        return { id: data.id, short_url: data.short_url };
      }, { cleanup: "delete" });

      if (createdShort && temp.chkId) {
        await runCheck("chk_delete_short_url", async () => {
          const text = parseTextContent(await callTool(client, "chk_delete_short_url", { id: temp.chkId }));
          temp.chkId = null;
          return text;
        });
      }
    }

    await runCheck("kmeet_create_room", async () => {
      const data = parseJsonContent(await callTool(client, "kmeet_create_room", { name: `smoke-${randomUUID().slice(0, 8)}` }));
      return data;
    });

    if (mode === "full" && calendar) {
      const kmeetTitle = `MCP kMeet ${randomUUID().slice(0, 8)}`;
      const kmeetResult = await runCheck("kmeet_schedule_room", async () => {
          const data = parseJsonContent(await callTool(client, "kmeet_schedule_room", {
            calendar_id: Number(calendar.id),
            title: kmeetTitle,
            starting_at: formatYmdHms(start),
            ending_at: formatYmdHms(end),
            description: "Temporary kMeet event created by live smoke test",
          }));
          return data;
        }, { cleanup: "best effort via calendar_delete_event" });

      if (kmeetResult) {
        const list = parseJsonContent(await callTool(client, "calendar_list_events", {
          from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          calendar_id: String(calendar.id),
        }));
        const event = list.find((entry) => entry.title === kmeetTitle);
        if (event?.id) {
          temp.kmeetEventId = event.id;
        }
      }
    }

    if (availableTools.has("ai_list_models")) {
      await runCheck("ai_list_models", async () => {
        const data = parseJsonContent(await callTool(client, "ai_list_models", {}));
        return data.slice(0, 5);
      });

      if (mode === "full") {
        const models = parseJsonContent(await callTool(client, "ai_list_models", {}));
        const modelId = models[0]?.id;
        await runCheck("ai_chat", async () => {
          const text = parseTextContent(await callTool(client, "ai_chat", {
            model: modelId,
            messages: [{ role: "user", content: "Reply with exactly: smoke-ok" }],
            temperature: 0,
            max_tokens: 10,
          }));
          return text;
        });

        await runCheck("ai_embeddings", async () => {
          const data = parseJsonContent(await callTool(client, "ai_embeddings", {
            model: undefined,
            input: "smoke test",
          }));
          return { embeddings: data.data?.length ?? 0, usage: data.usage ?? null };
        });

        await runCheck("ai_transcribe", async () => {
          const wavBase64 = readFileSync(resolve(repoRoot, "scripts", "smoke-silence.wav")).toString("base64");
          const text = parseTextContent(await callTool(client, "ai_transcribe", {
            filename: "smoke-silence.wav",
            audio_base64: wavBase64,
          }));
          return text;
        }, { optional: true });
      }
    } else {
      results.push({
        name: "ai_tools",
        status: "skipped",
        durationMs: 0,
        details: "AI tools not registered (missing AI_PRODUCT_ID or server config)",
        cleanup: "n/a",
      });
    }

    await runCheck("kpaste_create", async () => {
      const text = parseTextContent(await callTool(client, "kpaste_create", {
        content: `Smoke test ${temp.mailSubject}`,
        expiration: "1day",
        burn_after_reading: false,
      }));
      return text.split("\n").slice(0, 4).join(" ");
    }, { cleanup: "none" });

    if (mode === "full" && availableTools.has("swisstransfer_send") && swissTransferRecaptchaToken) {
      const swiss = await runCheck("swisstransfer_send", async () => {
        const payload = Buffer.from("infomaniak smoke transfer", "utf8").toString("base64");
        const data = parseJsonContent(await callTool(client, "swisstransfer_send", {
          files: [{ name: "smoke-transfer.txt", base64_content: payload }],
          recaptcha_token: swissTransferRecaptchaToken,
          message: "Temporary Swiss Transfer created by live smoke test",
          expiration_days: 1,
          download_limit: 1,
        }));
        temp.swissTransferId = data.containerUUID ?? data.id ?? null;
        return data;
      }, { cleanup: "none" });

      if (swiss && temp.swissTransferId) {
        await runCheck("swisstransfer_info", async () => {
          const data = parseJsonContent(await callTool(client, "swisstransfer_info", {
            transfer_id: temp.swissTransferId,
          }));
          return data;
        }, { cleanup: "none" });
      }
    } else {
      results.push({
        name: "swisstransfer_tools",
        status: "skipped",
        durationMs: 0,
        details: swissTransferEnabled
          ? "Swiss Transfer tools enabled, but SWISSTRANSFER_RECAPTCHA_TOKEN was not provided for the smoke test"
          : "Swiss Transfer tools disabled by default (set ENABLE_EXPERIMENTAL_SWISSTRANSFER=1 to test them)",
        cleanup: "n/a",
      });
    }

    if (temp.kmeetEventId) {
      await runCheck("calendar_delete_event(kmeet cleanup)", async () => {
        const text = parseTextContent(await callTool(client, "calendar_delete_event", { event_id: String(temp.kmeetEventId) }));
        temp.kmeetEventId = null;
        return text;
      }, { optional: true });
    }

    if (temp.calendarEventId) {
      await runCheck("calendar_delete_event", async () => {
        const text = parseTextContent(await callTool(client, "calendar_delete_event", { event_id: String(temp.calendarEventId) }));
        temp.calendarEventId = null;
        return text;
      }, { cleanup: "done" });
    }

    for (const fileId of [...temp.kdriveFiles]) {
      await runCheck(`kdrive_delete(file:${fileId})`, async () => {
        const text = parseTextContent(await callTool(client, "kdrive_delete", { file_id: fileId }));
        temp.kdriveFiles = temp.kdriveFiles.filter((id) => id !== fileId);
        return text;
      }, { optional: true });
    }

    for (const folderId of [...temp.kdriveFolders].reverse()) {
      await runCheck(`kdrive_delete(folder:${folderId})`, async () => {
        const text = parseTextContent(await callTool(client, "kdrive_delete", { file_id: folderId }));
        temp.kdriveFolders = temp.kdriveFolders.filter((id) => id !== folderId);
        return text;
      }, { optional: true });
    }

    if (temp.contactUrl) {
      await runCheck("contacts_delete(cleanup)", async () => {
        const text = parseTextContent(await callTool(client, "contacts_delete", { contact_url: temp.contactUrl }));
        temp.contactUrl = null;
        return text;
      }, { optional: true });
    }

    if (temp.chkId) {
      await runCheck("chk_delete_short_url(cleanup)", async () => {
        const text = parseTextContent(await callTool(client, "chk_delete_short_url", { id: temp.chkId }));
        temp.chkId = null;
        return text;
      }, { optional: true });
    }

    const summary = {
      serverPath,
      mode,
      total: results.length,
      passed: results.filter((entry) => entry.status === "passed").length,
      failed: results.filter((entry) => entry.status === "failed").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
      results,
      stderr: getStderr(),
    };

    console.log(JSON.stringify(summary, null, 2));
    await transport.close();
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(JSON.stringify({
      fatal: error instanceof Error ? error.stack ?? error.message : String(error),
      partialResults: results,
      serverPath,
      stderr: getStderr(),
    }, null, 2));
    await transport.close();
    process.exit(1);
  }
}

function formatYmdHm(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function formatYmdHms(date) {
  return `${formatYmdHm(date)}:00`;
}

await main();
