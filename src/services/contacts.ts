import { DAVClient, type DAVVCard } from "tsdav";
import type { Config } from "../config.js";

interface Contact {
  url: string;
  etag?: string;
  displayName?: string;
  email?: string[];
  phone?: string[];
  organization?: string;
  rawVCard: string;
}

export class ContactsService {
  private config: Config;
  private client: DAVClient | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  private async getClient(): Promise<DAVClient> {
    if (this.client) {
      // Test if the client is still valid by attempting a lightweight operation
      try {
        await this.client.fetchAddressBooks();
        return this.client;
      } catch {
        // Client is stale, reconnect
        this.client = null;
      }
    }

    console.error(`[CardDAV] Connecting to ${this.config.cardDavUrl} as ${this.config.davUser}`);

    const client = new DAVClient({
      serverUrl: this.config.cardDavUrl,
      credentials: {
        username: this.config.davUser,
        password: this.config.davPassword,
      },
      authMethod: "Basic",
      defaultAccountType: "carddav",
    });

    try {
      await client.login();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CardDAV] Login failed: ${msg}`);

      // If standard discovery fails, try with .well-known path appended
      if (msg.includes("homeUrl")) {
        console.error("[CardDAV] Retrying with /.well-known/carddav appended to serverUrl");
        const fallbackClient = new DAVClient({
          serverUrl: `${this.config.cardDavUrl.replace(/\/+$/, "")}/.well-known/carddav`,
          credentials: {
            username: this.config.davUser,
            password: this.config.davPassword,
          },
          authMethod: "Basic",
          defaultAccountType: "carddav",
        });
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

  async listAddressBooks(): Promise<Array<{ url: string; displayName: string }>> {
    const client = await this.getClient();
    const addressBooks = await client.fetchAddressBooks();
    return addressBooks.map((ab) => ({
      url: ab.url,
      displayName: String(ab.displayName ?? ab.url),
    }));
  }

  async listContacts(addressBookUrl?: string): Promise<Contact[]> {
    const client = await this.getClient();
    const addressBooks = await client.fetchAddressBooks();

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

  async getContact(contactUrl: string): Promise<Contact> {
    const client = await this.getClient();
    const addressBooks = await client.fetchAddressBooks();

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
      phone?: string;
      organization?: string;
      addressBookUrl?: string;
    }
  ): Promise<string> {
    const client = await this.getClient();
    const addressBooks = await client.fetchAddressBooks();
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
    if (params.email) lines.push(`EMAIL;TYPE=INTERNET:${params.email}`);
    if (params.phone) lines.push(`TEL;TYPE=CELL:${params.phone}`);
    if (params.organization) lines.push(`ORG:${params.organization}`);
    lines.push("END:VCARD");

    const vcard = lines.join("\r\n");

    await client.createVCard({
      addressBook: targetBook,
      filename: `${uid}.vcf`,
      vCardString: vcard,
    });

    return `${targetBook.url}${uid}.vcf`;
  }

  async updateContact(
    contactUrl: string,
    params: {
      displayName?: string;
      email?: string;
      phone?: string;
      organization?: string;
    }
  ): Promise<void> {
    const client = await this.getClient();
    const addressBooks = await client.fetchAddressBooks();

    for (const ab of addressBooks) {
      const vcards = await client.fetchVCards({
        addressBook: ab,
        objectUrls: [contactUrl],
      });
      if (vcards.length > 0) {
        let data = vcards[0].data as string;
        if (params.displayName) {
          data = data.replace(/^FN:.*$/m, `FN:${params.displayName}`);
        }
        if (params.email) {
          if (data.match(/^EMAIL/m)) {
            data = data.replace(/^EMAIL[^:]*:.*$/m, `EMAIL;TYPE=INTERNET:${params.email}`);
          } else {
            data = data.replace("END:VCARD", `EMAIL;TYPE=INTERNET:${params.email}\r\nEND:VCARD`);
          }
        }
        if (params.phone) {
          if (data.match(/^TEL/m)) {
            data = data.replace(/^TEL[^:]*:.*$/m, `TEL;TYPE=CELL:${params.phone}`);
          } else {
            data = data.replace("END:VCARD", `TEL;TYPE=CELL:${params.phone}\r\nEND:VCARD`);
          }
        }
        if (params.organization) {
          if (data.match(/^ORG/m)) {
            data = data.replace(/^ORG:.*$/m, `ORG:${params.organization}`);
          } else {
            data = data.replace("END:VCARD", `ORG:${params.organization}\r\nEND:VCARD`);
          }
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
        return;
      }
    }
    throw new Error(`Contact not found: ${contactUrl}`);
  }

  async deleteContact(contactUrl: string): Promise<void> {
    const client = await this.getClient();
    const addressBooks = await client.fetchAddressBooks();

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
        return;
      }
    }
    throw new Error(`Contact not found: ${contactUrl}`);
  }
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
