import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildLimits, extractBuildZip, gameSchema } from "./index.mjs";
import { createStorage } from "./storage.mjs";

const projectDir = fileURLToPath(new URL("../", import.meta.url));

function availableGame(storage, gameId, label) {
  if (!gameId) return null;
  const game = storage.game(gameId);
  if (!game) throw new Error(`Game not found: ${gameId}`);
  if (game.versions.some((version) => version.label.toLowerCase() === label.toLowerCase()))
    throw new Error(`Version label already exists: ${label}`);
  if (game.versions.length >= 100) throw new Error("A game can have at most 100 versions.");
  return game;
}

function newGameId(storage, title) {
  const stem = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 70).replace(/-+$/g, "") || "game";
  let id = stem;
  let suffix = 2;
  while (storage.game(id)) id = `${stem}-${suffix++}`;
  return id;
}

// This helper never starts an HTTP server, sets credentials, or removes the source ZIP.
export async function importBuild({
  archivePath,
  title,
  gameId,
  version: label = "v1.0.0",
  dataDir = process.env.DATA_DIR || path.join(projectDir, "data"),
} = {}) {
  if (typeof archivePath !== "string" || !archivePath)
    throw new Error("Provide the path to a Godot web-export ZIP archive.");
  archivePath = path.resolve(archivePath);
  dataDir = path.resolve(dataDir);
  if (path.extname(archivePath).toLowerCase() !== ".zip")
    throw new Error("The archive must have a .zip extension.");
  if (gameId !== undefined) gameId = gameSchema.shape.id.parse(gameId);
  else {
    if (title === undefined) throw new Error("--title is required when creating a new game.");
    title = gameSchema.shape.title.parse(title);
  }
  label = gameSchema.shape.versions.element.shape.label.parse(label);
  const { maxUploadBytes, maxExtractedBytes } = buildLimits();
  const archive = await stat(archivePath);
  if (!archive.isFile()) throw new Error("Archive path must be a regular file.");
  if (archive.size > maxUploadBytes)
    throw new Error(`File exceeds the ${maxUploadBytes / (1024 * 1024)} MB upload limit.`);

  const storage = createStorage(dataDir);
  let staging;
  let destination;
  let moved = false;
  let committed = false;
  try {
    availableGame(storage, gameId, label);
    const temporaryDir = path.join(dataDir, "tmp");
    const buildsDir = path.join(dataDir, "uploads", "builds");
    await mkdir(temporaryDir, { recursive: true });
    await mkdir(buildsDir, { recursive: true });
    staging = await mkdtemp(path.join(temporaryDir, "import-build-"));
    const root = await extractBuildZip(archivePath, staging, maxExtractedBytes);
    const buildId = randomUUID();
    destination = path.join(buildsDir, buildId);
    const webUrl = `/uploads/builds/${buildId}/index.html`;
    const splash = await stat(path.join(root, "index.png")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    const cover = splash?.isFile()
      ? `/uploads/builds/${buildId}/index.png`
      : "/art/greenhouse.svg";
    await rename(root, destination);
    moved = true;
    const today = new Date();
    const version = {
      id: randomUUID(),
      label,
      date: today.toISOString().slice(0, 10),
      notes: "",
      webUrl,
      visible: true,
      downloads: [],
    };
    const game = storage.transaction(() => {
      // Re-read after extraction while holding the write lock; never replace later edits.
      const existing = availableGame(storage, gameId, label);
      const game = gameSchema.parse(existing ? {
        ...existing,
        versions: [version, ...existing.versions],
      } : {
        id: newGameId(storage, title),
        title,
        summary: "A Godot game by KhoifeeDev.",
        description: "Project details coming soon.",
        cover,
        genre: "Game",
        tags: [],
        status: "In development",
        year: today.getUTCFullYear(),
        featured: false,
        visible: false,
        sample: false,
        controls: [],
        versions: [version],
      });
      storage.upsertGame(game);
      return game;
    });
    committed = true;
    return { game, version };
  } finally {
    storage.close();
    await Promise.all([
      ...(staging ? [rm(staging, { recursive: true, force: true })] : []),
      ...(moved && !committed ? [rm(destination, { recursive: true, force: true })] : []),
    ]);
  }
}

const invokedAsMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        title: { type: "string" },
        game: { type: "string" },
        version: { type: "string", default: "v1.0.0" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.info('Usage: node --experimental-sqlite server/import-build.mjs "archive.zip" --title "Game title" [--version v1.0.0]');
      console.info('Existing game: use --game GAME_ID instead of --title. DATA_DIR optionally selects the data directory.');
    } else {
      if (positionals.length !== 1) throw new Error("Provide exactly one archive path. Use --help for usage.");
      const { game, version } = await importBuild({
        archivePath: positionals[0], title: values.title,
        gameId: values.game, version: values.version,
      });
      console.info(`Imported game: ${game.id}`);
      console.info(`Title: ${game.title}`);
      console.info(`Status: ${game.visible ? "public" : "hidden draft"}`);
      console.info(`Version: ${version.label}`);
      console.info(`Web URL: ${version.webUrl}`);
      console.info("Next: run npm run dev, open the Studio, review the game details, cover and controls, test the web build, then publish when ready.");
      console.info("The original archive is unchanged. No native downloads were added.");
    }
  } catch (error) {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
