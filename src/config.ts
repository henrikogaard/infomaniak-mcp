import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

export interface Config {
  // Infomaniak REST API token (for kDrive, Calendar, AI, Chk, kMeet)
  infomaniakToken: string;
  // Infomaniak Mail API token. Defaults to INFOMANIAK_TOKEN if MAIL_TOKEN is not set.
  mailToken: string;
  // kDrive ID
  kdriveId: string;
  // AI Tools product ID
  aiProductId: string;
  // IMAP/SMTP credentials
  mailUser: string;
  mailPassword: string;
  // IMAP settings
  imapHost: string;
  imapPort: number;
  // SMTP settings
  smtpHost: string;
  smtpPort: number;
  // CardDAV/CalDAV credentials (separate from IMAP — uses short username e.g. AB12345)
  davUser: string;
  davPassword: string;
  // CardDAV settings
  cardDavUrl: string;
  // CalDAV settings
  calDavUrl: string;
  // Experimental SwissTransfer tools
  enableExperimentalSwissTransfer: boolean;
  // kChat credentials
  kchatToken: string;
  kchatTeamName: string;
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function loadEnvFiles(): void {
  const currentFileDir = dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    resolve(process.cwd(), ".env"),
    resolve(currentFileDir, "../.env"),
  ];

  for (const envPath of candidatePaths) {
    if (!existsSync(envPath)) continue;
    loadDotenv({ path: envPath, override: false });
  }
}

export function loadConfig(): Config {
  loadEnvFiles();

  const mailUser = process.env.MAIL_USER ?? "";
  const mailPassword = process.env.MAIL_PASSWORD ?? "";

  return {
    infomaniakToken: process.env.INFOMANIAK_TOKEN ?? "",
    mailToken: process.env.MAIL_TOKEN ?? process.env.INFOMANIAK_TOKEN ?? "",
    kdriveId: process.env.KDRIVE_ID ?? "",
    aiProductId: process.env.AI_PRODUCT_ID ?? "",
    mailUser,
    mailPassword,
    imapHost: process.env.IMAP_HOST ?? "mail.infomaniak.com",
    imapPort: parseInt(process.env.IMAP_PORT ?? "993", 10),
    smtpHost: process.env.SMTP_HOST ?? "mail.infomaniak.com",
    smtpPort: parseInt(process.env.SMTP_PORT ?? "587", 10),
    // DAV credentials default to mail credentials if not set separately
    davUser: process.env.DAV_USER ?? mailUser,
    davPassword: process.env.DAV_PASSWORD ?? mailPassword,
    cardDavUrl: process.env.CARDDAV_URL ?? "https://sync.infomaniak.com",
    calDavUrl: process.env.CALDAV_URL ?? "https://sync.infomaniak.com",
    enableExperimentalSwissTransfer: parseBooleanEnv(process.env.ENABLE_EXPERIMENTAL_SWISSTRANSFER),
    kchatToken: process.env.KCHAT_TOKEN ?? "",
    kchatTeamName: process.env.KCHAT_TEAM_NAME ?? "",
  };
}
