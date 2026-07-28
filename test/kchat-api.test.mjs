import test from "node:test";
import assert from "node:assert/strict";

import { KChatService } from "../dist/services/kchat.js";

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Failure",
    headers: {
      get(name) {
        const normalized = name.toLowerCase();
        if (normalized === "content-type") return "application/json";
        return headers[normalized] ?? "";
      },
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("KChatService resolves the team before listing channels", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v4/teams/name/acme")) {
      return jsonResponse({ id: "team-1", name: "acme" });
    }
    return jsonResponse([{ id: "channel-1", name: "town-square" }]);
  };

  const kchat = new KChatService({ token: "chat-token", teamName: "acme", fetch: fetchImpl });
  const channels = await kchat.listChannels({ limit: 20, page: 2 });

  assert.deepEqual(channels, [{ id: "channel-1", name: "town-square" }]);
  assert.equal(calls[0].url, "https://acme.kchat.infomaniak.com/api/v4/teams/name/acme");
  assert.equal(calls[0].options.headers.Authorization, "Bearer chat-token");
  assert.equal(calls[1].url, "https://acme.kchat.infomaniak.com/api/v4/teams/team-1/channels?per_page=20&page=2");
});

test("KChatService accepts a full kChat URL as the team name", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v4/teams/name/acme")) {
      return jsonResponse({ id: "team-1", name: "acme" });
    }
    return jsonResponse([{ id: "channel-1", name: "town-square" }]);
  };

  const kchat = new KChatService({
    token: "chat-token",
    teamName: "https://acme.kchat.infomaniak.com/acme/channels/town-square",
    fetch: fetchImpl,
  });
  await kchat.listChannels({ limit: 5 });

  assert.equal(calls[0].url, "https://acme.kchat.infomaniak.com/api/v4/teams/name/acme");
});

test("KChatService accepts central kChat URLs with the team in the path", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v4/teams/name/acme")) {
      return jsonResponse({ id: "team-1", name: "acme" });
    }
    return jsonResponse([{ id: "channel-1", name: "town-square" }]);
  };

  const kchat = new KChatService({
    token: "chat-token",
    teamName: "https://kchat.infomaniak.com/acme/channels/town-square",
    fetch: fetchImpl,
  });
  await kchat.listChannels({ limit: 5 });

  assert.equal(calls[0].url, "https://acme.kchat.infomaniak.com/api/v4/teams/name/acme");
});

test("KChatService reports actionable network errors", async () => {
  const kchat = new KChatService({
    token: "chat-token",
    teamName: "acme",
    fetch: async () => {
      throw new Error("fetch failed");
    },
    retries: 0,
  });

  await assert.rejects(
    () => kchat.listChannels(),
    /Check KCHAT_TEAM_NAME .* KCHAT_TOKEN/
  );
});

test("KChatService replies to a thread by looking up the parent post channel", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v4/posts/post-1")) {
      return jsonResponse({ id: "post-1", channel_id: "channel-1" });
    }
    return jsonResponse({ id: "reply-1", channel_id: "channel-1", root_id: "post-1" });
  };

  const kchat = new KChatService({ token: "chat-token", teamName: "acme", fetch: fetchImpl });
  const reply = await kchat.replyToThread("post-1", "I can take this.");

  assert.equal(reply.id, "reply-1");
  assert.equal(calls[1].url, "https://acme.kchat.infomaniak.com/api/v4/posts");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    channel_id: "channel-1",
    root_id: "post-1",
    message: "I can take this.",
  });
});

test("KChatService sends direct messages through a direct channel", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v4/users/me")) {
      return jsonResponse({ id: "current-user" });
    }
    if (url.endsWith("/api/v4/users/username/ada")) {
      return jsonResponse({ id: "recipient-user", username: "ada" });
    }
    if (url.endsWith("/api/v4/channels/direct")) {
      return jsonResponse({ id: "direct-channel" });
    }
    return jsonResponse({ id: "dm-post", channel_id: "direct-channel" });
  };

  const kchat = new KChatService({ token: "chat-token", teamName: "acme", fetch: fetchImpl });
  const message = await kchat.sendDirectMessage("ada", "Heads up.");

  assert.equal(message.id, "dm-post");
  assert.equal(calls[2].url, "https://acme.kchat.infomaniak.com/api/v4/channels/direct");
  assert.deepEqual(JSON.parse(calls[2].options.body), ["current-user", "recipient-user"]);
  assert.equal(calls[3].url, "https://acme.kchat.infomaniak.com/api/v4/posts");
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    channel_id: "direct-channel",
    message: "Heads up.",
  });
});

test("KChatService reuses direct-message channel lookups for the same username", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/v4/users/me")) {
      return jsonResponse({ id: "current-user" });
    }
    if (url.endsWith("/api/v4/users/username/ada")) {
      return jsonResponse({ id: "recipient-user", username: "ada" });
    }
    if (url.endsWith("/api/v4/channels/direct")) {
      return jsonResponse({ id: "direct-channel" });
    }
    return jsonResponse({ id: `dm-post-${calls.length}`, channel_id: "direct-channel" });
  };

  const kchat = new KChatService({ token: "chat-token", teamName: "acme", fetch: fetchImpl });
  await kchat.sendDirectMessage("ada", "First.");
  await kchat.sendDirectMessage("ada", "Second.");

  assert.equal(calls.filter((call) => call.url.endsWith("/api/v4/users/me")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/v4/users/username/ada")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/v4/channels/direct")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/api/v4/posts")).length, 2);
});

test("KChatService retries transient rate-limit responses through the shared HTTP client", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return jsonResponse({ message: "rate limited" }, false, 429, { "retry-after": "0" });
    }
    if (url.endsWith("/api/v4/teams/name/acme")) {
      return jsonResponse({ id: "team-1", name: "acme" });
    }
    return jsonResponse([{ id: "channel-1", name: "town-square" }]);
  };

  const kchat = new KChatService({
    token: "chat-token",
    teamName: "acme",
    fetch: fetchImpl,
    retries: 1,
    retryBaseDelayMs: 0,
  });
  const channels = await kchat.listChannels({ limit: 5 });

  assert.deepEqual(channels, [{ id: "channel-1", name: "town-square" }]);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://acme.kchat.infomaniak.com/api/v4/teams/name/acme");
  assert.equal(calls[1].url, "https://acme.kchat.infomaniak.com/api/v4/teams/name/acme");
});

test("KChatService uploads files, attaches them to posts, and searches team posts", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/api/v4/files?")) {
      return jsonResponse({ file_infos: [{ id: "file-1", name: "note.txt" }] });
    }
    if (url.endsWith("/api/v4/teams/name/acme")) {
      return jsonResponse({ id: "team-1", name: "acme" });
    }
    if (url.endsWith("/api/v4/teams/team-1/posts/search")) {
      return jsonResponse({ order: ["post-1"], posts: { "post-1": { id: "post-1", message: "needle" } } });
    }
    return jsonResponse({ id: "post-1", file_ids: ["file-1"] });
  };

  const kchat = new KChatService({ token: "chat-token", teamName: "acme", fetch: fetchImpl });
  const upload = await kchat.uploadFile("channel-1", "note.txt", Buffer.from("hello").toString("base64"), "text/plain");
  const post = await kchat.postMessage("channel-1", "See attached", undefined, ["file-1"]);
  const search = await kchat.searchPosts({ terms: "needle", page: 2, perPage: 10 });

  assert.equal(upload.file_infos[0].id, "file-1");
  assert.deepEqual(post.file_ids, ["file-1"]);
  assert.deepEqual(search.order, ["post-1"]);
  assert.equal(calls[0].url, "https://acme.kchat.infomaniak.com/api/v4/files?channel_id=channel-1&filename=note.txt");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "text/plain");
  assert.deepEqual([...calls[0].options.body], [...Buffer.from("hello")]);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    channel_id: "channel-1",
    message: "See attached",
    file_ids: ["file-1"],
  });
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    terms: "needle",
    is_or_search: false,
    page: 2,
    per_page: 10,
  });
});
