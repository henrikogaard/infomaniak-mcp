import { DAVClient, type DAVVCard } from "tsdav";
import type { Config } from "../config.js";

type AddressBook = Awaited<ReturnType<DAVClient["fetchAddressBooks"]>>[number];

export interface ContactsServiceOptions {
  cacheTtlMs?: number;
  now?: () => number;
  createClient?: (serverUrl: string) => DAVClient;
}

interface Contact {
  url: string;
  etag?: string;
  displayName?: string;
  email?: string[];
  phone?: string[];
  organization?: string;
  rawVCard: string;
}

export interface ContactSummary {
  url: string;
  displayName?: string;
  email?: string[];
  phone?: string[];
  organization?: string;
}

export interface ContactQueryOptions {
  query?: string;
  addressBookUrl?: string;
  limit?: number;
}

export class ContactsService {
  private config: Config;
  private client: DAVClient | null = null;
  private addressBooksCache: { value: AddressBook[]; expiresAt: number } | null = null;
  private contactSummaryCache = new Map<string, { value: ContactSummary[]; expiresAt: number }>();
  private cacheTtlMs: number;
  private now: () => number;
  private createClient: (serverUrl: string) => DAVClient;

  constructor(config: Config, options: ContactsServiceOptions = {}) {
    this.config = config;
    this.cacheTtlMs = options.cacheTtlMs ?? config.davCacheTtlMs ?? 30000;
    this.now = options.now ?? Date.now;
    this.createClient = options.createClient ?? ((serverUrl) => new DAVClient({
      serverUrl,
      credentials: {
        username: this.config.davUser,
        password: this.config.davPassword,
      },
      authMethod: "Basic",
      defaultAccountType: "carddav",
    }));
  }

  private async getClient(): Promise<DAVClient> {
    if (this.client) {
      return this.client;
    }

    console.error(`[CardDAV] Connecting to ${this.config.cardDavUrl} as ${this.config.davUser}`);

    const client = this.createClient(this.config.cardDavUrl);

    try {
      await client.login();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CardDAV] Login failed: ${msg}`);

      // If standard discovery fails, try with .well-known path appended
      if (msg.includes("homeUrl")) {
        console.error("[CardDAV] Retrying with /.well-known/carddav appended to serverUrl");
        const fallbackClient = this.createClient(`${this.config.cardDavUrl.replace(/\/+$/, "")}/.well-known/carddav`);
        await fallbackClient.login();
        this.client = fallbackClient;
        console.error("[CardDAV] Connected (via .well-known fallback)");
        return this.client;
      }
      throw err;
    }

    this.client = client;
    console.error("[CardDAV] Connected successfully");
    return this.client;
  }

  private async getAddressBooks(): Promise<AddressBook[]> {
    if (this.addressBooksCache && this.addressBooksCache.expiresAt > this.now()) {
      return this.addressBooksCache.value;
    }

    return this.fetchAddressBooksWithRetry();
  }

  private async fetchAddressBooksWithRetry(): Promise<AddressBook[]> {
    const client = await this.getClient();
    try {
      return await this.fetchAndCacheAddressBooks(client);
    } catch {
      this.client = null;
      this.addressBooksCache = null;
      const retryClient = await this.getClient();
      return this.fetchAndCacheAddressBooks(retryClient);
    }
  }

  private async fetchAndCacheAddressBooks(client: DAVClient): Promise<AddressBook[]> {
    const addressBooks = await client.fetchAddressBooks();
    this.addressBooksCache = {
      value: addressBooks,
      expiresAt: this.now() + this.cacheTtlMs,
    };
    return addressBooks;
  }

  async listAddressBooks(): Promise<Array<{ url: string; displayName: string }>> {
    const addressBooks = await this.getAddressBooks();
    return addressBooks.map((ab) => ({
      url: ab.url,
      displayName: String(ab.displayName ?? ab.url),
    }));
  }

  async listContacts(addressBookUrl?: string): Promise<Contact[]> {
    const client = await this.getClient();
    const addressBooks = await this.getAddressBooks();

    const targetBooks = addressBookUrl
      ? addressBooks.filter((ab) => ab.url === addressBookUrl)
      : addressBooks;

    const allContacts: Contact[] = [];
    for (const ab of targetBooks) {
      const vcards = await client.fetchVCards({ addressBook: ab });
      for (const vc of vcards) {
        allContacts.push(parseVCard(vc));
      }
    }
    return allContacts;
  }

  async queryContacts(options: ContactQueryOptions = {}): Promise<ContactSummary[]> {
    const summaries = await this.getContactSummaries(options.addressBookUrl);
    const normalizedQuery = options.query?.trim().toLowerCase();
    const filtered = normalizedQuery
      ? summaries.filter((contact) => contactMatchesQuery(contact, normalizedQuery))
      : summaries;
    const limit = normalizeLimit(options.limit, filtered.length);
    return filtered.slice(0, limit);
  }

  private async getContactSummaries(addressBookUrl?: string): Promise<ContactSummary[]> {
    const cacheKey = addressBookUrl ?? "__all__";
    const cached = this.contactSummaryCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }

    const contacts = await this.listContacts(addressBookUrl);
    const summaries = contacts.map(contactToSummary);
    this.contactSummaryCache.set(cacheKey, {
      value: summaries,
      expiresAt: this.now() + this.cacheTtlMs,
    });
    return summaries;
  }

  async getContact(contactUrl: string): Promise<Contact> {
    const client = await this.getClient();
    const addressBooks = await this.getAddressBooks();

    for (const ab of addressBooks) {
      const vcards = await client.fetchVCards({
        addressBook: ab,
        objectUrls: [contactUrl],
      });
      if (vcards.length > 0) {
        return parseVCard(vcards[0]);
      }
    }
    throw new Error(`Contact not found: ${contactUrl}`);
  }

  async createContact(
    params: {
      displayName: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      emails?: string[];
      phone?: string;
      phones?: string[];
      organization?: string;
      addressBookUrl?: string;
    }
  ): Promise<string> {
    const client = await this.getClient();
    const addressBooks = await this.getAddressBooks();
    const targetBook = params.addressBookUrl
      ? addressBooks.find((ab) => ab.url === params.addressBookUrl) ?? addressBooks[0]
      : addressBooks[0];

    if (!targetBook) throw new Error("No address book found");

    const uid = crypto.randomUUID();

    // Build structured name (N field required by vCard 3.0)
    const lastName = params.lastName ?? "";
    const firstName = params.firstName ?? "";
    // If no first/last name given, try to split displayName
    let nField: string;
    if (lastName || firstName) {
      nField = `${lastName};${firstName};;;`;
    } else {
      const parts = params.displayName.trim().split(/\s+/);
      if (parts.length >= 2) {
        nField = `${parts.slice(1).join(" ")};${parts[0]};;;`;
      } else {
        nField = `${params.displayName};;;;`;
      }
    }

    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `UID:${uid}`,
      `FN:${params.displayName}`,
      `N:${nField}`,
    ];
    for (const email of normalizeMultiValue(params.emails, params.email)) {
      lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardText(email)}`);
    }
    for (const phone of normalizeMultiValue(params.phones, params.phone)) {
      lines.push(`TEL;TYPE=CELL:${escapeVCardText(phone)}`);
    }
    if (params.organization) lines.push(`ORG:${escapeVCardText(params.organization)}`);
    lines.push("END:VCARD");

    const vcard = lines.join("\r\n");

    await client.createVCard({
      addressBook: targetBook,
      filename: `${uid}.vcf`,
      vCardString: vcard,
    });

    this.invalidateContactCaches();
    return `${targetBook.url}${uid}.vcf`;
  }

  async updateContact(
    contactUrl: string,
    params: {
      displayName?: string;
      email?: string;
      emails?: string[];
      phone?: string;
      phones?: string[];
      organization?: string;
    }
  ): Promise<void> {
    const client = await this.getClient();
    const addressBooks = await this.getAddressBooks();

    for (const ab of addressBooks) {
      const vcards = await client.fetchVCards({
        addressBook: ab,
        objectUrls: [contactUrl],
      });
      if (vcards.length > 0) {
        let data = vcards[0].data as string;
        if (params.displayName) {
          data = replaceOrInsertVCardProperty(data, "FN", `FN:${escapeVCardText(params.displayName)}`);
        }
        const emails = normalizeOptionalMultiValue(params.emails, params.email);
        if (emails) {
          data = replaceAllVCardProperties(
            data,
            "EMAIL",
            emails.map((email) => `EMAIL;TYPE=INTERNET:${escapeVCardText(email)}`)
          );
        }
        const phones = normalizeOptionalMultiValue(params.phones, params.phone);
        if (phones) {
          data = replaceAllVCardProperties(
            data,
            "TEL",
            phones.map((phone) => `TEL;TYPE=CELL:${escapeVCardText(phone)}`)
          );
        }
        if (params.organization) {
          data = replaceOrInsertVCardProperty(data, "ORG", `ORG:${escapeVCardText(params.organization)}`);
        }

        // Build the vCard object for update, only include etag if present
        const vCardObj: { data: string; url: string; etag?: string } = {
          data,
          url: contactUrl,
        };
        if (vcards[0].etag) {
          vCardObj.etag = vcards[0].etag;
        }

        await client.updateVCard({
          vCard: vCardObj as DAVVCard,
        });
        this.invalidateContactCaches();
        return;
      }
    }
    throw new Error(`Contact not found: ${contactUrl}`);
  }

  async deleteContact(contactUrl: string): Promise<void> {
    const client = await this.getClient();
    const addressBooks = await this.getAddressBooks();

    for (const ab of addressBooks) {
      const vcards = await client.fetchVCards({
        addressBook: ab,
        objectUrls: [contactUrl],
      });
      if (vcards.length > 0) {
        const vCardObj: { url: string; etag?: string } = { url: contactUrl };
        if (vcards[0].etag) {
          vCardObj.etag = vcards[0].etag;
        }

        await client.deleteVCard({
          vCard: vCardObj as DAVVCard,
        });
        this.invalidateContactCaches();
        return;
      }
    }
    throw new Error(`Contact not found: ${contactUrl}`);
  }

  private invalidateContactCaches(): void {
    this.contactSummaryCache.clear();
  }
}

function contactToSummary(contact: Contact): ContactSummary {
  return {
    url: contact.url,
    displayName: contact.displayName,
    email: contact.email,
    phone: contact.phone,
    organization: contact.organization,
  };
}

function contactMatchesQuery(contact: ContactSummary, normalizedQuery: string): boolean {
  return [
    contact.url,
    contact.displayName,
    contact.organization,
    ...(contact.email ?? []),
    ...(contact.phone ?? []),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedQuery));
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(1000, Math.max(1, Math.floor(limit)));
}

function normalizeMultiValue(values: string[] | undefined, fallback: string | undefined): string[] {
  return uniqueNonEmpty([...(values ?? []), ...(fallback ? [fallback] : [])]);
}

function normalizeOptionalMultiValue(values: string[] | undefined, fallback: string | undefined): string[] | undefined {
  if (values === undefined && fallback === undefined) return undefined;
  return normalizeMultiValue(values, fallback);
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function replaceAllVCardProperties(data: string, property: string, replacementLines: string[]): string {
  const withoutExisting = data
    .split(/\r?\n/)
    .filter((line) => !new RegExp(`^${property}(?:[;:]|$)`, "i").test(line))
    .join("\r\n");
  if (replacementLines.length === 0) {
    return withoutExisting;
  }
  return insertBeforeEnd(withoutExisting, replacementLines.join("\r\n"));
}

function replaceOrInsertVCardProperty(data: string, property: string, replacementLine: string): string {
  const pattern = new RegExp(`^${property}[^:]*:.*$`, "mi");
  if (pattern.test(data)) {
    return data.replace(pattern, replacementLine);
  }
  return insertBeforeEnd(data, replacementLine);
}

function insertBeforeEnd(data: string, line: string): string {
  return data.replace(/END:VCARD\s*$/i, `${line}\r\nEND:VCARD`);
}

function escapeVCardText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function parseVCard(vc: DAVVCard): Contact {
  const data = (vc.data as string) ?? "";

  // Handle vCard line folding: lines starting with space/tab are continuations
  const unfolded = data.replace(/\r?\n[ \t]/g, "");

  const get = (field: string): string | undefined => {
    const match = unfolded.match(new RegExp(`^${field}[^:]*:(.*)$`, "mi"));
    return match?.[1]?.trim();
  };
  const getAll = (field: string): string[] => {
    const matches = unfolded.matchAll(new RegExp(`^${field}[^:]*:(.*)$`, "gmi"));
    return Array.from(matches, (m) => m[1].trim());
  };

  return {
    url: vc.url,
    etag: vc.etag ?? undefined,
    displayName: get("FN"),
    email: getAll("EMAIL"),
    phone: getAll("TEL"),
    organization: get("ORG"),
    rawVCard: data,
  };
}
