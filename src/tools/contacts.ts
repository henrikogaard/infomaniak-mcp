import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContactsService } from "../services/contacts.js";
import { jsonResult, structuredResult, withUntrustedContent } from "../tool-handler.js";
import { arrayOutputSchema, destructiveTool, mutatingTool, objectOutputSchema, readOnlyTool, registerStructuredTool, requireConfirmation } from "./register.js";

const contactSummaryArrayOutputSchema = {
  data: z.array(z.object({
    url: z.string(),
    displayName: z.string().optional(),
    email: z.array(z.string()).optional(),
    phone: z.array(z.string()).optional(),
    organization: z.string().optional(),
  }).passthrough()),
};

export function registerContactsTools(server: McpServer, contacts: ContactsService) {
  registerStructuredTool(
    server,
    "contacts_list_address_books",
    "List all address books",
    {},
    readOnlyTool,
    async () => {
      const books = await contacts.listAddressBooks();
      return jsonResult(books);
    },
    arrayOutputSchema
  );

  registerStructuredTool(
    server,
    "contacts_list",
    "List contact summaries, optionally filtered by address book. Use limit to keep large address books compact.",
    {
      address_book_url: z.string().optional().describe("Address book URL (omit for all)"),
      limit: z.number().int().min(1).max(1000).optional().describe("Maximum contacts to return. Omit to return all contact summaries."),
    },
    readOnlyTool,
    async ({ address_book_url, limit }) => {
      const summary = await contacts.queryContacts({ addressBookUrl: address_book_url, limit });
      return jsonResult(summary);
    },
    contactSummaryArrayOutputSchema
  );

  registerStructuredTool(
    server,
    "contacts_query",
    "Fast contact summary query with small defaults. Searches name, email, phone, organization, and URL without returning raw vCards.",
    {
      query: z.string().optional().describe("Optional search query. Omit to return the first summaries."),
      address_book_url: z.string().optional().describe("Address book URL (omit for all)"),
      limit: z.number().int().min(1).max(1000).optional().describe("Maximum contacts to return. Defaults to 25."),
    },
    readOnlyTool,
    async ({ query, address_book_url, limit }) => {
      const result = await contacts.queryContacts({
        query,
        addressBookUrl: address_book_url,
        limit: limit ?? 25,
      });
      return jsonResult(result);
    },
    contactSummaryArrayOutputSchema
  );

  registerStructuredTool(
    server,
    "contacts_search",
    "Search contacts by name, email, phone, or organization",
    {
      query: z.string().describe("Search query"),
      address_book_url: z.string().optional().describe("Address book URL (omit for all)"),
    },
    readOnlyTool,
    async ({ query, address_book_url }) => {
      const summary = await contacts.queryContacts({ query, addressBookUrl: address_book_url });
      return jsonResult(summary);
    },
    contactSummaryArrayOutputSchema
  );

  registerStructuredTool(
    server,
    "contacts_get",
    "Get a specific contact with full vCard details",
    { contact_url: z.string().describe("Contact URL") },
    readOnlyTool,
    async ({ contact_url }) => {
      const contact = await contacts.getContact(contact_url);
      return withUntrustedContent(jsonResult(contact), "contacts", ["displayName", "email", "phone", "organization", "rawVCard"]);
    },
    objectOutputSchema
  );

  registerStructuredTool(
    server,
    "contacts_create",
    "Create a new contact in an address book",
    {
      display_name: z.string().describe("Full name"),
      first_name: z.string().optional().describe("First/given name"),
      last_name: z.string().optional().describe("Last/family name"),
      email: z.string().optional().describe("Email address"),
      emails: z.array(z.string()).optional().describe("Additional or replacement email addresses. Use for contacts with multiple emails."),
      phone: z.string().optional().describe("Phone number"),
      phones: z.array(z.string()).optional().describe("Additional or replacement phone numbers. Use for contacts with multiple phones."),
      organization: z.string().optional().describe("Company/organization"),
      address_book_url: z.string().optional().describe("Address book URL (uses default if omitted)"),
    },
    mutatingTool,
    async ({ display_name, first_name, last_name, email, emails, phone, phones, organization, address_book_url }) => {
      const url = await contacts.createContact({
        displayName: display_name,
        firstName: first_name,
        lastName: last_name,
        email,
        emails,
        phone,
        phones,
        organization,
        addressBookUrl: address_book_url,
      });
      return structuredResult({ contactUrl: url }, `Contact created: ${url}`);
    },
    { contactUrl: z.string() }
  );

  registerStructuredTool(
    server,
    "contacts_update",
    "Update an existing contact's fields",
    {
      contact_url: z.string().describe("Contact URL"),
      display_name: z.string().optional().describe("New full name"),
      email: z.string().optional().describe("New email"),
      emails: z.array(z.string()).optional().describe("Replace all email addresses with this list"),
      phone: z.string().optional().describe("New phone number"),
      phones: z.array(z.string()).optional().describe("Replace all phone numbers with this list"),
      organization: z.string().optional().describe("New organization"),
    },
    mutatingTool,
    async ({ contact_url, display_name, email, emails, phone, phones, organization }) => {
      await contacts.updateContact(contact_url, {
        displayName: display_name,
        email,
        emails,
        phone,
        phones,
        organization,
      });
      return structuredResult({ contactUrl: contact_url }, `Contact updated: ${contact_url}`);
    },
    { contactUrl: z.string() }
  );

  registerStructuredTool(
    server,
    "contacts_delete",
    "Delete a contact from an address book. Requires exact confirmation: DELETE CONTACT <contact_url>.",
    {
      contact_url: z.string().describe("Contact URL to delete"),
      confirmation: z.string().describe("Exact confirmation phrase, e.g. DELETE CONTACT https://..."),
    },
    destructiveTool,
    async ({ contact_url, confirmation }) => {
      requireConfirmation(confirmation, `DELETE CONTACT ${contact_url}`);
      await contacts.deleteContact(contact_url);
      return structuredResult({ contactUrl: contact_url }, `Contact deleted: ${contact_url}`);
    },
    { contactUrl: z.string() }
  );
}
