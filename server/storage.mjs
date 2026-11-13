import { DatabaseSync } from "node:sqlite";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { seedSite, seedGames, seedPosts } from "./seed.mjs";

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const metricNames = {
  site_view: "siteViews",
  game_view: "gameViews",
  play: "playStarts",
  download: "downloadClicks",
  post_view: "postViews",
};
const emptyMetrics = () => Object.fromEntries(
  Object.values(metricNames).map((name) => [name, 0]),
);
const utcDate = (time) => new Date(time).toISOString().slice(0, 10);

export function createStorage(dataDir, { now = Date.now } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "khoifee.sqlite"));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved'))
    );
    CREATE INDEX IF NOT EXISTS reviews_game_status ON reviews(game_id, status);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS analytics_daily (
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('site_view', 'game_view', 'play', 'download', 'post_view')),
      target_id TEXT NOT NULL,
      count INTEGER NOT NULL CHECK (count > 0),
      PRIMARY KEY (date, type, target_id)
    );
    CREATE TABLE IF NOT EXISTS analytics_dedupe (
      hash TEXT PRIMARY KEY,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analytics_dedupe_expiry ON analytics_dedupe(expires);
  `);

  const getSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
  const setSetting = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const insertAdmin = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('adminPassword', ?)",
  );
  const statements = Object.fromEntries(
    ["games", "posts"].map((table) => [
      table,
      {
        all: db.prepare(
          `SELECT content FROM ${table} ORDER BY position, rowid`,
        ),
        one: db.prepare(`SELECT content FROM ${table} WHERE id = ?`),
        upsert: db.prepare(`INSERT INTO ${table} (id, content, position)
      VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM ${table}))
      ON CONFLICT(id) DO UPDATE SET content = excluded.content`),
        remove: db.prepare(`DELETE FROM ${table} WHERE id = ?`),
      },
    ]),
  );

  // Seed only a new database. An empty collection later is an intentional edit.
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!getSetting.get("site")) {
      setSetting.run("site", JSON.stringify(seedSite));
      for (const game of seedGames)
        statements.games.upsert.run(game.id, JSON.stringify(game));
      for (const post of seedPosts)
        statements.posts.upsert.run(post.id, JSON.stringify(post));
    }
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('analyticsSecret', ?)")
      .run(randomBytes(32).toString("hex"));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }

  const aggregates = db.prepare(
    "SELECT game_id, AVG(rating) AS rating, COUNT(*) AS count FROM reviews WHERE status = 'approved' GROUP BY game_id",
  );
  const singleAggregate = db.prepare(
    "SELECT AVG(rating) AS rating, COUNT(*) AS count FROM reviews WHERE game_id = ? AND status = 'approved'",
  );
  const reviewSelect = `SELECT r.id, r.game_id AS gameId, json_extract(g.content, '$.title') AS gameTitle,
    r.name, r.rating, r.body, r.date, r.status FROM reviews r JOIN games g ON g.id = r.game_id`;
  const allReviews = db.prepare(
    `${reviewSelect} ORDER BY r.date DESC, r.rowid DESC`,
  );
  const publicReviews = db.prepare(
    `${reviewSelect} WHERE r.game_id = ? AND r.status = 'approved' ORDER BY r.date DESC, r.rowid DESC`,
  );
  const addReview = db.prepare(
    "INSERT INTO reviews (id, game_id, name, rating, body, date) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const moderateReview = db.prepare(
    "UPDATE reviews SET status = ? WHERE id = ?",
  );
  const deleteReview = db.prepare("DELETE FROM reviews WHERE id = ?");
  const addSession = db.prepare(
    "INSERT INTO sessions (hash, expires) VALUES (?, ?)",
  );
  const getSession = db.prepare("SELECT expires FROM sessions WHERE hash = ?");
  const deleteSession = db.prepare("DELETE FROM sessions WHERE hash = ?");
  const pruneSessions = db.prepare("DELETE FROM sessions WHERE expires <= ?");
  const decorate = (game, aggregate, publicOnly = false) => ({
    ...game,
    versions: publicOnly
      ? game.versions.filter((version) => version.visible !== false)
      : game.versions,
    rating: aggregate?.count ? Math.round(aggregate.rating * 10) / 10 : 0,
    count: aggregate?.count || 0,
  });
  const analyticsSecret = Buffer.from(getSetting.get("analyticsSecret").value, "hex");
  const pruneAnalytics = db.prepare("DELETE FROM analytics_dedupe WHERE expires <= ?");
  const addDedupe = db.prepare(
    "INSERT OR IGNORE INTO analytics_dedupe (hash, expires) VALUES (?, ?)",
  );
  const incrementAnalytics = db.prepare(`
    INSERT INTO analytics_daily (date, type, target_id, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(date, type, target_id) DO UPDATE SET count = count + 1
  `);
  const dailyAnalytics = db.prepare(
    "SELECT date, type, SUM(count) AS count FROM analytics_daily WHERE date BETWEEN ? AND ? GROUP BY date, type",
  );
  const targetAnalytics = db.prepare(
    "SELECT type, target_id, SUM(count) AS count FROM analytics_daily WHERE date BETWEEN ? AND ? GROUP BY type, target_id",
  );
  const pendingReviews = db.prepare(
    "SELECT game_id, COUNT(*) AS count FROM reviews WHERE status = 'pending' GROUP BY game_id",
  );
  const allRatings = db.prepare(
    "SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE status = 'approved'",
  );
  const transaction = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  // View hashes expire at UTC midnight; action hashes at the next minute.
  // Hourly idle pruning keeps even unused hashes well below 48 hours while running.
  pruneAnalytics.run(now());
  const pruneTimer = setInterval(() => {
    try {
      pruneAnalytics.run(now());
    } catch {
      // A transient database lock must not take down public pages. Retry next pass.
    }
  }, 60 * MINUTE);
  pruneTimer.unref();
  let closed = false;

  return {
    // Synchronous only: used by the importer to preserve concurrent Studio edits.
    transaction,
    recordEvent(event) {
      const time = now();
      const action = event.type === "play" || event.type === "download";
      const period = action ? MINUTE : DAY;
      const bucket = Math.floor(time / period);
      const key = createHmac("sha256", analyticsSecret).update(JSON.stringify([
        event.visitId.toLowerCase(), event.type, event.targetId,
        action ? event.versionId : null,
        event.type === "download" ? event.downloadId : null,
        bucket,
      ])).digest("hex");
      return transaction(() => {
        pruneAnalytics.run(time);
        if (!addDedupe.run(key, (bucket + 1) * period).changes) return false;
        incrementAnalytics.run(utcDate(time), event.type, event.targetId);
        return true;
      });
    },
    analytics(days = 30) {
      if (![7, 30, 90].includes(days)) throw new RangeError("Invalid analytics range");
      const time = now();
      const end = Math.floor(time / DAY) * DAY;
      const start = end - (days - 1) * DAY;
      const startDate = utcDate(start);
      const endDate = utcDate(end);
      pruneAnalytics.run(time);
      // One snapshot for events, content, and all-time review aggregates.
      return transaction(() => {
        const daily = Array.from({ length: days }, (_, index) => ({
          date: utcDate(start + index * DAY), ...emptyMetrics(),
        }));
        const dates = new Map(daily.map((row) => [row.date, row]));
        const totals = emptyMetrics();
        for (const row of dailyAnalytics.all(startDate, endDate)) {
          const metric = metricNames[row.type];
          dates.get(row.date)[metric] += row.count;
          totals[metric] += row.count;
        }
        const targets = new Map();
        for (const row of targetAnalytics.all(startDate, endDate)) {
          targets.set(`${row.type}:${row.target_id}`, row.count);
        }
        const count = (type, id) => targets.get(`${type}:${id}`) || 0;
        const ratings = new Map(aggregates.all().map((row) => [row.game_id, row]));
        const pending = new Map(pendingReviews.all().map((row) => [row.game_id, row.count]));
        const games = statements.games.all.all().map(({ content }) => {
          const game = JSON.parse(content);
          const rating = ratings.get(game.id);
          return {
            id: game.id, title: game.title, visible: game.visible,
            views: count("game_view", game.id),
            playStarts: count("play", game.id),
            downloadClicks: count("download", game.id),
            rating: rating?.count ? Math.round(rating.rating * 10) / 10 : 0,
            ratingCount: rating?.count || 0,
            pendingReviews: pending.get(game.id) || 0,
          };
        });
        const posts = statements.posts.all.all().map(({ content }) => {
          const post = JSON.parse(content);
          return {
            id: post.id, title: post.title, visible: post.visible,
            views: count("post_view", post.id),
          };
        });
        const rating = allRatings.get();
        return {
          days, startDate, endDate, totals, daily, games, posts,
          ratings: {
            average: rating.count ? Math.round(rating.average * 10) / 10 : 0,
            count: rating.count,
            pending: [...pending.values()].reduce((sum, value) => sum + value, 0),
          },
        };
      });
    },
    content({ publicOnly = false } = {}) {
      const ratings = new Map(
        aggregates.all().map((row) => [row.game_id, row]),
      );
      const games = statements.games.all
        .all()
        .map((row) => JSON.parse(row.content))
        .filter((game) => !publicOnly || game.visible)
        .map((game) => decorate(game, ratings.get(game.id), publicOnly));
      const posts = statements.posts.all
        .all()
        .map((row) => JSON.parse(row.content))
        .filter((post) => !publicOnly || post.visible);
      const savedSite = JSON.parse(getSetting.get("site").value);
      return {
        site: {
          ...savedSite,
          copy: { ...seedSite.copy, ...savedSite.copy },
        },
        games,
        posts,
      };
    },
    game(id, { publicOnly = false } = {}) {
      const row = statements.games.one.get(id);
      return row
        ? decorate(JSON.parse(row.content), singleAggregate.get(id), publicOnly)
        : null;
    },
    post(id) {
      const row = statements.posts.one.get(id);
      return row ? JSON.parse(row.content) : null;
    },
    updateSite(site) {
      setSetting.run("site", JSON.stringify(site));
    },
    upsertGame(game) {
      statements.games.upsert.run(
        game.id,
        JSON.stringify({ ...game, rating: 0, count: 0 }),
      );
    },
    upsertPost(post) {
      statements.posts.upsert.run(post.id, JSON.stringify(post));
    },
    deleteGame(id) {
      return statements.games.remove.run(id).changes > 0;
    },
    deletePost(id) {
      return statements.posts.remove.run(id).changes > 0;
    },
    reviews(gameId) {
      return gameId ? publicReviews.all(gameId) : allReviews.all();
    },
    addReview(review) {
      addReview.run(
        review.id,
        review.gameId,
        review.name,
        review.rating,
        review.body,
        review.date,
      );
    },
    moderateReview(id, status) {
      return moderateReview.run(status, id).changes > 0;
    },
    deleteReview(id) {
      return deleteReview.run(id).changes > 0;
    },
    adminPassword() {
      return getSetting.get("adminPassword")?.value ?? null;
    },
    createAdmin(passwordHash) {
      return insertAdmin.run(passwordHash).changes > 0;
    },
    addSession(hash, expires) {
      pruneSessions.run(Date.now());
      addSession.run(hash, expires);
    },
    sessionValid(hash) {
      return (getSession.get(hash)?.expires ?? 0) > Date.now();
    },
    deleteSession(hash) {
      deleteSession.run(hash);
    },
    close() {
      if (!closed) {
        clearInterval(pruneTimer);
        db.close();
        closed = true;
      }
    },
  };
}
