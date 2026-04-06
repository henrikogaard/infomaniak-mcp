import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContactsService } from "../services/contacts.js";

export function registerContactsTools(server: McpServer, contacts: ContactsService) {
  server.tool(
    "contacts_list_address_books",
    "List all address books",
    {},
    async () => {
      const books = await contacts.listAddressBooks();
      return { content: [{ type: "text", text: JSON.stringify(books, null, 2) }] };
    }
  );

  server.tool(
    "contacts_list",
    "List all contacts, optionally filtered by address book",
    {
      address_book_url: z.string().optional().describe("Address book URL (omit for all)"),
    },
    async ({ address_book_url }) => {
      const list = await contacts.listContacts(address_book_url);
      // Return a summary without raw vCard data
      const summary = list.map((c) => ({
        url: c.url,
        displayName: c.displayName,
        email: c.email,
        phone: c.phone,
        organization: c.organization,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.tool(
    "contacts_get",
    "Get a specific contact by URL",
    { contact_url: z.string().describe("Contact URL") },
    async ({ contact_url }) => {
      const contact = await contacts.getContact(contact_url);
      return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
    }
  );

  server.tool(
    "contacts_create",
    "Create a new contact",
    {
      display_name: z.string().describe("Full name"),
      email: z.string().optional().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
      organization: z.string().optional().describe("Company/organization"),
      address_book_url: z.string().optional().describe("Address book URL (uses default if omitted)"),
    },
    async ({ display_name, email, phone, organization, address_book_url }) => {
      const url = await contacts.createContact({
        displayName: display_name,
        email, phone, organization,
        addressBookUrl: address_book_url,
      });
      return { content: [{ type: "text", text: `Contact created: ${url}` }] };
    }
  );

  server.tool(
    "contacts_update",
    "Update an existing contact",
    {
      contact_url: z.string().describe("Contact URL"),
      display_name: z.string().optional().describe("New full name"),
      email: z.string().optional().describe("New email"),
      phone: z.string().optional().describe("New phone number"),
      organization: z.string().optional().describe("New organization"),
    },
    async ({ contact_url, display_name, email, phone, organization }) => {
      await contacts.updateContact(contact_url, {
        displayName: display_name, email, phone, organization,
      });
      return { content: [{ type: "text", text: `Contact updated: ${contact_url}` }] };
    }
  );

  server.tool(
    "contacts_delete",
    "Delete a contact",
    { contact_url: z.string().describe("Contact URL to delete") },
    async ({ contact_url }) => {
      await contacts.deleteContact(contact_url);
      return { content: [{ type: "text", text: `Contact deleted: ${contact_url}` }] };
    }
  );
}
