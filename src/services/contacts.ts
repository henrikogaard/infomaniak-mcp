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
    if (this.client) return this.client;

    const client = new DAVClient({
      serverUrl: this.config.cardDavUrl,
      credentials: {
        username: this.config.mailUser,
        password: this.config.mailPassword,
      },
      authMethod: "Basic",
      defaultAccountType: "carddav",
    });
    await client.login();
    this.client = client;

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

    // Find the address book that contains this contact
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
    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `UID:${uid}`,
      `FN:${params.displayName}`,
    ];
    if (params.email) lines.push(`EMAIL:${params.email}`);
    if (params.phone) lines.push(`TEL:${params.phone}`);
    if (params.organization) lines.push(`ORG:${params.organization}`);
    lines.push("END:VCARD");

    const vcard = lines.join("\r\n");
    const contactUrl = `${targetBook.url}${uid}.vcf`;

    await client.createVCard({
      addressBook: targetBook,
      filename: `${uid}.vcf`,
      vCardString: vcard,
    });

    return contactUrl;
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
            data = data.replace(/^EMAIL[^:]*:.*$/m, `EMAIL:${params.email}`);
          } else {
            data = data.replace("END:VCARD", `EMAIL:${params.email}\r\nEND:VCARD`);
          }
        }
        if (params.phone) {
          if (data.match(/^TEL/m)) {
            data = data.replace(/^TEL[^:]*:.*$/m, `TEL:${params.phone}`);
          } else {
            data = data.replace("END:VCARD", `TEL:${params.phone}\r\nEND:VCARD`);
          }
        }
        if (params.organization) {
          if (data.match(/^ORG/m)) {
            data = data.replace(/^ORG:.*$/m, `ORG:${params.organization}`);
          } else {
            data = data.replace("END:VCARD", `ORG:${params.organization}\r\nEND:VCARD`);
          }
        }

        await client.updateVCard({
          vCard: { ...vcards[0], data, url: contactUrl, etag: vcards[0].etag ?? "" },
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
        await client.deleteVCard({
          vCard: { url: contactUrl, etag: vcards[0].etag ?? "" },
        });
        return;
      }
    }
    throw new Error(`Contact not found: ${contactUrl}`);
  }
}

function parseVCard(vc: DAVVCard): Contact {
  const data = (vc.data as string) ?? "";
  const get = (field: string): string | undefined => {
    const match = data.match(new RegExp(`^${field}[^:]*:(.*)$`, "mi"));
    return match?.[1]?.trim();
  };
  const getAll = (field: string): string[] => {
    const matches = data.matchAll(new RegExp(`^${field}[^:]*:(.*)$`, "gmi"));
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
