import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/index.mjs";
import { importBuild } from "../server/import-build.mjs";

const PASSWORD = "a-long-test-password-42";
const BOOTSTRAP = "integration-test-bootstrap-token";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ZkAAAAASUVORK5CYII=",
  "base64",
);

async function fixture(
  t,
  { production = false, env = {}, bootstrapToken = BOOTSTRAP, now = Date.now } = {},
) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "khoifee-server-"));
  let app;
  let server;
  let base;
  let cookie = "";
  const start = async () => {
    const previous = Object.fromEntries(
      Object.keys(env).map((key) => [key, process.env[key]]),
    );
    try {
      for (const [key, value] of Object.entries(env)) process.env[key] = value;
      app = createApp({ dataDir, bootstrapToken, production, now });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    if (server?.listening) {
      const closing = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closing;
    }
    app?.locals.close();
  };
  t.after(async () => {
    await stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  await start();
  const request = async (
    route,
    {
      method = "GET",
      body,
      headers = {},
      origin = true,
      authenticated = true,
    } = {},
  ) => {
    const requestHeaders = { ...headers };
    if (origin !== false)
      requestHeaders.Origin = typeof origin === "string" ? origin : base;
    if (cookie && authenticated) requestHeaders.Cookie = cookie;
    let payload = body;
    if (
      body !== undefined &&
      !(body instanceof FormData) &&
      typeof body !== "string" &&
      !Buffer.isBuffer(body)
    ) {
      payload = JSON.stringify(body);
      requestHeaders["Content-Type"] = "application/json";
    }
    const response = await fetch(`${base}${route}`, {
      method,
      headers: requestHeaders,
      body: payload,
      redirect: "manual",
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    const contentType = response.headers.get("content-type") || "";
    const value = contentType.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, body: value };
  };
  return {
    request,
    dataDir,
    get base() {
      return base;
    },
    get cookie() {
      return cookie;
    },
    setup: () =>
      request("/api/auth/setup", {
        method: "POST",
        body: { token: BOOTSTRAP, password: PASSWORD },
      }),
    async restart() {
      await stop();
      await start();
    },
    async upload(kind, filename, bytes, options = {}) {
      const form = new FormData();
      form.append("file", new Blob([bytes]), filename);
      return request(`/api/admin/uploads?kind=${kind}`, {
        method: "POST",
        body: form,
        ...options,
      });
    },
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// A small ZIP writer keeps the tests independent of additional ZIP dependencies.
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const {
    name,
    body = "",
    compressed = false,
    mode,
    encrypted = false,
  } of entries) {
    const filename = Buffer.from(name);
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const packed = compressed ? deflateRawSync(data) : data;
    const checksum = crc32(data);
    const flags = 0x800 | (encrypted ? 1 : 0);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(compressed ? 8 : 0, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, packed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(compressed ? 8 : 0, 10);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(packed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(
      ((mode ?? (name.endsWith("/") ? 0o40755 : 0o100644)) << 16) >>> 0,
      38,
    );
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const validReview = {
  name: "A visitor",
  rating: 4,
  body: "A thoughtful little concept.",
};

test("public content has honest samples, approved-only metrics, and isolation headers", async (t) => {
  const api = await fixture(t);
  const response = await api.request("/api/site");
  assert.equal(response.status, 200);
  assert.equal(response.body.site.name, "KhoifeeDev");
  assert.equal(
    response.body.site.tagline,
    "Independent games. Shared adventures.",
  );
  assert.equal(response.body.site.heroTitle, "Small worlds.\nLasting stories.");
  assert.equal(response.body.site.email, "");
  assert.equal(response.body.site.community.url, "");
  assert.equal(response.body.games.length, 3);
  assert.equal(response.body.posts.length, 0);
  for (const game of response.body.games) {
    assert.equal(game.sample, true);
    assert.equal(game.rating, 0);
    assert.equal(game.count, 0);
    assert.deepEqual(game.versions, []);
  }
  assert.equal(
    response.headers.get("cross-origin-opener-policy"),
    "same-origin",
  );
  assert.equal(
    response.headers.get("cross-origin-embedder-policy"),
    "credentialless",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    response.headers.get("content-security-policy"),
    /object-src 'none'/,
  );
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(
    (await api.request("/api/games/little-green-world")).body.reviews,
    [],
  );
  assert.equal((await api.request("/api/games/missing")).status, 404);
  assert.equal((await api.request("/api/admin/content")).status, 401);
  assert.equal((await api.request("/api/admin/reviews")).status, 401);
  assert.equal((await api.upload("image", "picture.png", PNG)).status, 401);
  assert.equal((await api.request("/api/no-such-route")).status, 404);
});

test("hidden versions stay editable but are omitted from every public game response", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const game = (await api.request("/api/admin/content")).body.games[0];
  game.versions = [
    {
      id: "release-2",
      label: "v2",
      date: "2026-11-10",
      notes: "Private preview",
      webUrl: "",
      downloads: [],
      visible: false,
    },
    {
      id: "release-1",
      label: "v1",
      date: "2026-11-01",
      notes: "Public release",
      webUrl: "",
      downloads: [],
      visible: true,
    },
  ];
  assert.equal(
    (
      await api.request(`/api/admin/games/${game.id}`, {
        method: "PUT",
        body: game,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await api.request(`/api/games/${game.id}`)).body.game.versions.map(
      (version) => version.id,
    ),
    ["release-1"],
  );
  assert.deepEqual(
    (await api.request("/api/site")).body.games[0].versions.map(
      (version) => version.id,
    ),
    ["release-1"],
  );
  assert.equal(
    (await api.request("/api/admin/content")).body.games[0].versions.length,
    2,
  );
});

test("setup, login, logout, token hashing, and browser Origin protection", async (t) => {
  const api = await fixture(t);
  assert.deepEqual((await api.request("/api/auth/session")).body, {
    authenticated: false,
    setupRequired: true,
  });
  assert.equal(
    (
      await api.request("/api/auth/login", {
        method: "POST",
        body: { password: PASSWORD },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api.request("/api/auth/setup", {
        method: "POST",
        body: { token: BOOTSTRAP, password: "short" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api.request("/api/auth/setup", {
        method: "POST",
        body: { token: "wrong", password: PASSWORD },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api.request("/api/auth/setup", {
        method: "POST",
        origin: false,
        body: { token: BOOTSTRAP, password: PASSWORD },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api.request("/api/auth/setup", {
        method: "POST",
        origin: "https://untrusted.example",
        body: { token: BOOTSTRAP, password: PASSWORD },
      })
    ).status,
    403,
  );
  const setup = await api.setup();
  assert.equal(setup.status, 201);
  assert.match(setup.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(setup.headers.get("set-cookie"), /SameSite=Strict/i);
  assert.doesNotMatch(setup.headers.get("set-cookie"), /; Secure/i);
  assert.deepEqual((await api.request("/api/auth/session")).body, {
    authenticated: true,
    setupRequired: false,
  });
  const oldCookie = api.cookie;
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  const storedPassword = db
    .prepare("SELECT value FROM settings WHERE key='adminPassword'")
    .get().value;
  assert.match(storedPassword, /^scrypt\$/);
  assert.ok(!storedPassword.includes(PASSWORD));
  const storedSession = db.prepare("SELECT hash, expires FROM sessions").get();
  assert.equal(storedSession.hash.length, 64);
  assert.notEqual(storedSession.hash, oldCookie.split("=")[1]);
  assert.ok(storedSession.expires > Date.now());
  db.close();
  assert.equal((await api.setup()).status, 409);
  assert.equal((await api.request("/api/admin/content")).status, 200);
  assert.equal(
    (
      await api.request("/api/auth/logout", {
        method: "POST",
        origin: "http://localhost:5173",
      })
    ).status,
    200,
  );
  assert.equal(
    (await api.request("/api/auth/session")).body.authenticated,
    false,
  );
  assert.equal(
    (
      await api.request("/api/admin/content", {
        authenticated: false,
        headers: { Cookie: oldCookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await api.request("/api/auth/login", {
        method: "POST",
        body: { password: "incorrect-password" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await api.request("/api/auth/login", {
        method: "POST",
        body: { password: PASSWORD },
      })
    ).status,
    200,
  );
  assert.notEqual(api.cookie, oldCookie);
});

test("a random bootstrap token is printed only before an administrator exists", async (t) => {
  const messages = [];
  const previous = console.info;
  let api;
  try {
    console.info = (message) => messages.push(message);
    api = await fixture(t, { bootstrapToken: null });
  } finally {
    console.info = previous;
  }
  assert.equal(messages.length, 1);
  const token = messages[0].split(": ").at(-1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(
    !JSON.stringify((await api.request("/api/auth/session")).body).includes(
      token,
    ),
  );
  assert.equal(
    (
      await api.request("/api/auth/setup", {
        method: "POST",
        body: { token, password: PASSWORD },
      })
    ).status,
    201,
  );
  try {
    console.info = (message) => messages.push(message);
    await api.restart();
  } finally {
    console.info = previous;
  }
  assert.equal(messages.length, 1);
  assert.equal(
    (await api.request("/api/auth/session")).body.setupRequired,
    false,
  );
});

test("setup is atomic under concurrent requests", async (t) => {
  const api = await fixture(t);
  const results = await Promise.all([api.setup(), api.setup()]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
});

test("all editable content is validated, including unsafe URLs and nested fields", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const content = (await api.request("/api/admin/content")).body;
  for (const url of [
    "javascript:alert(1)",
    "//evil.example",
    "http://example.com",
    "/api/auth/logout",
    "/uploads/../api/site",
    "/uploads/%2e%2e/api/site",
    "/uploads/a\\b",
    "https://name:password@example.com",
  ]) {
    const site = structuredClone(content.site);
    site.socials.itch = url;
    assert.equal(
      (await api.request("/api/admin/site", { method: "PUT", body: site }))
        .status,
      400,
      url,
    );
  }
  const valid = structuredClone(content.site);
  valid.socials.itch = "https://example.itch.io/";
  valid.highlight.image = "/uploads/images/example/cover.png";
  valid.highlight.imagePosition = { x: 25, y: 75 };
  assert.equal(
    (await api.request("/api/admin/site", { method: "PUT", body: valid }))
      .status,
    200,
  );
  assert.deepEqual(
    (await api.request("/api/site")).body.site.highlight.imagePosition,
    { x: 25, y: 75 },
  );
  assert.equal(
    (
      await api.request("/api/admin/site", {
        method: "PUT",
        body: {
          ...valid,
          highlight: {
            ...valid.highlight,
            imagePosition: { x: 101, y: 50 },
          },
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api.request("/api/admin/site", {
        method: "PUT",
        body: { ...valid, available: "yes" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api.request("/api/admin/site", {
        method: "PUT",
        body: { ...valid, email: "not-an-email" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api.request("/api/admin/site", {
        method: "PUT",
        body: { ...valid, surprise: true },
      })
    ).status,
    400,
  );
  const game = content.games[0];
  assert.equal(
    (
      await api.request(`/api/admin/games/${game.id}`, {
        method: "PUT",
        body: { ...game, id: "different" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api.request(`/api/admin/games/${game.id}`, {
        method: "PUT",
        body: { ...game, tags: [42] },
      })
    ).status,
    400,
  );
  const version = {
    id: "v1",
    label: "0.1.0",
    date: "2026-11-10",
    notes: "",
    webUrl: "",
    downloads: [],
  };
  assert.equal(
    (
      await api.request(`/api/admin/games/${game.id}`, {
        method: "PUT",
        body: { ...game, versions: [version, version] },
      })
    ).status,
    400,
  );
  version.downloads = [
    { id: "download", label: "Windows", url: "javascript:evil()" },
  ];
  assert.equal(
    (
      await api.request(`/api/admin/games/${game.id}`, {
        method: "PUT",
        body: { ...game, versions: [version] },
      })
    ).status,
    400,
  );
  const post = content.posts[0];
  assert.equal(
    (
      await api.request(`/api/admin/posts/${post.id}`, {
        method: "PUT",
        body: { ...post, date: "2026-02-30" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api.request("/api/admin/site", {
        method: "PUT",
        body: "{",
        headers: { "Content-Type": "application/json" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api.request("/api/admin/site", {
        method: "PUT",
        body: `{"about":"${"a".repeat(1024 * 1024)}"}`,
        headers: { "Content-Type": "application/json" },
      })
    ).status,
    413,
  );
});

test("admin CRUD honors visibility and never accepts fabricated rating metrics", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const content = (await api.request("/api/admin/content")).body;
  assert.equal(content.posts.length, 3);
  const game = {
    ...content.games[0],
    id: "new-project",
    title: "My actual project",
    sample: false,
    coverPosition: { x: 25, y: 75 },
    rating: 5,
    count: 999,
  };
  const created = await api.request("/api/admin/games/new-project", {
    method: "PUT",
    body: game,
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.game.rating, 0);
  assert.equal(created.body.game.count, 0);
  assert.deepEqual(created.body.game.coverPosition, { x: 25, y: 75 });
  assert.deepEqual(
    (await api.request("/api/site")).body.games.find(
      (item) => item.id === "new-project",
    ).coverPosition,
    { x: 25, y: 75 },
  );
  assert.equal(
    (
      await api.request("/api/admin/games/new-project", {
        method: "PUT",
        body: { ...game, coverPosition: { x: -1, y: 50 } },
      })
    ).status,
    400,
  );
  assert.equal((await api.request("/api/site")).body.games.length, 4);
  assert.equal(
    (
      await api.request("/api/admin/games/new-project", {
        method: "PUT",
        body: { ...game, visible: false },
      })
    ).status,
    200,
  );
  assert.equal((await api.request("/api/site")).body.games.length, 3);
  assert.equal((await api.request("/api/games/new-project")).status, 404);
  assert.equal(
    (
      await api.request("/api/games/new-project/reviews", {
        method: "POST",
        body: validReview,
      })
    ).status,
    404,
  );
  assert.equal((await api.request("/api/admin/content")).body.games.length, 4);
  const post = { ...content.posts[0], visible: true, date: "2026-11-10" };
  assert.equal(
    (
      await api.request(`/api/admin/posts/${post.id}`, {
        method: "PUT",
        body: post,
      })
    ).status,
    200,
  );
  assert.equal((await api.request("/api/site")).body.posts.length, 1);
  assert.equal(
    (await api.request(`/api/admin/posts/${post.id}`, { method: "DELETE" }))
      .status,
    200,
  );
  assert.equal((await api.request("/api/site")).body.posts.length, 0);
  assert.equal(
    (await api.request("/api/admin/games/new-project", { method: "DELETE" }))
      .status,
    200,
  );
  assert.equal(
    (await api.request("/api/admin/games/new-project", { method: "DELETE" }))
      .status,
    404,
  );
});

test("reviews remain pending until moderation and aggregates track approval and deletion", async (t) => {
  const api = await fixture(t);
  const route = "/api/games/little-green-world";
  for (const review of [
    { ...validReview, name: "x" },
    { ...validReview, body: "tiny" },
    { ...validReview, rating: 0 },
    { ...validReview, rating: 5.5 },
    { ...validReview, body: "x".repeat(2001) },
  ]) {
    assert.equal(
      (await api.request(`${route}/reviews`, { method: "POST", body: review }))
        .status,
      400,
    );
  }
  const pending = await api.request(`${route}/reviews`, {
    method: "POST",
    body: validReview,
  });
  assert.equal(pending.status, 201);
  assert.equal(pending.body.status, "pending");
  let detail = (await api.request(route)).body;
  assert.deepEqual(detail.reviews, []);
  assert.equal(detail.game.count, 0);
  await api.setup();
  const queue = (await api.request("/api/admin/reviews")).body;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].gameId, "little-green-world");
  assert.equal(queue[0].gameTitle, "Little Green World");
  assert.equal(queue[0].status, "pending");
  assert.equal(queue[0].name, validReview.name);
  assert.ok(queue[0].date);
  const moderation = `/api/admin/reviews/${pending.body.id}`;
  assert.equal(
    (
      await api.request(moderation, {
        method: "PATCH",
        body: { status: "rejected" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api.request(moderation, {
        method: "PATCH",
        body: { status: "approved" },
      })
    ).status,
    200,
  );
  detail = (await api.request(route)).body;
  assert.equal(detail.reviews.length, 1);
  assert.equal(detail.game.rating, 4);
  assert.equal(detail.game.count, 1);
  assert.equal((await api.request("/api/site")).body.games[0].rating, 4);
  const second = await api.request(`${route}/reviews`, {
    method: "POST",
    body: { ...validReview, name: "Another visitor", rating: 5 },
  });
  await api.request(`/api/admin/reviews/${second.body.id}`, {
    method: "PATCH",
    body: { status: "approved" },
  });
  assert.equal((await api.request(route)).body.game.rating, 4.5);
  await api.request(moderation, {
    method: "PATCH",
    body: { status: "pending" },
  });
  assert.equal((await api.request(route)).body.game.rating, 5);
  await api.request(`/api/admin/reviews/${second.body.id}`, {
    method: "DELETE",
  });
  assert.equal((await api.request(route)).body.game.count, 0);
  await api.request("/api/admin/games/little-green-world", {
    method: "DELETE",
  });
  assert.equal((await api.request("/api/admin/reviews")).body.length, 0);
});

test("authentication and review endpoints are rate limited", async (t) => {
  const api = await fixture(t);
  for (let index = 0; index < 10; index += 1) {
    assert.equal(
      (
        await api.request("/api/auth/setup", {
          method: "POST",
          body: { token: "incorrect", password: PASSWORD },
        })
      ).status,
      403,
    );
  }
  const limited = await api.setup();
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  for (let index = 0; index < 10; index += 1) {
    assert.equal(
      (
        await api.request("/api/games/little-green-world/reviews", {
          method: "POST",
          body: validReview,
        })
      ).status,
      201,
    );
  }
  assert.equal(
    (
      await api.request("/api/games/little-green-world/reviews", {
        method: "POST",
        body: validReview,
      })
    ).status,
    429,
  );
});

test("images require allowed extensions and matching signatures; downloads are attachments", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const uploaded = await api.upload("image", "A nice photo.png", PNG);
  assert.equal(uploaded.status, 201);
  assert.match(
    uploaded.body.url,
    /^\/uploads\/images\/[a-f0-9-]+\/A-nice-photo\.png$/,
  );
  const image = await api.request(uploaded.body.url);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /^image\/png/);
  assert.deepEqual(image.body, PNG);
  assert.equal(
    (await api.upload("image", "picture.svg", "<svg></svg>")).status,
    400,
  );
  assert.equal(
    (await api.upload("image", "pretend.png", "<script>alert(1)</script>"))
      .status,
    400,
  );
  assert.equal((await api.upload("image", "wrong.jpg", PNG)).status, 400);
  const download = await api.upload(
    "download",
    "My installer.exe",
    Buffer.from("MZ-test-download"),
  );
  assert.equal(download.status, 201);
  const served = await api.request(download.body.url);
  assert.equal(served.status, 200);
  assert.match(
    served.headers.get("content-disposition"),
    /^attachment; filename="?My-installer\.exe"?$/,
  );
  assert.equal(served.body.toString(), "MZ-test-download");
  assert.equal(
    (await api.upload("download", "unsafe.html", "<html></html>")).status,
    400,
  );
  assert.deepEqual(await readdir(path.join(api.dataDir, "tmp")), []);
});

test("Godot ZIP builds support root or enclosing-folder exports and correct MIME types", async (t) => {
  const api = await fixture(t);
  await api.setup();
  for (const prefix of ["", "My Godot Export/"]) {
    const build = zip([
      ...(prefix ? [{ name: prefix }] : []),
      {
        name: `${prefix}index.html`,
        body: '<html><script src="game.js"></script><canvas></canvas></html>',
      },
      {
        name: `${prefix}game.js`,
        body: 'console.log("sample export fixture")',
        compressed: true,
      },
      { name: `${prefix}game.worker.js`, body: "self.onmessage = () => {}" },
      {
        name: `${prefix}game.wasm`,
        body: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
      },
      { name: `${prefix}game.pck`, body: "test pack" },
      { name: `${prefix}assets/icon.png`, body: PNG },
    ]);
    const uploaded = await api.upload("build", "export.zip", build);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    assert.match(
      uploaded.body.url,
      /^\/uploads\/builds\/[a-f0-9-]+\/index\.html$/,
    );
    const html = await api.request(uploaded.body.url);
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-type"), /^text\/html/);
    assert.match(
      html.headers.get("content-security-policy"),
      /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/,
    );
    assert.equal(
      html.headers.get("cross-origin-embedder-policy"),
      "credentialless",
    );
    assert.equal(
      (
        await api.request(uploaded.body.url.replace("index.html", "game.wasm"))
      ).headers.get("content-type"),
      "application/wasm",
    );
    assert.equal(
      (
        await api.request(uploaded.body.url.replace("index.html", "game.pck"))
      ).headers.get("content-type"),
      "application/octet-stream",
    );
    assert.equal(
      (
        await api.request(
          uploaded.body.url.replace("/uploads/builds/", "/games/"),
        )
      ).status,
      200,
    );
  }
  assert.equal(
    (await readdir(path.join(api.dataDir, "uploads", "builds"))).length,
    2,
  );
  assert.deepEqual(await readdir(path.join(api.dataDir, "tmp")), []);
});

test("ZIP traversal, symlinks, duplicate normalized paths, executable scripts, and bombs are rejected", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const index = { name: "index.html", body: "<html>test</html>" };
  const cases = [
    [{ name: "../escaped.txt", body: "escape" }],
    [{ name: "/absolute.txt", body: "escape" }],
    [{ name: "C:/outside.txt", body: "escape" }],
    [{ name: "folder\\..\\outside.txt", body: "escape" }],
    [{ name: "link.txt", body: "../../outside.txt", mode: 0o120777 }],
    [index],
    [{ name: "INDEX.html", body: "duplicate" }],
    [
      { name: "café.txt", body: "first" },
      { name: "cafe\u0301.txt", body: "second" },
    ],
    [
      { name: "assets/A.txt", body: "first" },
      { name: "Assets/B.txt", body: "second" },
    ],
    [
      { name: "file.txt", body: "first" },
      { name: "file.txt/child.js", body: "second" },
    ],
    [{ name: "bad.php", body: "<?php dangerous();" }],
    [{ name: ".env", body: "SECRET=value" }],
    [{ name: "AUX.txt", body: "reserved device" }],
    [{ name: "trailing./test.js", body: "unsafe directory" }],
    [{ name: "encrypted.js", body: "secret", encrypted: true }],
    [
      {
        name: "bomb.wasm",
        body: Buffer.alloc(2 * 1024 * 1024),
        compressed: true,
      },
    ],
  ];
  for (const entries of cases) {
    const response = await api.upload(
      "build",
      "unsafe.zip",
      zip([index, ...entries]),
    );
    assert.equal(
      response.status,
      400,
      `${entries.map((entry) => entry.name).join(", ")}: ${JSON.stringify(response.body)}`,
    );
    assert.ok(!JSON.stringify(response.body).includes(api.dataDir));
    assert.deepEqual(await readdir(path.join(api.dataDir, "tmp")), []);
    assert.deepEqual(
      await readdir(path.join(api.dataDir, "uploads", "builds")),
      [],
    );
  }
  assert.equal(
    (
      await api.upload(
        "build",
        "missing-index.zip",
        zip([{ name: "game.js", body: "test" }]),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api.upload(
        "build",
        "two-roots.zip",
        zip([{ name: "one/index.html" }, { name: "two/game.js" }]),
      )
    ).status,
    400,
  );
  assert.equal(
    (await api.upload("build", "broken.zip", "not a ZIP")).status,
    400,
  );
  const manyEntries = Array.from({ length: 4097 }, (_, number) => ({
    name: `${number}.txt`,
  }));
  assert.equal(
    (await api.upload("build", "too-many.zip", zip(manyEntries))).status,
    400,
  );
  assert.ok(!(await readdir(api.dataDir)).includes("escaped.txt"));
});

test("upload size, extraction size, missing fields, and malformed multipart errors are clear", async (t) => {
  const api = await fixture(t, {
    env: { MAX_UPLOAD_MB: "1", MAX_BUILD_EXTRACTED_MB: "0.001" },
  });
  await api.setup();
  const oversized = await api.upload(
    "download",
    "large.zip",
    Buffer.alloc(1024 * 1024 + 1),
  );
  assert.equal(oversized.status, 413);
  assert.match(oversized.body.error, /upload limit/);
  assert.equal(
    (
      await api.upload(
        "build",
        "large-output.zip",
        zip([{ name: "index.html", body: "x".repeat(1500) }]),
      )
    ).status,
    400,
  );
  assert.equal((await api.upload("unknown", "file.png", PNG)).status, 400);
  assert.equal(
    (
      await api.request("/api/admin/uploads?kind=image", {
        method: "POST",
        body: new FormData(),
      })
    ).status,
    400,
  );
  const wrongField = new FormData();
  wrongField.append("not-file", new Blob([PNG]), "image.png");
  assert.equal(
    (
      await api.request("/api/admin/uploads?kind=image", {
        method: "POST",
        body: wrongField,
      })
    ).status,
    400,
  );
  const multiple = new FormData();
  multiple.append("file", new Blob([PNG]), "one.png");
  multiple.append("file", new Blob([PNG]), "two.png");
  assert.equal(
    (
      await api.request("/api/admin/uploads?kind=image", {
        method: "POST",
        body: multiple,
      })
    ).status,
    400,
  );
  const malformed = await api.request("/api/admin/uploads?kind=image", {
    method: "POST",
    body: "not a valid multipart body",
    headers: { "Content-Type": "multipart/form-data; boundary=absent" },
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await readdir(path.join(api.dataDir, "tmp")), []);
});

test("site edits, administrator, sessions, deletions, and uploaded files survive restart", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const content = (await api.request("/api/admin/content")).body;
  content.site.name = "My persistent studio";
  await api.request("/api/admin/site", { method: "PUT", body: content.site });
  await api.request("/api/admin/games/after-the-rain", { method: "DELETE" });
  const upload = await api.upload("image", "persistent.png", PNG);
  await api.restart();
  assert.deepEqual((await api.request("/api/auth/session")).body, {
    authenticated: true,
    setupRequired: false,
  });
  const persisted = (await api.request("/api/site")).body;
  assert.equal(persisted.site.name, "My persistent studio");
  assert.equal(persisted.games.length, 2);
  assert.equal((await api.request(upload.body.url)).status, 200);
  assert.equal((await api.setup()).status, 409);
  const separate = await fixture(t);
  assert.equal(
    (await separate.request("/api/site")).body.site.name,
    "KhoifeeDev",
  );
  assert.equal((await separate.request("/api/site")).body.games.length, 3);
  assert.equal(
    (await separate.request("/api/auth/session")).body.setupRequired,
    true,
  );
});

test("expired session tokens cannot access admin routes", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  db.prepare("UPDATE sessions SET expires = ?").run(Date.now() - 1);
  db.close();
  assert.equal(
    (await api.request("/api/auth/session")).body.authenticated,
    false,
  );
  assert.equal((await api.request("/api/admin/content")).status, 401);
});

test("production rejects development origins and secures cookies on trusted HTTPS", async (t) => {
  const api = await fixture(t, { production: true, env: { TRUST_PROXY: "1" } });
  assert.equal(
    (
      await api.request("/api/auth/setup", {
        method: "POST",
        origin: "http://localhost:5173",
        body: { token: BOOTSTRAP, password: PASSWORD },
      })
    ).status,
    403,
  );
  const response = await api.request("/api/auth/setup", {
    method: "POST",
    origin: api.base.replace("http:", "https:"),
    headers: { "X-Forwarded-Proto": "https" },
    body: { token: BOOTSTRAP, password: PASSWORD },
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /; Secure/);
  assert.doesNotMatch(
    response.headers.get("content-security-policy"),
    /ws:\/\/localhost/,
  );
});

const zeroMetrics = {
  siteViews: 0, gameViews: 0, playStarts: 0, downloadClicks: 0, postViews: 0,
};
const event = (api, body, options = {}) => api.request("/api/events", {
  method: "POST", authenticated: false, body, ...options,
});
const insights = async (api, days) => (await api.request(
  `/api/admin/analytics${days === undefined ? "" : `?days=${days}`}`,
)).body;
async function analyticsContent(api) {
  await api.setup();
  const content = (await api.request("/api/admin/content")).body;
  const game = content.games[0];
  game.versions = [
    { id: "v1", label: "v1", date: "2026-11-01", notes: "", visible: true,
      webUrl: "/uploads/builds/test/index.html", downloads: [
        { id: "windows", label: "Windows", url: "/uploads/downloads/test/game.zip" },
        { id: "linux", label: "Linux", url: "/uploads/downloads/test/game.tar.gz" },
      ] },
    { id: "v2", label: "v2", date: "2026-11-02", notes: "", visible: true,
      webUrl: "/uploads/builds/test2/index.html", downloads: [
        { id: "mac", label: "macOS", url: "/uploads/downloads/test/game.dmg" },
      ] },
    { id: "hidden", label: "hidden", date: "", notes: "", visible: false,
      webUrl: "/uploads/builds/hidden/index.html", downloads: [
        { id: "hidden-download", label: "Private", url: "/uploads/downloads/private.zip" },
      ] },
    { id: "empty", label: "empty", date: "", notes: "", visible: true,
      webUrl: "", downloads: [{ id: "empty-download", label: "Empty", url: "" }] },
  ];
  assert.equal((await api.request(`/api/admin/games/${game.id}`, {
    method: "PUT", body: game,
  })).status, 200);
  const post = { ...content.posts[0], visible: true };
  assert.equal((await api.request(`/api/admin/posts/${post.id}`, {
    method: "PUT", body: post,
  })).status, 200);
  return { game, post, content };
}

test("analytics is private, zero-filled, UTC chronological, and accepts only supported ranges", async (t) => {
  const api = await fixture(t, { now: () => Date.parse("2026-03-01T00:15:00Z") });
  assert.equal((await api.request("/api/admin/analytics")).status, 401);
  await api.setup();
  for (const days of [7, 30, 90]) {
    const response = await api.request(`/api/admin/analytics?days=${days}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = response.body;
    assert.equal(data.days, days);
    assert.equal(data.endDate, "2026-03-01");
    assert.equal(data.startDate, new Date(Date.parse("2026-03-01") - (days - 1) * 86400000).toISOString().slice(0, 10));
    assert.equal(data.daily.length, days);
    assert.equal(data.daily[0].date, data.startDate);
    assert.equal(data.daily.at(-1).date, data.endDate);
    assert.deepEqual(data.totals, zeroMetrics);
    assert.deepEqual(data.daily.map(({ date, ...metrics }) => metrics), Array(days).fill(zeroMetrics));
    assert.deepEqual(data.daily.map(({ date }) => date), data.daily.map(({ date }) => date).sort());
    assert.equal(data.games.length, 3);
    assert.equal(data.posts.length, 3);
    for (const game of data.games) {
      assert.equal(game.views + game.playStarts + game.downloadClicks + game.rating + game.ratingCount + game.pendingReviews, 0);
    }
    assert.ok(data.posts.every((post) => !post.visible && post.views === 0));
    assert.deepEqual(data.ratings, { average: 0, count: 0, pending: 0 });
    assert.doesNotMatch(JSON.stringify(data), /visitId|hash|analyticsSecret/);
  }
  assert.equal((await insights(api)).days, 30);
  for (const query of ["0", "1", "8", "31", "91", "-7", "7.0", "07", "all", "", "7&days=30", "7&days[x]=7"]) {
    assert.equal((await api.request(`/api/admin/analytics?days=${query}`)).status, 400, query);
  }
});

test("analytics dedupes concurrent views, separates targets and tabs, and survives restart privately", async (t) => {
  const time = Date.parse("2026-11-10T12:00:10Z");
  const api = await fixture(t, { now: () => time });
  const { game, post, content } = await analyticsContent(api);
  const visitId = randomUUID();
  const payload = { type: "site_view", targetId: "home", visitId };
  const before = (await api.request("/api/site")).body;
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => event(api, payload)));
  assert.ok(duplicates.every((result) => result.status === 204 && result.body.length === 0));
  assert.ok(duplicates.every((result) => !result.headers.has("set-cookie")));
  assert.equal((await event(api, { ...payload, visitId: visitId.toUpperCase() })).status, 204);
  for (const body of [
    { type: "game_view", targetId: game.id, visitId },
    { type: "game_view", targetId: game.id, visitId, versionId: "v1" },
    { type: "game_view", targetId: game.id, visitId: randomUUID() },
    { type: "game_view", targetId: content.games[1].id, visitId },
    { type: "post_view", targetId: post.id, visitId },
    { type: "post_view", targetId: post.id, visitId },
  ]) assert.equal((await event(api, body)).status, 204);
  const data = await insights(api);
  assert.deepEqual(data.totals, { ...zeroMetrics, siteViews: 1, gameViews: 3, postViews: 1 });
  assert.equal(data.games.find((item) => item.id === game.id).views, 2);
  assert.equal(data.posts.find((item) => item.id === post.id).views, 1);
  assert.deepEqual((await api.request("/api/site")).body, before);
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  const secret = db.prepare("SELECT value FROM settings WHERE key = 'analyticsSecret'").get().value;
  assert.match(secret, /^[a-f0-9]{64}$/);
  const rows = db.prepare("SELECT * FROM analytics_dedupe").all();
  assert.equal(rows.length, 5);
  const expectedHash = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(JSON.stringify([visitId, "site_view", "home", null, null, Math.floor(time / 86400000)]))
    .digest("hex");
  assert.ok(rows.some((row) => row.hash === expectedHash));
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["expires", "hash"]);
    assert.match(row.hash, /^[a-f0-9]{64}$/);
    assert.notEqual(row.hash, createHash("sha256").update(visitId).digest("hex"));
    assert.ok(row.expires > time && row.expires <= time + 48 * 60 * 60 * 1000);
  }
  assert.deepEqual(db.prepare("PRAGMA table_info(analytics_daily)").all().map((row) => row.name), ["date", "type", "target_id", "count"]);
  db.close();
  await api.restart();
  assert.equal((await event(api, payload)).status, 204);
  assert.deepEqual(await insights(api), data);
  for (const name of await readdir(api.dataDir)) {
    if (name.startsWith("khoifee.sqlite")) {
      const bytes = await readFile(path.join(api.dataDir, name));
      assert.equal(bytes.includes(Buffer.from(visitId)), false, name);
    }
  }
});

test("analytics buckets actions by version and download per minute and views by UTC day", async (t) => {
  let time = Date.parse("2026-11-10T23:59:30Z");
  const api = await fixture(t, { now: () => time });
  const { game } = await analyticsContent(api);
  const visitId = randomUUID();
  const view = { type: "game_view", targetId: game.id, visitId };
  const play = { ...view, type: "play", versionId: "v1" };
  const download = { ...view, type: "download", versionId: "v1", downloadId: "windows" };
  for (const payload of [view, view, play, play, { ...play, versionId: "v2" },
    download, download, { ...download, downloadId: "linux" }]) {
    assert.equal((await event(api, payload)).status, 204);
  }
  assert.deepEqual((await insights(api)).totals, { ...zeroMetrics, gameViews: 1, playStarts: 2, downloadClicks: 2 });
  time = Date.parse("2026-11-11T00:00:00Z");
  for (const payload of [view, view, play, download]) assert.equal((await event(api, payload)).status, 204);
  let data = await insights(api, 7);
  assert.deepEqual(data.totals, { ...zeroMetrics, gameViews: 2, playStarts: 3, downloadClicks: 3 });
  assert.deepEqual(data.daily.at(-2), { date: "2026-11-10", ...zeroMetrics, gameViews: 1, playStarts: 2, downloadClicks: 2 });
  assert.deepEqual(data.daily.at(-1), { date: "2026-11-11", ...zeroMetrics, gameViews: 1, playStarts: 1, downloadClicks: 1 });
  time += 60000;
  for (const payload of [view, play, download]) assert.equal((await event(api, payload)).status, 204);
  data = await insights(api, 7);
  assert.deepEqual(data.totals, { ...zeroMetrics, gameViews: 2, playStarts: 4, downloadClicks: 4 });
  time += 49 * 60 * 60 * 1000;
  await api.restart();
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM analytics_dedupe").get().count, 0);
  assert.equal(db.prepare("SELECT SUM(count) AS count FROM analytics_daily").get().count, 10);
  db.close();
  assert.deepEqual((await insights(api, 7)).totals, data.totals);
});

test("analytics skips administrators and privacy opt-outs, honors Origin, and requires no cookie", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const payload = { type: "site_view", targetId: "home", visitId: randomUUID() };
  for (const options of [
    { authenticated: true },
    { headers: { DNT: "1" } },
    { headers: { "Sec-GPC": "1" } },
  ]) {
    assert.equal((await event(api, payload, options)).status, 204);
    assert.equal((await event(api, { invalid: "intentionally ignored" }, options)).status, 204);
  }
  assert.deepEqual((await insights(api)).totals, zeroMetrics);
  for (const origin of [false, "https://untrusted.example"]) {
    assert.equal((await event(api, payload, { origin })).status, 403);
    assert.equal((await event(api, payload, { origin, headers: { DNT: "1" } })).status, 403);
  }
  const response = await event(api, payload, {
    headers: { DNT: "0", "Sec-GPC": "0", "User-Agent": "private-agent-test", Referer: "https://private.example/secret" },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal((await insights(api)).totals.siteViews, 1);
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  const analytics = JSON.stringify(db.prepare("SELECT * FROM analytics_daily").all()) + JSON.stringify(db.prepare("SELECT * FROM analytics_dedupe").all());
  assert.doesNotMatch(analytics, /private-agent-test|private\.example|127\.0\.0\.1/);
  db.prepare("UPDATE sessions SET expires = ?").run(Date.now() - 1);
  db.close();
  assert.equal((await event(api, { ...payload, visitId: randomUUID() }, { authenticated: true })).status, 204);
  await api.request("/api/auth/login", { method: "POST", body: { password: PASSWORD } });
  assert.equal((await insights(api)).totals.siteViews, 2);
});

test("analytics rejects malformed, nonexistent, hidden, and unavailable action targets", async (t) => {
  const api = await fixture(t);
  const { game, post, content } = await analyticsContent(api);
  const hidden = { ...content.games[1], visible: false };
  await api.request(`/api/admin/games/${hidden.id}`, { method: "PUT", body: hidden });
  const visitId = randomUUID();
  const view = { type: "game_view", targetId: game.id, visitId };
  const cases = [
    [{}, 400], [{ ...view, type: "unknown" }, 400],
    [{ ...view, targetId: "a".repeat(81) }, 400],
    [{ ...view, visitId: "not-a-uuid" }, 400],
    [{ ...view, visitId: "x".repeat(10000) }, 400],
    [{ ...view, versionId: "../version" }, 400],
    [{ ...view, downloadId: 3 }, 400],
    [{ ...view, referrer: "https://example.com" }, 400],
    [{ ...view, type: "site_view", targetId: game.id }, 400],
    [{ ...view, targetId: "missing" }, 404],
    [{ ...view, targetId: hidden.id }, 404],
    [{ ...view, type: "post_view", targetId: "missing" }, 404],
    [{ ...view, type: "post_view", targetId: content.posts[1].id }, 404],
    [{ ...view, type: "play" }, 400],
    [{ ...view, type: "play", versionId: "missing" }, 404],
    [{ ...view, type: "play", versionId: "hidden" }, 404],
    [{ ...view, type: "play", versionId: "empty" }, 404],
    [{ ...view, type: "download", versionId: "v1" }, 400],
    [{ ...view, type: "download", downloadId: "windows" }, 400],
    [{ ...view, type: "download", versionId: "v2", downloadId: "windows" }, 404],
    [{ ...view, type: "download", versionId: "hidden", downloadId: "hidden-download" }, 404],
    [{ ...view, type: "download", versionId: "empty", downloadId: "empty-download" }, 404],
    [{ ...view, type: "download", versionId: "v1", downloadId: "missing" }, 404],
    [{ ...view, type: "play", targetId: hidden.id, versionId: "v1" }, 404],
    [{ ...view, type: "game_view", targetId: post.id }, 404],
  ];
  for (const [payload, status] of cases) assert.equal((await event(api, payload)).status, status, JSON.stringify(payload));
  assert.deepEqual((await insights(api)).totals, zeroMetrics);
});

test("analytics limits anonymous submissions to sixty per IP per minute", async (t) => {
  const api = await fixture(t);
  const payload = { type: "site_view", targetId: "home", visitId: randomUUID() };
  for (let index = 0; index < 60; index += 1) assert.equal((await event(api, payload)).status, 204);
  const response = await event(api, { ...payload, visitId: randomUUID() });
  assert.equal(response.status, 429);
  assert.ok(response.headers.get("retry-after"));
  assert.equal((await api.request("/api/site")).status, 200);
  await api.setup();
  assert.equal((await event(api, payload, { authenticated: true })).status, 204);
  assert.equal((await event(api, payload, { headers: { DNT: "1" } })).status, 204);
  assert.equal((await insights(api)).totals.siteViews, 1);
});

test("analytics keeps historical totals for deleted targets and filters dates without backfill", async (t) => {
  let time = Date.parse("2026-01-01T12:00:00Z");
  const api = await fixture(t, { now: () => time });
  const { game, post } = await analyticsContent(api);
  for (const [type, targetId] of [["site_view", "home"], ["game_view", game.id], ["post_view", post.id]]) {
    assert.equal((await event(api, { type, targetId, visitId: randomUUID() })).status, 204);
  }
  time = Date.parse("2026-01-31T12:00:00Z");
  await api.request(`/api/admin/games/${game.id}`, { method: "DELETE" });
  await api.request(`/api/admin/posts/${post.id}`, { method: "DELETE" });
  assert.deepEqual((await insights(api, 30)).totals, zeroMetrics);
  assert.deepEqual((await insights(api, 7)).totals, zeroMetrics);
  let data = await insights(api, 90);
  assert.deepEqual(data.totals, { ...zeroMetrics, siteViews: 1, gameViews: 1, postViews: 1 });
  assert.ok(!data.games.some((item) => item.id === game.id));
  assert.ok(!data.posts.some((item) => item.id === post.id));
  assert.equal(data.daily.find((row) => row.date === "2026-01-01").gameViews, 1);
  time = Date.parse("2027-01-31T12:00:00Z");
  await api.restart();
  data = await insights(api, 90);
  assert.deepEqual(data.totals, zeroMetrics);
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  assert.equal(db.prepare("SELECT SUM(count) AS count FROM analytics_daily").get().count, 3);
  db.close();
});

test("analytics ratings use all-time approved reviews, weighted averages, and pending counts", async (t) => {
  const api = await fixture(t, { now: () => Date.parse("2026-11-10T12:00:00Z") });
  await api.setup();
  const content = (await api.request("/api/admin/content")).body;
  const [first, second] = content.games;
  const reviews = [];
  for (const [gameId, rating, approved] of [[first.id, 5, true], [first.id, 5, true], [first.id, 1, false], [second.id, 2, true], [second.id, 1, false]]) {
    const response = await api.request(`/api/games/${gameId}/reviews`, {
      method: "POST", authenticated: false, body: { ...validReview, rating },
    });
    assert.equal(response.status, 201);
    reviews.push(response.body.id);
    if (approved) await api.request(`/api/admin/reviews/${response.body.id}`, {
      method: "PATCH", body: { status: "approved" },
    });
  }
  await api.request(`/api/admin/games/${second.id}`, {
    method: "PUT", body: { ...second, visible: false, rating: 5, count: 999 },
  });
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  db.prepare("UPDATE reviews SET date = '2020-01-01T00:00:00Z'").run();
  db.close();
  for (const days of [7, 30, 90]) {
    const data = await insights(api, days);
    assert.deepEqual(data.ratings, { average: 4, count: 3, pending: 2 });
    const a = data.games.find((game) => game.id === first.id);
    const b = data.games.find((game) => game.id === second.id);
    assert.equal(a.rating, 5);
    assert.equal(a.ratingCount, 2);
    assert.equal(a.pendingReviews, 1);
    assert.equal(b.rating, 2);
    assert.equal(b.ratingCount, 1);
    assert.equal(b.pendingReviews, 1);
    assert.equal(b.visible, false);
    assert.deepEqual(data.totals, zeroMetrics);
  }
  await api.request(`/api/admin/reviews/${reviews[3]}`, { method: "DELETE" });
  assert.deepEqual((await insights(api)).ratings, { average: 5, count: 2, pending: 2 });
  await api.request(`/api/admin/reviews/${reviews[0]}`, { method: "PATCH", body: { status: "pending" } });
  assert.deepEqual((await insights(api)).ratings, { average: 5, count: 1, pending: 3 });
});

test("analytics dedupe and increment roll back together on an aggregate failure", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  db.exec("CREATE TRIGGER fail_analytics BEFORE INSERT ON analytics_daily BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  const payload = { type: "site_view", targetId: "home", visitId: randomUUID() };
  assert.equal((await event(api, payload)).status, 500);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM analytics_dedupe").get().count, 0);
  db.exec("DROP TRIGGER fail_analytics");
  db.close();
  assert.equal((await event(api, payload)).status, 204);
  assert.equal((await insights(api)).totals.siteViews, 1);
});

async function importArchive(api, entries = [{ name: "index.html", body: "<html>test</html>" }]) {
  const archivePath = path.join(api.dataDir, `${randomUUID()}.zip`);
  const bytes = zip(entries);
  await writeFile(archivePath, bytes);
  return { archivePath, bytes };
}

test("build importer makes a hidden nonsample draft with real splash and preserves its source", async (t) => {
  const api = await fixture(t);
  const { archivePath, bytes } = await importArchive(api, [
    { name: "POSTJAMPLS/index.html", body: "<html><title>Padayon, Lupang Sinilangan</title></html>" },
    { name: "POSTJAMPLS/index.js", body: "console.log('export')" },
    { name: "POSTJAMPLS/index.wasm", body: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]) },
    { name: "POSTJAMPLS/index.pck", body: "test pack" },
    { name: "POSTJAMPLS/index.png", body: PNG },
  ]);
  const before = (await api.request("/api/site")).body;
  const { game, version } = await importBuild({ archivePath, dataDir: api.dataDir, title: "Padayon, Lupang Sinilangan" });
  assert.equal(game.id, "padayon-lupang-sinilangan");
  assert.equal(game.title, "Padayon, Lupang Sinilangan");
  assert.equal(game.summary, "A Godot game by KhoifeeDev.");
  assert.equal(game.description, "Project details coming soon.");
  assert.equal(game.genre, "Game");
  assert.equal(game.status, "In development");
  assert.equal(game.year, new Date().getUTCFullYear());
  assert.equal(game.visible, false);
  assert.equal(game.sample, false);
  assert.equal(game.featured, false);
  assert.deepEqual(game.controls, []);
  assert.deepEqual(game.tags, []);
  assert.equal(version.label, "v1.0.0");
  assert.equal(version.visible, true);
  assert.equal(version.date, new Date().toISOString().slice(0, 10));
  assert.deepEqual(version.downloads, []);
  assert.equal(game.versions.length, 1);
  assert.match(version.webUrl, /^\/uploads\/builds\/[a-f0-9-]{36}\/index\.html$/);
  assert.equal(game.cover, version.webUrl.replace("index.html", "index.png"));
  assert.equal((await api.request(version.webUrl)).status, 200);
  assert.deepEqual((await api.request(game.cover)).body, PNG);
  assert.deepEqual(await readFile(archivePath), bytes);
  assert.deepEqual((await api.request("/api/site")).body, before);
  assert.equal((await api.request(`/api/games/${game.id}`)).status, 404);
  assert.deepEqual((await api.request("/api/auth/session")).body, { authenticated: false, setupRequired: true });
  await api.setup();
  assert.deepEqual((await api.request("/api/admin/content")).body.games.find((item) => item.id === game.id), game);
  const another = await importBuild({ archivePath, dataDir: api.dataDir, title: game.title });
  assert.equal(another.game.id, "padayon-lupang-sinilangan-2");
  assert.notEqual(another.version.webUrl, version.webUrl);
  assert.deepEqual(await readdir(path.join(api.dataDir, "tmp")), []);
  await api.restart();
  assert.equal((await api.request(version.webUrl)).status, 200);
});

test("build importer preserves existing content, visibility and credentials, and rejects duplicate labels", async (t) => {
  const api = await fixture(t);
  const { game } = await analyticsContent(api);
  const { archivePath, bytes } = await importArchive(api);
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  const credentials = db.prepare("SELECT value FROM settings WHERE key = 'adminPassword'").get().value;
  const { game: imported, version } = await importBuild({
    archivePath, dataDir: api.dataDir, gameId: game.id, title: "Do not rename", version: "v3.0.0",
  });
  assert.deepEqual({ ...imported, versions: game.versions }, game);
  assert.equal(imported.versions.length, game.versions.length + 1);
  assert.deepEqual(imported.versions.slice(1), game.versions);
  assert.equal(imported.visible, true);
  assert.equal(version.label, "v3.0.0");
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'adminPassword'").get().value, credentials);
  db.close();
  assert.equal((await api.request("/api/auth/session")).body.authenticated, true);
  const builds = await readdir(path.join(api.dataDir, "uploads", "builds"));
  await assert.rejects(importBuild({ archivePath, dataDir: api.dataDir, gameId: game.id, version: "V3.0.0" }), /already exists/);
  await assert.rejects(importBuild({ archivePath, dataDir: api.dataDir, gameId: "missing" }), /Game not found/);
  await assert.rejects(importBuild({ archivePath, dataDir: api.dataDir }), /--title is required/);
  assert.deepEqual(await readdir(path.join(api.dataDir, "uploads", "builds")), builds);
  assert.deepEqual(await readdir(path.join(api.dataDir, "tmp")), []);
  assert.deepEqual(await readFile(archivePath), bytes);
  assert.deepEqual((await api.request(`/api/games/${game.id}`)).body.game.versions.map((item) => item.id), imported.versions.filter((item) => item.visible).map((item) => item.id));
});

test("build importer rejects unsafe archives and cleans only its own extraction directories", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const before = (await api.request("/api/admin/content")).body;
  const unrelated = path.join(api.dataDir, "tmp", "another-upload");
  await mkdir(unrelated);
  await writeFile(path.join(unrelated, "keep.txt"), "keep");
  for (const entries of [
    [{ name: "index.html" }, { name: "../escape.js", body: "escape" }],
    [{ name: "index.html" }, { name: "link.js", body: "../../secret", mode: 0o120777 }],
    [{ name: "index.html" }, { name: "INDEX.html" }],
    [{ name: "index.html" }, { name: "server.php", body: "unsafe" }],
    [{ name: "folder/game.js", body: "missing index" }],
  ]) {
    const { archivePath, bytes } = await importArchive(api, entries);
    await assert.rejects(importBuild({ archivePath, dataDir: api.dataDir, title: "Unsafe export" }));
    assert.deepEqual(await readFile(archivePath), bytes);
    assert.deepEqual(await readdir(path.join(api.dataDir, "tmp")), ["another-upload"]);
    assert.deepEqual(await readdir(path.join(api.dataDir, "uploads", "builds")), []);
    assert.deepEqual((await api.request("/api/admin/content")).body, before);
  }
  assert.equal(await readFile(path.join(unrelated, "keep.txt"), "utf8"), "keep");
  assert.ok(!(await readdir(api.dataDir)).includes("escape.js"));
});

test("build importer removes its own published directory if the database write fails", async (t) => {
  const api = await fixture(t);
  await api.setup();
  const { archivePath, bytes } = await importArchive(api);
  const before = (await api.request("/api/admin/content")).body;
  const existingBuild = path.join(api.dataDir, "uploads", "builds", "keep-existing");
  await mkdir(existingBuild);
  await writeFile(path.join(existingBuild, "index.html"), "keep");
  const db = new DatabaseSync(path.join(api.dataDir, "khoifee.sqlite"));
  db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON games BEGIN SELECT RAISE(ABORT, 'test import failure'); END;");
  await assert.rejects(importBuild({ archivePath, dataDir: api.dataDir, title: "Failed import" }), /test import failure/);
  db.exec("DROP TRIGGER fail_import");
  db.close();
  assert.deepEqual(await readdir(path.join(api.dataDir, "uploads", "builds")), ["keep-existing"]);
  assert.equal(await readFile(path.join(existingBuild, "index.html"), "utf8"), "keep");
  assert.deepEqual(await readdir(path.join(api.dataDir, "tmp")), []);
  assert.deepEqual(await readFile(archivePath), bytes);
  assert.deepEqual((await api.request("/api/admin/content")).body, before);
});

test("build import CLI parses options, respects DATA_DIR and configured size caps, and closes SQLite", async (t) => {
  const api = await fixture(t);
  const { archivePath, bytes } = await importArchive(api, [{ name: "index.html", body: "x".repeat(2000) }]);
  const cli = fileURLToPath(new URL("../server/import-build.mjs", import.meta.url));
  const exec = promisify(execFile);
  const args = ["--experimental-sqlite", cli, archivePath, "--title", "A CLI Draft"];
  const env = { ...process.env, DATA_DIR: api.dataDir, MAX_UPLOAD_MB: "250", MAX_BUILD_EXTRACTED_MB: "512" };
  for (const [key, value, message] of [
    ["MAX_UPLOAD_MB", "0.001", /upload limit/],
    ["MAX_BUILD_EXTRACTED_MB", "0.001", /extracted size/],
  ]) {
    await assert.rejects(exec(process.execPath, args, { env: { ...env, [key]: value } }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, message);
      return true;
    });
    assert.deepEqual(await readFile(archivePath), bytes);
    assert.deepEqual(await readdir(path.join(api.dataDir, "tmp")), []);
    assert.deepEqual(await readdir(path.join(api.dataDir, "uploads", "builds")), []);
  }
  const output = await exec(process.execPath, args, { env });
  assert.match(output.stdout, /Imported game: a-cli-draft/);
  assert.match(output.stdout, /Title: A CLI Draft/);
  assert.match(output.stdout, /Status: hidden draft/);
  assert.match(output.stdout, /Version: v1\.0\.0/);
  assert.match(output.stdout, /Web URL: \/uploads\/builds\//);
  assert.match(output.stdout, /Studio/);
  assert.doesNotMatch(output.stdout, /setup token/);
  await api.setup();
  let draft = (await api.request("/api/admin/content")).body.games.find((game) => game.id === "a-cli-draft");
  assert.equal(draft.cover, "/art/greenhouse.svg");
  assert.equal(draft.visible, false);
  const second = await exec(process.execPath, ["--experimental-sqlite", cli, archivePath, "--game", draft.id, "--version", "v2.0.0"], { env });
  assert.match(second.stdout, /Version: v2\.0\.0/);
  draft = (await api.request("/api/admin/content")).body.games.find((game) => game.id === draft.id);
  assert.deepEqual(draft.versions.map((version) => version.label), ["v2.0.0", "v1.0.0"]);
  assert.equal(draft.visible, false);
  assert.deepEqual(await readFile(archivePath), bytes);
  const help = await exec(process.execPath, ["--experimental-sqlite", cli, "--help"], { env });
  assert.match(help.stdout, /Usage:/);
  await assert.rejects(exec(process.execPath, ["--experimental-sqlite", cli, archivePath, "--unknown"], { env }), (error) => error.code === 1);
});
