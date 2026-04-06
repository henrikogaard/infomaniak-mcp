export interface Config {
  // Infomaniak REST API token (for kDrive, Calendar, AI, Chk, kMeet, mail admin)
  infomaniakToken: string;
  // kDrive ID
  kdriveId: string;
  // AI Tools product ID
  aiProductId: string;
  // IMAP/SMTP credentials (also used for CardDAV)
  mailUser: string;
  mailPassword: string;
  // IMAP settings
  imapHost: string;
  imapPort: number;
  // SMTP settings
  smtpHost: string;
  smtpPort: number;
  // CardDAV settings
  cardDavUrl: string;
}

export function loadConfig(): Config {
  return {
    infomaniakToken: process.env.INFOMANIAK_TOKEN ?? "",
    kdriveId: process.env.KDRIVE_ID ?? "",
    aiProductId: process.env.AI_PRODUCT_ID ?? "",
    mailUser: process.env.MAIL_USER ?? "",
    mailPassword: process.env.MAIL_PASSWORD ?? "",
    imapHost: process.env.IMAP_HOST ?? "mail.infomaniak.com",
    imapPort: parseInt(process.env.IMAP_PORT ?? "993", 10),
    smtpHost: process.env.SMTP_HOST ?? "mail.infomaniak.com",
    smtpPort: parseInt(process.env.SMTP_PORT ?? "587", 10),
    cardDavUrl: process.env.CARDDAV_URL ?? "https://sync.infomaniak.com",
  };
}
