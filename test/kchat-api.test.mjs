import test from "node:test";
import assert from "node:assert/strict";

import { KChatService } from "../dist/services/kchat.js";

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Failure",
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "application/json" : "";
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
