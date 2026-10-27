import type { MailUid } from "./mail.js";

// The Mail API identifies messages as "uid@folderId". Listings and IMAP use bare UIDs,
// so callers may pass either form. A qualified ID names its own folder, which takes
// precedence over any separate folder argument.
export function splitMailUid(uid: MailUid): { uid: string; folderId?: string } {
  const value = String(uid).trim();
  const separator = value.indexOf("@");
  if (separator === -1) return { uid: value };
  return { uid: value.slice(0, separator), folderId: value.slice(separator + 1) || undefined };
}

export function qualifyMailUid(uid: MailUid, folderId?: string): string {
  const parts = splitMailUid(uid);
  if (!parts.uid) {
    throw new Error("Message UID must not be empty.");
  }
  const resolvedFolderId = parts.folderId ?? folderId;
  if (!resolvedFolderId) {
    throw new Error(`Message UID ${parts.uid} needs a source folder. Pass folder (e.g. INBOX) or a UID in uid@folderId form.`);
  }
  return `${parts.uid}@${resolvedFolderId}`;
}
