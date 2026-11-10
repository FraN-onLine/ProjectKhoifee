import express from "express";
import multer from "multer";
import yauzl from "yauzl";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createStorage } from "./storage.mjs";

const projectDir = fileURLToPath(new URL("../", import.meta.url));
const scryptAsync = promisify(scrypt);
const MB = 1024 * 1024;
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "khoifee_session";
const MAX_ZIP_ENTRIES = 4096;
const MAX_COMPRESSION_RATIO = 200;
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const downloadExtensions = new Set([
  ".zip",
  ".exe",
  ".apk",
  ".aab",
  ".ipa",
  ".pck",
  ".dmg",
  ".7z",
  ".rar",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".msi",
  ".msix",
  ".appimage",
  ".deb",
  ".rpm",
  ".pkg",
  ".bin",
  ".pdf",
]);
const buildExtensions = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".wasm",
  ".pck",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".ico",
  ".json",
  ".css",
  ".txt",
  ".webmanifest",
  ".manifest",
  ".map",
  ".bin",
  ".data",
  ".pack",
  ".ogg",
  ".mp3",
  ".wav",
  ".mp4",
  ".webm",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".basis",
  ".ktx",
  ".ktx2",
  ".res",
  ".tres",
  ".tscn",
  ".scn",
  ".import",
  ".remap",
  ".translation",
  ".csv",
  ".xml",
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sameSecret = (a, b) =>
  timingSafeEqual(Buffer.from(hash(a), "hex"), Buffer.from(hash(b), "hex"));
const text = (max, min = 0) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
      "Control characters are not allowed",
    );
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);

function safeUrl(value) {
  if (value === "") return true;
  if (/[\s<>"`\\\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    if (value.startsWith("/")) {
      if (!/^\/(uploads|art)\//.test(value)) return false;
      const decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]);
      if (
        /[\\\u0000-\u001f\u007f]/u.test(decoded) ||
        decoded.split("/").some((part) => part === "." || part === "..")
      )
        return false;
      const parsed = new URL(value, "https://local.invalid");
      return (
        parsed.origin === "https://local.invalid" &&
        /^\/(uploads|art)\//.test(parsed.pathname)
      );
    }
    if (!value.startsWith("https://")) return false;
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
const urlSchema = text(2048).refine(
  safeUrl,
  "Use an HTTPS URL or a local /uploads/ or /art/ path",
);
const dateSchema = text(10).refine(
  (value) =>
    value === "" ||
    (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value),
  "Use YYYY-MM-DD or leave blank",
);
const uniqueIds = (values) =>
  new Set(values.map((value) => value.id)).size === values.length;
const siteSchema = z
  .object({
    name: text(80, 1),
    tagline: text(200),
    heroTitle: text(200, 1),
    heroDescription: text(2000),
    available: z.boolean(),
    about: text(20000),
    email: z.union([z.literal(""), z.string().trim().max(254).email()]),
    socials: z
      .object({
        itch: urlSchema,
        youtube: urlSchema,
        instagram: urlSchema,
        facebook: urlSchema,
      })
      .strict(),
    community: z
      .object({ name: text(120), description: text(2000), url: urlSchema })
      .strict(),
    highlight: z
      .object({
        eyebrow: text(100),
        title: text(200),
        description: text(4000),
        type: z.enum(["game", "link", "video", "post"]),
        url: urlSchema,
        videoUrl: urlSchema,
        image: urlSchema,
        gameId: z.union([z.literal(""), idSchema]),
      })
      .strict(),
  })
  .strict();
export const gameSchema = z
  .object({
    id: idSchema,
    title: text(160, 1),
    summary: text(500),
    description: text(30000),
    cover: urlSchema,
    genre: text(100),
    tags: z.array(text(50, 1)).max(20),
    status: text(80),
    year: z.union([text(40), z.number().int().min(1900).max(2200)]),
    featured: z.boolean(),
    visible: z.boolean(),
    sample: z.boolean(),
    controls: z
      .array(z.object({ key: text(80, 1), action: text(300, 1) }).strict())
      .max(30),
    versions: z
      .array(
        z
          .object({
            id: idSchema,
            label: text(100, 1),
            date: dateSchema,
            notes: text(15000),
            webUrl: urlSchema,
            visible: z.boolean().default(true),
            downloads: z
              .array(
                z
                  .object({ id: idSchema, label: text(100, 1), url: urlSchema })
                  .strict(),
              )
              .max(30)
              .refine(uniqueIds, "Download IDs must be unique"),
          })
          .strict(),
      )
      .max(100)
      .refine(uniqueIds, "Version IDs must be unique"),
    rating: z.number().min(0).max(5).default(0),
    count: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
  })
  .strict();
const postSchema = z
  .object({
    id: idSchema,
    title: text(200, 1),
    excerpt: text(4000),
    date: dateSchema,
    category: text(80),
    url: urlSchema,
    visible: z.boolean(),
  })
  .strict();
const reviewSchema = z
  .object({
    name: text(60, 2),
    rating: z.number().int().min(1).max(5),
    body: text(2000, 5),
  })
  .strict();
const eventSchema = z.object({
  type: z.enum(["site_view", "game_view", "play", "download", "post_view"]),
  targetId: idSchema,
  versionId: idSchema.optional(),
  downloadId: idSchema.optional(),
  visitId: z.string().max(36).uuid(),
}).strict();
const passwordSchema = z
  .string()
  .min(12)
  .max(256)
  .refine((value) => /\S/u.test(value), "Password cannot be blank");

async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * MB,
  });
  return `scrypt$${salt}$${key.toString("hex")}`;
}
async function passwordMatches(password, stored) {
  const [algorithm, salt, encoded] = stored.split("$");
  if (
    algorithm !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(encoded)
  )
    return false;
  const key = await scryptAsync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * MB,
  });
  return timingSafeEqual(key, Buffer.from(encoded, "hex"));
}
function cookieToken(req) {
  const matches = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function megabyteLimit(name, fallback) {
  const value =
    process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0 || value > 4096)
    throw new Error(`Invalid ${name} setting`);
  return Math.floor(value * MB);
}
export function buildLimits() {
  return {
    maxUploadBytes: megabyteLimit("MAX_UPLOAD_MB", 250),
    maxExtractedBytes: megabyteLimit("MAX_BUILD_EXTRACTED_MB", 512),
  };
}
function safeFilename(original, extension) {
  const basename = path.posix.basename(original.replaceAll("\\", "/"));
  let stem = basename
    .slice(0, basename.length - path.extname(basename).length)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem))
    stem = "file";
  return `${stem}${extension}`;
}
async function verifiedImageExtension(file) {
  const handle = await open(file.path, "r");
  const bytes = Buffer.alloc(16);
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(bytes, 0, bytes.length, 0));
  } finally {
    await handle.close();
  }
  let extension;
  if (
    bytesRead >= 12 &&
    bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  )
    extension = ".png";
  else if (
    bytesRead >= 12 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    extension = ".jpg";
  else if (
    bytesRead >= 12 &&
    ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))
  )
    extension = ".gif";
  else if (
    bytesRead >= 16 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    extension = ".webp";
  const originalExtension = path
    .extname(file.originalname)
    .toLowerCase()
    .replace(".jpeg", ".jpg");
  if (!extension || originalExtension !== extension)
    throw new HttpError(
      400,
      "Image contents must match a JPEG, PNG, WebP, or GIF filename. SVG uploads are not allowed.",
    );
  return extension;
}

// Validate paths for both POSIX and Windows before touching the filesystem.
function zipEntryPath(entry, nodes) {
  const name = entry.fileName.normalize("NFC");
  const directory = name.endsWith("/");
  const parts = (directory ? name.slice(0, -1) : name).split("/");
  const type = (entry.externalFileAttributes >>> 16) & 0xf000;
  if (
    name.length > 1024 ||
    !parts.length ||
    ![0, 0x4000, 0x8000].includes(type) ||
    (type === 0x4000 && !directory) ||
    (type === 0x8000 && directory) ||
    parts.some(
      (part) =>
        !part ||
        part.length > 200 ||
        part.startsWith(".") ||
        /[\\:*?"<>|\u0000-\u001f\u007f]/u.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  ) {
    throw new HttpError(
      400,
      "ZIP contains an unsafe path or unsupported file type.",
    );
  }
  for (let index = 0; index < parts.length; index += 1) {
    const canonical = parts.slice(0, index + 1).join("/");
    const key = canonical.toLowerCase();
    const isDirectory = index < parts.length - 1 || directory;
    const explicit = index === parts.length - 1;
    const previous = nodes.get(key);
    if (
      previous &&
      (previous.canonical !== canonical ||
        !previous.directory ||
        !isDirectory ||
        (explicit && previous.explicit))
    ) {
      throw new HttpError(400, "ZIP contains duplicate or conflicting paths.");
    }
    if (previous) previous.explicit ||= explicit;
    else nodes.set(key, { canonical, directory: isDirectory, explicit });
  }
  if (
    !directory &&
    !buildExtensions.has(path.posix.extname(name).toLowerCase()) &&
    !/^(LICENSE|NOTICE|README)$/i.test(parts.at(-1))
  ) {
    throw new HttpError(
      400,
      "ZIP contains a file type not permitted in a web build.",
    );
  }
  return { relative: parts.join("/"), directory };
}

export async function extractBuildZip(archivePath, destination, maxExtractedBytes) {
  const archiveSize = (await stat(archivePath)).size;
  const zip = await new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, value) =>
        error
          ? reject(
              new HttpError(400, "Upload a valid, unencrypted ZIP archive."),
            )
          : resolve(value),
    );
  });
  let failure;
  let pendingReject;
  let activeStream;
  const onError = (error) => {
    failure = error;
    activeStream?.destroy(error);
    pendingReject?.(error);
  };
  zip.on("error", onError);
  const nextEntry = () =>
    new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const cleanup = () => {
        zip.off("entry", onEntry);
        zip.off("end", onEnd);
        pendingReject = undefined;
      };
      const onEntry = (entry) => {
        cleanup();
        resolve(entry);
      };
      const onEnd = () => {
        cleanup();
        resolve(null);
      };
      pendingReject = (error) => {
        cleanup();
        reject(error);
      };
      zip.once("entry", onEntry);
      zip.once("end", onEnd);
      zip.readEntry();
    });
  const nodes = new Map();
  const files = [];
  let entryCount = 0;
  let declaredBytes = 0;
  let extractedBytes = 0;
  let compressedBytes = 0;
  try {
    if (zip.entryCount > MAX_ZIP_ENTRIES)
      throw new HttpError(400, "ZIP has too many entries.");
    for (;;) {
      const entry = await nextEntry();
      if (!entry) break;
      entryCount += 1;
      if (
        entryCount > MAX_ZIP_ENTRIES ||
        entry.generalPurposeBitFlag & 1 ||
        ![0, 8].includes(entry.compressionMethod)
      ) {
        throw new HttpError(
          400,
          "ZIP is encrypted, unsupported, or has too many entries.",
        );
      }
      const { relative, directory } = zipEntryPath(entry, nodes);
      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        !Number.isSafeInteger(entry.compressedSize) ||
        entry.uncompressedSize < 0 ||
        entry.compressedSize < 0 ||
        (directory && entry.uncompressedSize !== 0)
      ) {
        throw new HttpError(400, "ZIP contains invalid entry sizes.");
      }
      declaredBytes += entry.uncompressedSize;
      compressedBytes += entry.compressedSize;
      if (
        declaredBytes > maxExtractedBytes ||
        entry.uncompressedSize >
          Math.max(MB, entry.compressedSize * MAX_COMPRESSION_RATIO) ||
        declaredBytes > Math.max(MB, archiveSize * MAX_COMPRESSION_RATIO)
      ) {
        throw new HttpError(
          400,
          "ZIP exceeds the extracted size or compression ratio limit.",
        );
      }
      const target = path.resolve(destination, ...relative.split("/"));
      const resolvedRelative = path.relative(destination, target);
      if (
        resolvedRelative.startsWith("..") ||
        path.isAbsolute(resolvedRelative)
      )
        throw new HttpError(400, "ZIP contains an unsafe path.");
      if (directory) {
        await mkdir(target, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      activeStream = await new Promise((resolve, reject) =>
        zip.openReadStream(entry, (error, stream) =>
          error ? reject(error) : resolve(stream),
        ),
      );
      if (failure) throw failure;
      let written = 0;
      const bound = new Transform({
        transform(chunk, encoding, callback) {
          written += chunk.length;
          extractedBytes += chunk.length;
          if (
            written > entry.uncompressedSize ||
            extractedBytes > maxExtractedBytes
          )
            callback(
              new HttpError(400, "ZIP exceeds the extracted size limit."),
            );
          else callback(null, chunk);
        },
      });
      await pipeline(
        activeStream,
        bound,
        createWriteStream(target, { flags: "wx", mode: 0o644 }),
      );
      activeStream = undefined;
      if (written !== entry.uncompressedSize)
        throw new HttpError(400, "ZIP contains an incomplete file.");
      files.push(relative);
    }
    if (declaredBytes > Math.max(MB, compressedBytes * MAX_COMPRESSION_RATIO))
      throw new HttpError(400, "ZIP exceeds the compression ratio limit.");
    if (files.includes("index.html")) return destination;
    const enclosing = files[0]?.split("/")[0];
    if (
      enclosing &&
      files.every((file) => file.startsWith(`${enclosing}/`)) &&
      files.includes(`${enclosing}/index.html`)
    ) {
      return path.join(destination, enclosing);
    }
    throw new HttpError(
      400,
      "Web builds must contain index.html at the root or inside one common enclosing folder.",
    );
  } catch (error) {
    activeStream?.destroy();
    if (error instanceof HttpError) throw error;
    if (["ENOSPC", "EACCES", "EROFS"].includes(error.code)) throw error;
    throw new HttpError(
      400,
      "ZIP is invalid or could not be safely extracted.",
    );
  } finally {
    zip.close();
  }
}

function securityHeaders(production) {
  return (req, res, next) => {
    const build =
      req.path.startsWith("/uploads/builds/") || req.path.startsWith("/games/");
    const scripts = build
      ? "'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:"
      : "'self'";
    res.set({
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' https: data:; connect-src 'self' https: wss:${production ? "" : " http://localhost:5173 http://127.0.0.1:5173 ws://localhost:5173 ws://127.0.0.1:5173"}; worker-src 'self' blob:; child-src 'self' blob:; media-src 'self' https: data: blob:; frame-src 'self' https:; form-action 'self'`,
    });
    next();
  };
}
function protectOrigin(production) {
  const devOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ]);
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }
    try {
      const supplied = req.get("origin");
      const origin = new URL(supplied);
      const expected = new URL(`${req.protocol}://${req.get("host")}`);
      const localDevelopment =
        !production &&
        ["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname) &&
        devOrigins.has(origin.origin);
      if (
        !supplied ||
        origin.origin !== supplied ||
        (origin.origin !== expected.origin && !localDevelopment)
      )
        throw new Error("origin");
      next();
    } catch {
      res
        .status(403)
        .json({
          error: "A matching Origin header is required for write requests.",
        });
    }
  };
}

export function createApp({
  dataDir = path.join(projectDir, "data"),
  bootstrapToken,
  production = process.env.NODE_ENV === "production",
  now = Date.now,
} = {}) {
  dataDir = path.resolve(dataDir);
  const { maxUploadBytes, maxExtractedBytes } = buildLimits();
  const uploadsDir = path.join(dataDir, "uploads");
  const temporaryDir = path.join(dataDir, "tmp");
  for (const directory of [
    temporaryDir,
    ...["images", "downloads", "builds"].map((kind) =>
      path.join(uploadsDir, kind),
    ),
  ])
    mkdirSync(directory, { recursive: true });
  const storage = createStorage(dataDir, { now });
  let setupToken = storage.adminPassword()
    ? null
    : bootstrapToken || randomBytes(32).toString("base64url");
  if (setupToken && !bootstrapToken)
    console.info(`KhoifeeDev first-run setup token: ${setupToken}`);
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.locals.close = () => storage.close();
  app.use(securityHeaders(production));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(protectOrigin(production));
  app.use("/api", express.json({ limit: "1mb", strict: true }));

  const cookieOptions = (req) => ({
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure:
      production &&
      (process.env.COOKIE_SECURE === "true" ||
        (process.env.COOKIE_SECURE !== "false" && req.secure)),
  });
  const sessionState = (req) => {
    const token = cookieToken(req);
    return {
      token,
      authenticated: Boolean(token && storage.sessionValid(hash(token))),
    };
  };
  const startSession = (req, res) => {
    const previous = cookieToken(req);
    if (previous) storage.deleteSession(hash(previous));
    const token = randomBytes(32).toString("base64url");
    storage.addSession(hash(token), Date.now() + SESSION_AGE);
    res.cookie(COOKIE_NAME, token, {
      ...cookieOptions(req),
      maxAge: SESSION_AGE,
    });
  };
  const requireAdmin = (req, res, next) => {
    if (!sessionState(req).authenticated) {
      res.status(401).json({ error: "Administrator login required." });
      return;
    }
    next();
  };
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) =>
      res
        .status(429)
        .json({ error: "Too many authentication attempts. Try again later." }),
  });
  const reviewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) =>
      res
        .status(429)
        .json({ error: "Too many review submissions. Try again later." }),
  });

  app.get("/api/auth/session", (req, res) =>
    res.json({
      authenticated: sessionState(req).authenticated,
      setupRequired: !storage.adminPassword(),
    }),
  );
  app.post(
    "/api/auth/setup",
    authLimiter,
    asyncRoute(async (req, res) => {
      if (storage.adminPassword())
        throw new HttpError(409, "Administrator setup is already complete.");
      const { token, password } = z
        .object({ token: z.string().min(1).max(256), password: passwordSchema })
        .strict()
        .parse(req.body);
      if (!setupToken || !sameSecret(token, setupToken))
        throw new HttpError(403, "Invalid setup token.");
      const encoded = await passwordHash(password);
      // The unique settings key also prevents two simultaneous setup requests winning.
      if (!storage.createAdmin(encoded))
        throw new HttpError(409, "Administrator setup is already complete.");
      setupToken = null;
      startSession(req, res);
      res.status(201).json({ authenticated: true, setupRequired: false });
    }),
  );
  app.post(
    "/api/auth/login",
    authLimiter,
    asyncRoute(async (req, res) => {
      const { password } = z
        .object({ password: passwordSchema })
        .strict()
        .parse(req.body);
      const encoded = storage.adminPassword();
      if (!encoded)
        throw new HttpError(409, "Administrator setup is required.");
      if (!(await passwordMatches(password, encoded)))
        throw new HttpError(401, "Invalid password.");
      startSession(req, res);
      res.json({ authenticated: true, setupRequired: false });
    }),
  );
  app.post("/api/auth/logout", (req, res) => {
    const token = cookieToken(req);
    if (token) storage.deleteSession(hash(token));
    res.clearCookie(COOKIE_NAME, cookieOptions(req));
    res.json({ authenticated: false, setupRequired: !storage.adminPassword() });
  });

  app.get("/api/site", (req, res) =>
    res.json(storage.content({ publicOnly: true })),
  );
  app.get("/api/games/:id", (req, res) => {
    const id = idSchema.parse(req.params.id);
    const game = storage.game(id, { publicOnly: true });
    if (!game?.visible) throw new HttpError(404, "Game not found.");
    res.json({ game, reviews: storage.reviews(id) });
  });
  app.post("/api/games/:id/reviews", reviewLimiter, (req, res) => {
    const gameId = idSchema.parse(req.params.id);
    if (!storage.game(gameId)?.visible)
      throw new HttpError(404, "Game not found.");
    const review = reviewSchema.parse(req.body);
    const id = randomUUID();
    storage.addReview({
      ...review,
      id,
      gameId,
      date: new Date().toISOString(),
    });
    res
      .status(201)
      .json({
        id,
        status: "pending",
        message: "Thank you! Your review is awaiting moderation.",
      });
  });

  const eventLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({ error: "Too many analytics events. Try again later." }),
  });
  app.post("/api/events", (req, res, next) => {
    if (req.get("DNT") === "1" || req.get("Sec-GPC") === "1" ||
        sessionState(req).authenticated) {
      res.status(204).end();
      return;
    }
    next();
  }, eventLimiter, (req, res) => {
    const event = eventSchema.parse(req.body);
    if (event.type === "site_view") {
      if (event.targetId !== "home")
        throw new HttpError(400, "Site views must target home.");
    } else if (event.type === "post_view") {
      if (!storage.post(event.targetId)?.visible)
        throw new HttpError(404, "Post not found.");
    } else {
      const game = storage.game(event.targetId, { publicOnly: true });
      if (!game?.visible) throw new HttpError(404, "Game not found.");
      if (event.type === "play" || event.type === "download") {
        if (!event.versionId)
          throw new HttpError(400, "A versionId is required for this event.");
        if (event.type === "download" && !event.downloadId)
          throw new HttpError(400, "A downloadId is required for download events.");
        const version = game.versions.find((item) => item.id === event.versionId);
        if (!version) throw new HttpError(404, "Visible version not found.");
        if (event.type === "play" && !version.webUrl)
          throw new HttpError(404, "Playable build not found.");
        if (event.type === "download" &&
            !version.downloads.some((item) => item.id === event.downloadId && item.url))
          throw new HttpError(404, "Download not found in this version.");
      }
    }
    storage.recordEvent(event);
    res.status(204).end();
  });

  app.use("/api/admin", requireAdmin);
  app.get("/api/admin/analytics", (req, res) => {
    const { days } = z.object({
      days: z.enum(["7", "30", "90"]).default("30"),
    }).strict().parse(req.query);
    res.json(storage.analytics(Number(days)));
  });
  app.get("/api/admin/content", (req, res) => res.json(storage.content()));
  app.put("/api/admin/site", (req, res) => {
    const site = siteSchema.parse(req.body);
    storage.updateSite(site);
    res.json({ site });
  });
  app.put("/api/admin/games/:id", (req, res) => {
    const id = idSchema.parse(req.params.id);
    const game = gameSchema.parse(req.body);
    if (game.id !== id) throw new HttpError(400, "Game ID must match the URL.");
    storage.upsertGame(game);
    res.json({ game: storage.game(id) });
  });
  app.delete("/api/admin/games/:id", (req, res) => {
    if (!storage.deleteGame(idSchema.parse(req.params.id)))
      throw new HttpError(404, "Game not found.");
    res.json({ ok: true });
  });
  app.put("/api/admin/posts/:id", (req, res) => {
    const id = idSchema.parse(req.params.id);
    const post = postSchema.parse(req.body);
    if (post.id !== id) throw new HttpError(400, "Post ID must match the URL.");
    storage.upsertPost(post);
    res.json({ post });
  });
  app.delete("/api/admin/posts/:id", (req, res) => {
    if (!storage.deletePost(idSchema.parse(req.params.id)))
      throw new HttpError(404, "Post not found.");
    res.json({ ok: true });
  });
  app.get("/api/admin/reviews", (req, res) => res.json(storage.reviews()));
  app.patch("/api/admin/reviews/:id", (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { status } = z
      .object({ status: z.enum(["approved", "pending"]) })
      .strict()
      .parse(req.body);
    if (!storage.moderateReview(id, status))
      throw new HttpError(404, "Review not found.");
    res.json({ id, status });
  });
  app.delete("/api/admin/reviews/:id", (req, res) => {
    if (!storage.deleteReview(idSchema.parse(req.params.id)))
      throw new HttpError(404, "Review not found.");
    res.json({ ok: true });
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: temporaryDir,
      filename: (req, file, callback) => callback(null, randomUUID()),
    }),
    limits: { fileSize: maxUploadBytes, files: 1, fields: 0, parts: 2 },
    fileFilter(req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      const allowed =
        req.uploadKind === "image"
          ? imageExtensions.has(extension)
          : req.uploadKind === "build"
            ? extension === ".zip"
            : downloadExtensions.has(extension);
      callback(
        allowed
          ? null
          : new HttpError(
              400,
              "File type is not allowed for this upload kind.",
            ),
        allowed,
      );
    },
  }).single("file");
  app.post(
    "/api/admin/uploads",
    (req, res, next) => {
      const result = z
        .enum(["image", "build", "download"])
        .safeParse(req.query.kind);
      if (!result.success) {
        next(
          new HttpError(400, "Upload kind must be image, build, or download."),
        );
        return;
      }
      req.uploadKind = result.data;
      upload(req, res, (error) => {
        if (error && !error.code && !(error instanceof HttpError))
          next(
            new HttpError(
              400,
              "Invalid multipart upload. Send one file in the file field.",
            ),
          );
        else next(error);
      });
    },
    asyncRoute(async (req, res) => {
      if (!req.file)
        throw new HttpError(400, "A file is required in the file field.");
      const id = randomUUID();
      let destination;
      let staging;
      let committed = false;
      let url;
      try {
        if (req.uploadKind === "build") {
          staging = path.join(temporaryDir, `build-${id}`);
          await mkdir(staging);
          const root = await extractBuildZip(
            req.file.path,
            staging,
            maxExtractedBytes,
          );
          destination = path.join(uploadsDir, "builds", id);
          await rename(root, destination);
          url = `/uploads/builds/${id}/index.html`;
        } else {
          const extension =
            req.uploadKind === "image"
              ? await verifiedImageExtension(req.file)
              : path.extname(req.file.originalname).toLowerCase();
          const kind = req.uploadKind === "image" ? "images" : "downloads";
          const filename = safeFilename(req.file.originalname, extension);
          destination = path.join(uploadsDir, kind, id);
          await mkdir(destination);
          await rename(req.file.path, path.join(destination, filename));
          url = `/uploads/${kind}/${id}/${filename}`;
        }
        committed = true;
      } finally {
        await rm(req.file.path, { force: true }).catch(() => {});
        if (staging)
          await rm(staging, { recursive: true, force: true }).catch(() => {});
        if (destination && !committed)
          await rm(destination, { recursive: true, force: true }).catch(
            () => {},
          );
      }
      res.status(201).json({ url });
    }),
  );

  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  const staticOptions = {
    dotfiles: "deny",
    index: false,
    fallthrough: false,
    maxAge: "1y",
    immutable: true,
    setHeaders(res, filePath) {
      const extension = path.extname(filePath).toLowerCase();
      if (extension === ".wasm")
        res.setHeader("Content-Type", "application/wasm");
      if (extension === ".pck")
        res.setHeader("Content-Type", "application/octet-stream");
    },
  };
  app.use(
    "/uploads/downloads",
    express.static(path.join(uploadsDir, "downloads"), {
      ...staticOptions,
      setHeaders(res, filePath) {
        staticOptions.setHeaders(res, filePath);
        res.attachment(path.basename(filePath));
      },
    }),
  );
  app.use("/uploads", express.static(uploadsDir, staticOptions));
  app.use(
    "/games",
    express.static(path.join(uploadsDir, "builds"), {
      ...staticOptions,
      fallthrough: true,
    }),
  );
  if (production) {
    const dist = path.join(projectDir, "dist");
    app.use(express.static(dist, { index: false, dotfiles: "deny" }));
    app.use((req, res, next) => {
      if (
        !["GET", "HEAD"].includes(req.method) ||
        !req.accepts("html") ||
        !existsSync(path.join(dist, "index.html"))
      ) {
        next();
        return;
      }
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(dist, "index.html"));
    });
  }
  app.use((req, res) => res.status(404).json({ error: "Not found." }));
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    res.set("Cache-Control", "no-store");
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({
          error: "Invalid request data.",
          fields: error.issues
            .slice(0, 10)
            .map((issue) => issue.path.join(".")),
        });
    } else if (error instanceof multer.MulterError) {
      const oversized = error.code === "LIMIT_FILE_SIZE";
      res
        .status(oversized ? 413 : 400)
        .json({
          error: oversized
            ? `File exceeds the ${maxUploadBytes / MB} MB upload limit.`
            : "Invalid multipart upload. Send one file in the file field.",
        });
    } else if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
    } else if (error.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large." });
    } else if (
      error.type === "entity.parse.failed" ||
      error instanceof URIError ||
      error.status === 400
    ) {
      res.status(400).json({ error: "Malformed request." });
    } else if (error.status === 404 || error.status === 403) {
      res
        .status(error.status)
        .json({
          error: error.status === 404 ? "Not found." : "Access denied.",
        });
    } else {
      res.status(500).json({ error: "An unexpected server error occurred." });
    }
  });
  return app;
}

const invokedAsMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  try {
    const app = createApp({
      dataDir: process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR)
        : path.join(projectDir, "data"),
      bootstrapToken: process.env.BOOTSTRAP_TOKEN,
      production: process.env.NODE_ENV === "production",
    });
    const host = process.env.HOST || "127.0.0.1";
    const port = Number(process.env.PORT || 3001);
    const server = app.listen(port, host);
    server.once("listening", () => {
      const boundPort = server.address().port;
      console.info(`KhoifeeDev server listening on http://${host}:${boundPort}`);
    });
    server.on("error", () => {
      console.error(
        "Unable to listen. Check HOST, PORT, and whether the port is in use.",
      );
      app.locals.close();
      process.exitCode = 1;
    });
    const shutdown = () =>
      server.close(() => {
        app.locals.close();
      });
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch {
    console.error(
      "Unable to start the server. Check data directory access and environment settings.",
    );
    process.exitCode = 1;
  }
}
