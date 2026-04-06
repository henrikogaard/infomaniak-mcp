import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContactsService } from "../services/contacts.js";
import { safeHandler, textResult, jsonResult } from "../tool-handler.js";

export function registerContactsTools(server: McpServer, contacts: ContactsService) {
  server.tool(
    "contacts_list_address_books",
    "List all address books",
    {},
    safeHandler(async () => {
      const books = await contacts.listAddressBooks();
      return jsonResult(books);
    })
  );

  server.tool(
    "contacts_list",
    "List all contacts, optionally filtered by address book. Returns name, email, phone, organization.",
    {
      address_book_url: z.string().optional().describe("Address book URL (omit for all)"),
    },
    safeHandler(async ({ address_book_url }) => {
      const list = await contacts.listContacts(address_book_url);
      const summary = list.map((c) => ({
        url: c.url,
        displayName: c.displayName,
        email: c.email,
        phone: c.phone,
        organization: c.organization,
      }));
      return jsonResult(summary);
    })
  );

  server.tool(
    "contacts_search",
    "Search contacts by name, email, phone, or organization",
    {
      query: z.string().describe("Search query"),
      address_book_url: z.string().optional().describe("Address book URL (omit for all)"),
    },
    safeHandler(async ({ query, address_book_url }) => {
      const list = await contacts.listContacts(address_book_url);
      const q = query.toLowerCase();
      const matches = list.filter((c) =>
        (c.displayName?.toLowerCase().includes(q)) ||
        (c.email?.some((e) => e.toLowerCase().includes(q))) ||
        (c.phone?.some((p) => p.includes(q))) ||
        (c.organization?.toLowerCase().includes(q))
      );
      const summary = matches.map((c) => ({
        url: c.url,
        displayName: c.displayName,
        email: c.email,
        phone: c.phone,
        organization: c.organization,
      }));
      return jsonResult(summary);
    })
  );

  server.tool(
    "contacts_get",
    "Get a specific contact with full vCard details",
    { contact_url: z.string().describe("Contact URL") },
    safeHandler(async ({ contact_url }) => {
      const contact = await contacts.getContact(contact_url);
      return jsonResult(contact);
    })
  );

  server.tool(
    "contacts_create",
    "Create a new contact in an address book",
    {
      display_name: z.string().describe("Full name"),
      first_name: z.string().optional().describe("First/given name"),
      last_name: z.string().optional().describe("Last/family name"),
      email: z.string().optional().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
      organization: z.string().optional().describe("Company/organization"),
      address_book_url: z.string().optional().describe("Address book URL (uses default if omitted)"),
    },
    safeHandler(async ({ display_name, first_name, last_name, email, phone, organization, address_book_url }) => {
      const url = await contacts.createContact({
        displayName: display_name,
        firstName: first_name,
        lastName: last_name,
        email, phone, organization,
        addressBookUrl: address_book_url,
      });
      return textResult(`Contact created: ${url}`);
    })
  );

  server.tool(
    "contacts_update",
    "Update an existing contact's fields",
    {
      contact_url: z.string().describe("Contact URL"),
      display_name: z.string().optional().describe("New full name"),
      email: z.string().optional().describe("New email"),
      phone: z.string().optional().describe("New phone number"),
      organization: z.string().optional().describe("New organization"),
    },
    safeHandler(async ({ contact_url, display_name, email, phone, organization }) => {
      await contacts.updateContact(contact_url, {
        displayName: display_name, email, phone, organization,
      });
      return textResult(`Contact updated: ${contact_url}`);
    })
  );

  server.tool(
    "contacts_delete",
    "Delete a contact from an address book",
    { contact_url: z.string().describe("Contact URL to delete") },
    safeHandler(async ({ contact_url }) => {
      await contacts.deleteContact(contact_url);
      return textResult(`Contact deleted: ${contact_url}`);
    })
  );
}
