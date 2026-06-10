import test from "node:test";
import assert from "node:assert/strict";

import { ContactsService } from "../dist/services/contacts.js";
import { CalDAVTasksService } from "../dist/services/caldav-tasks.js";

function makeConfig() {
  return {
    infomaniakToken: "",
    mailToken: "",
    kdriveId: "",
    aiProductId: "",
    mailUser: "",
    mailPassword: "",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 587,
    davUser: "DAVUSER",
    davPassword: "secret",
    cardDavUrl: "https://sync.example.test",
    calDavUrl: "https://sync.example.test",
    enableExperimentalSwissTransfer: false,
    kchatToken: "",
    kchatTeamName: "",
    enabledServices: "",
    enabledTools: "",
    disabledTools: "",
    strictExternalSend: false,
    readOnly: false,
    davCacheTtlMs: 60000,
  };
}

test("ContactsService creates the DAV client lazily and caches address books", async () => {
  let now = 1000;
  let clientFactoryCalls = 0;
  const client = {
    loginCalls: 0,
    fetchAddressBooksCalls: 0,
    async login() {
      this.loginCalls += 1;
    },
    async fetchAddressBooks() {
      this.fetchAddressBooksCalls += 1;
      return [{ url: "carddav://book", displayName: "Contacts" }];
    },
  };

  const service = new ContactsService(makeConfig(), {
    cacheTtlMs: 5000,
    now: () => now,
    createClient() {
      clientFactoryCalls += 1;
      return client;
    },
  });

  assert.equal(clientFactoryCalls, 0);

  assert.deepEqual(await service.listAddressBooks(), [
    { url: "carddav://book", displayName: "Contacts" },
  ]);
  assert.deepEqual(await service.listAddressBooks(), [
    { url: "carddav://book", displayName: "Contacts" },
  ]);

  assert.equal(clientFactoryCalls, 1);
  assert.equal(client.loginCalls, 1);
  assert.equal(client.fetchAddressBooksCalls, 1);

  now += 5001;
  await service.listAddressBooks();
  assert.equal(client.fetchAddressBooksCalls, 2);
});

test("ContactsService caches contact summaries and supports query limits", async () => {
  const client = {
    async login() {},
    async fetchAddressBooks() {
      return [{ url: "carddav://book", displayName: "Contacts" }];
    },
    fetchVCardsCalls: 0,
    async fetchVCards() {
      this.fetchVCardsCalls += 1;
      return [
        {
          url: "carddav://book/ada.vcf",
          data: "BEGIN:VCARD\r\nFN:Ada Lovelace\r\nEMAIL:ada@example.com\r\nORG:Math\r\nEND:VCARD",
        },
        {
          url: "carddav://book/grace.vcf",
          data: "BEGIN:VCARD\r\nFN:Grace Hopper\r\nEMAIL:grace@example.com\r\nORG:Navy\r\nEND:VCARD",
        },
      ];
    },
  };

  const service = new ContactsService(makeConfig(), {
    cacheTtlMs: 60000,
    now: () => 3000,
    createClient() {
      return client;
    },
  });

  assert.deepEqual(await service.queryContacts({ query: "ada", limit: 1 }), [{
    url: "carddav://book/ada.vcf",
    displayName: "Ada Lovelace",
    email: ["ada@example.com"],
    phone: [],
    organization: "Math",
  }]);
  assert.deepEqual((await service.queryContacts({ limit: 2 })).map((contact) => contact.displayName), [
    "Ada Lovelace",
    "Grace Hopper",
  ]);
  assert.equal(client.fetchVCardsCalls, 1);
});

test("ContactsService creates and updates contacts with multiple emails and phones", async () => {
  const created = [];
  const updated = [];
  let storedVCard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "UID:ada",
    "FN:Ada Lovelace",
    "N:Lovelace;Ada;;;",
    "EMAIL;TYPE=INTERNET:old@example.com",
    "TEL;TYPE=CELL:+410000000",
    "END:VCARD",
  ].join("\r\n");
  const client = {
    async login() {},
    async fetchAddressBooks() {
      return [{ url: "carddav://book/", displayName: "Contacts" }];
    },
    async fetchVCards() {
      return [{ url: "carddav://book/ada.vcf", etag: "etag-1", data: storedVCard }];
    },
    async createVCard(args) {
      created.push(args);
    },
    async updateVCard(args) {
      updated.push(args);
      storedVCard = args.vCard.data;
    },
  };

  const service = new ContactsService(makeConfig(), {
    cacheTtlMs: 60000,
    now: () => 4000,
    createClient() {
      return client;
    },
  });

  const url = await service.createContact({
    displayName: "Grace Hopper",
    emails: ["grace@example.com", "g.hopper@example.org"],
    phones: ["+411111111", "+412222222"],
    organization: "Navy",
  });
  assert.match(url, /^carddav:\/\/book\/.+\.vcf$/);
  assert.match(created[0].vCardString, /EMAIL;TYPE=INTERNET:grace@example\.com/);
  assert.match(created[0].vCardString, /EMAIL;TYPE=INTERNET:g\.hopper@example\.org/);
  assert.match(created[0].vCardString, /TEL;TYPE=CELL:\+411111111/);
  assert.match(created[0].vCardString, /TEL;TYPE=CELL:\+412222222/);

  await service.updateContact("carddav://book/ada.vcf", {
    emails: ["ada@example.com", "ada@analysis.example"],
    phones: ["+413333333", "+414444444"],
  });

  assert.match(updated[0].vCard.data, /EMAIL;TYPE=INTERNET:ada@example\.com/);
  assert.match(updated[0].vCard.data, /EMAIL;TYPE=INTERNET:ada@analysis\.example/);
  assert.doesNotMatch(updated[0].vCard.data, /old@example\.com/);
  assert.match(updated[0].vCard.data, /TEL;TYPE=CELL:\+413333333/);
  assert.match(updated[0].vCard.data, /TEL;TYPE=CELL:\+414444444/);
  assert.doesNotMatch(updated[0].vCard.data, /\+410000000/);
});

test("CalDAVTasksService caches task calendar discovery between task listings", async () => {
  let clientFactoryCalls = 0;
  const client = {
    loginCalls: 0,
    fetchCalendarsCalls: 0,
    fetchCalendarObjectsCalls: 0,
    async login() {
      this.loginCalls += 1;
    },
    async fetchCalendars() {
      this.fetchCalendarsCalls += 1;
      return [{ url: "caldav://tasks", displayName: "Tasks", components: ["VTODO"] }];
    },
    async fetchCalendarObjects() {
      this.fetchCalendarObjectsCalls += 1;
      return [];
    },
  };

  const service = new CalDAVTasksService(makeConfig(), {
    cacheTtlMs: 60000,
    now: () => 2000,
    createClient() {
      clientFactoryCalls += 1;
      return client;
    },
  });

  assert.equal(clientFactoryCalls, 0);

  assert.deepEqual(await service.listTasks({ status: "open" }), []);
  assert.deepEqual(await service.listTasks({ status: "open" }), []);

  assert.equal(clientFactoryCalls, 1);
  assert.equal(client.loginCalls, 1);
  assert.equal(client.fetchCalendarsCalls, 1);
  assert.equal(client.fetchCalendarObjectsCalls, 2);
});
