import { test as base, expect } from '@playwright/test';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT = path.join(ROOT, 'test-results');
const PASSWORD = 'browser-only-password-2026';
const TOKEN = 'browser-only-bootstrap-token';
const TITLE = 'Browser fixture';
const SUMMARY = 'An interactive HTML hosting test, not an actual Godot export.';
const DESCRIPTION = 'Browser integration fixture for uploaded web builds.\nThis is plain HTML and JavaScript, not a real Godot game.';
const INTRODUCTION = 'A browser-edited introduction from an isolated test studio.';
const REVIEW = 'The fixture button works, and the version download is useful.';
let app;
let server;
let dataDir;
let origin;

// A dependency-free, stored ZIP writer: fixtures stay in memory until uploaded.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name);
    const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(body.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    local.push(header, filename, body);
    central.push(record, filename);
    offset += header.length + filename.length + body.length;
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

const WEB_ZIP = zip([
  ['index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HTML browser fixture</title></head><body><h1>HTML fixture (not Godot)</h1><button id="interact">Run fixture interaction</button><p role="status" id="result">Ready</p><p id="isolation"></p><p id="wasm"></p><p id="pack"></p><script src="fixture.js"></script></body></html>'],
  ['fixture.js', `document.querySelector('#interact').addEventListener('click', () => { document.querySelector('#result').textContent = 'Fixture interaction succeeded'; });
    document.querySelector('#isolation').textContent = 'crossOriginIsolated: ' + self.crossOriginIsolated;
    (async () => {
      const response = await fetch('fixture.wasm');
      await WebAssembly.instantiateStreaming(response);
      document.querySelector('#wasm').textContent = 'WASM instantiated';
      const pack = await fetch('fixture.pck');
      document.querySelector('#pack').textContent = await pack.text();
    })().catch(error => { console.error(error); });`],
  ['fixture.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])],
  ['fixture.pck', 'Placeholder pack, not a Godot resource pack'],
]);
const DOWNLOAD_ZIP = zip([['fixture.txt', 'Browser download fixture, not an executable Godot build.']]);

// Every actor gets a fresh context. Only the ephemeral server is allowed on the network.
// Expected negative-test HTTP errors are narrowly matched by URL, status, and count;
// CSP violations, application exceptions, and every other console error still fail.
const test = base.extend({
  actors: async ({ browser }, use, testInfo) => {
    const contexts = [], pages = [], jsErrors = [], consoleErrors = [], outbound = [], httpErrors = [], warnings = [];
    const expectedFailures = [];
    const actors = {
      allowHttpError(route, status, count = 1) {
        expectedFailures.push({ url: `${origin}${route}`, status, count });
      },
      async page(viewport = { width: 1440, height: 1000 }) {
        const context = await browser.newContext({ viewport, baseURL: origin, acceptDownloads: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
        contexts.push(context);
        context.setDefaultTimeout(15000);
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        await context.route('**/*', route => {
          const url = route.request().url();
          if (url.startsWith(`${origin}/`) || /^(data|blob):/.test(url)) return route.continue();
          outbound.push(url);
          return route.abort('blockedbyclient');
        });
        context.on('page', page => {
          pages.push(page);
          page.on('pageerror', error => jsErrors.push({ page: page.url(), message: error.stack || error.message }));
          page.on('console', message => {
            const item = { text: message.text(), ...message.location(), page: page.url() };
            if (message.type() === 'error') consoleErrors.push(item);
            if (message.type() === 'warning') warnings.push(item);
          });
          page.on('response', response => {
            if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
          });
        });
        return context.newPage();
      },
    };
    try {
      await use(actors);
    } finally {
      const unexpectedHttp = httpErrors.filter(item => !expectedFailures.some(rule => rule.url === item.url && rule.status === item.status));
      const unexpectedConsole = consoleErrors.filter(item => !expectedFailures.some(rule =>
        rule.url === item.url && item.text.startsWith('Failed to load resource: the server responded with a status of ') && item.text.includes(`status of ${rule.status} `)));
      for (const rule of expectedFailures) {
        expect.soft(httpErrors.filter(item => item.url === rule.url && item.status === rule.status).length, `HTTP negative-test budget: ${rule.url}`).toBeLessThanOrEqual(rule.count);
        expect.soft(consoleErrors.filter(item => item.url === rule.url && item.text.includes(`status of ${rule.status} `)).length, `Console negative-test budget: ${rule.url}`).toBeLessThanOrEqual(rule.count);
      }
      expect.soft(jsErrors, 'No uncaught browser JavaScript exceptions').toEqual([]);
      expect.soft(unexpectedConsole, 'No unexpected browser console errors (including CSP)').toEqual([]);
      expect.soft(unexpectedHttp, 'No unexpected HTTP failures').toEqual([]);
      expect.soft(outbound, 'No outbound service requests').toEqual([]);
      const failed = testInfo.errors.length > 0;
      try {
        if (failed) {
          for (const [index, page] of pages.entries()) {
            if (!page.isClosed()) {
              const screenshot = testInfo.outputPath(`failure-page-${index + 1}.png`);
              await page.screenshot({ path: screenshot, fullPage: true, timeout: 10000 }).catch(() => {});
            }
          }
        }
        await testInfo.attach('browser-diagnostics', {
          body: Buffer.from(JSON.stringify({ jsErrors, consoleErrors, httpErrors, outbound, warnings }, null, 2)),
          contentType: 'application/json',
        });
        for (const [index, context] of contexts.entries()) {
          await context.tracing.stop(failed ? { path: testInfo.outputPath(`trace-${index + 1}.zip`) } : {});
        }
      } finally {
        await Promise.all(contexts.map(context => context.close()));
      }
    }
  },
});

test.use({ launchOptions: { downloadsPath: path.join(OUTPUT, 'downloads'), tracesDir: OUTPUT } });
test.describe.configure({ mode: 'default', timeout: 120000 });

test.beforeAll(async () => {
  await access(path.join(ROOT, 'dist', 'index.html'));
  await mkdir(OUTPUT, { recursive: true });
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'khoifee-browser-'));
  app = createApp({ dataDir, bootstrapToken: TOKEN, production: true });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  try {
    if (server?.listening) {
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
  } finally {
    try { app?.locals.close(); }
    finally {
      if (dataDir) {
        // Never remove a configured application directory, only our mkdtemp result.
        if (path.dirname(dataDir) !== path.resolve(os.tmpdir()) || !path.basename(dataDir).startsWith('khoifee-browser-')) throw new Error('Refusing unsafe test cleanup');
        await rm(dataDir, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  }
});

async function home(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Small worlds.Lasting stories.');
  await page.evaluate(() => document.fonts.ready);
}

async function noOverflow(page, label, testInfo) {
  const evidence = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1) && getComputedStyle(element).position !== 'absolute';
    }).slice(0, 18).map(element => ({ tag: element.tagName, class: element.className?.baseVal ?? element.className, text: element.textContent.slice(0, 90), width: element.getBoundingClientRect().width })),
  }));
  if (Math.max(evidence.document, evidence.body) > evidence.viewport + 1) {
    await testInfo.attach(`overflow-${label}`, { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath(`overflow-${label}.png`), fullPage: true });
  }
  expect.soft(Math.max(evidence.document, evidence.body), `${label}: no horizontal overflow; ${JSON.stringify(evidence)}`).toBeLessThanOrEqual(evidence.viewport + 1);
}

async function mobileMenu(page) {
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation.getByRole('link', { name: 'Games', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await expect(navigation).toBeHidden();
}

async function setup(page) {
  await page.getByLabel('Setup token').fill(TOKEN);
  await page.getByLabel('Create a password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create my studio' }).click();
  await expect(page.getByRole('navigation', { name: 'Studio navigation' })).toBeVisible();
}

async function studio(page) {
  await page.goto('/studio');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (await page.getByLabel('Setup token').count()) await setup(page);
  else {
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Enter the studio' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Studio navigation' })).toBeVisible();
}

async function studioTab(page, name) {
  await page.getByRole('navigation', { name: 'Studio navigation' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

async function save(page) {
  const dismiss = page.getByRole('button', { name: 'Dismiss notification' });
  if (await dismiss.count()) await dismiss.click();
  const response = page.waitForResponse(response => response.url().startsWith(`${origin}/api/admin/`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save changes', exact: true }).first().click();
  expect((await response).status(), 'UI save request succeeded').toBe(200);
  await expect(page.getByRole('status')).toContainText('Saved. Your little corner of the internet is up to date.');
}

async function fillGame(page) {
  await page.getByLabel('Game title', { exact: true }).fill(TITLE);
  await page.getByLabel('Executive summary').fill(SUMMARY);
  await page.getByRole('textbox', { name: 'Full description', exact: true }).fill(DESCRIPTION);
  await page.getByLabel('Genre', { exact: true }).fill('Interactive fixture');
  await page.getByLabel('Tags', { exact: false }).fill('Browser test, HTML fixture');
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Released');
  await page.getByLabel('One control per line').fill('Mouse: Press the fixture button\nEnter: Activate a focused button');
  await page.getByRole('checkbox', { name: /^Sample concept/ }).uncheck();
}

async function openGameEditor(page) {
  await studioTab(page, 'Games');
  await expect(page.getByRole('heading', { name: 'Little worlds. All yours.' })).toBeVisible();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: TITLE, exact: true }) });
  if (await card.count()) {
    await card.getByRole('button', { name: 'Edit game' }).click();
  } else {
    // If a preceding test failed and Playwright restarted its worker, rebuild
    // prerequisites with real UI operations, never by mutating the API or DB.
    await page.getByRole('button', { name: 'New game' }).click();
    await fillGame(page);
    await page.getByRole('checkbox', { name: 'Publicly visible', exact: true }).check();
    await save(page);
  }
  await expect(page.getByLabel('Game title', { exact: true })).toHaveValue(TITLE);
}

async function upload(page, scope, label, name, buffer, status = 201) {
  const response = page.waitForResponse(response => response.url().includes('/api/admin/uploads?kind=') && response.request().method() === 'POST');
  const chooser = page.waitForEvent('filechooser');
  await scope.getByLabel(label, { exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/zip', buffer });
  expect((await response).status(), `${name}: browser file-chooser upload`).toBe(status);
}

function versionEditor(page, label) {
  // No semantic grouping exists for version editors; scope by the accessible
  // remove button, then use labels/roles for every interaction within the group.
  return page.locator('.version-editor').filter({ has: page.getByRole('button', { name: `Remove version ${label}`, exact: true }) });
}

async function ensureWebVersion(page) {
  if (await page.getByRole('button', { name: 'Remove version v1.0.0', exact: true }).count()) return;
  await page.getByRole('button', { name: 'Add version', exact: true }).click();
  await page.getByLabel('Version name', { exact: true }).first().fill('v1.0.0');
  const version = versionEditor(page, 'v1.0.0');
  await version.getByLabel('Release date', { exact: true }).fill('2026-11-10');
  await version.getByRole('textbox', { name: 'Release notes', exact: true }).fill('First HTML browser fixture; not a Godot export.');
  await upload(page, version, 'Upload Godot web export (.zip)', 'browser-fixture.zip', WEB_ZIP);
  await expect(version.getByLabel('Web build URL', { exact: true })).toHaveValue(/^\/uploads\/builds\/[^/]+\/index\.html$/);
  await upload(page, version, 'Upload downloadable build', 'browser-fixture-download.zip', DOWNLOAD_ZIP);
  await expect(version.getByLabel('File URL', { exact: true })).toHaveValue(/^\/uploads\/downloads\//);
  await version.getByLabel('Download label', { exact: true }).fill('Download HTML fixture (.zip)');
  await save(page);
}

async function publicFixture(page) {
  await home(page);
  const link = page.getByRole('link').filter({ has: page.getByRole('heading', { name: TITLE, exact: true }) });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${TITLE}.`);
}

test('desktop production home: local fonts, all filters, empty states and screenshot', async ({ actors }, testInfo) => {
  const page = await actors.page();
  await home(page);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3 }).filter({ hasText: /^(Little Green World|After the Rain|One More Day)$/ })).toHaveCount(3);
  const fonts = await page.evaluate(() => ({
    loaded: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family),
    urls: performance.getEntriesByType('resource').map(entry => entry.name).filter(url => /\.woff2?(?:\?|$)/.test(url)),
  }));
  expect(fonts.loaded.join(' ')).toContain('DM Sans Variable');
  expect(fonts.loaded.join(' ')).toContain('Manrope Variable');
  expect(fonts.urls.length).toBeGreaterThan(0);
  expect(fonts.urls.every(url => url.startsWith(`${origin}/assets/`))).toBe(true);
  await noOverflow(page, 'desktop-home', testInfo);
  await page.screenshot({ path: path.join(OUTPUT, 'desktop-home.png'), fullPage: true });
  for (const filter of ['Play in browser', 'In development', 'Released']) {
    await page.getByRole('button', { name: filter, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Something good is growing.' })).toBeVisible();
    await expect(page.getByText(`No ${filter.toLowerCase()} games just yet. Explore the other projects in the meantime.`, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Little Green World', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'See all games' }).click();
    await expect(page.getByRole('heading', { name: 'Little Green World', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: /^All games/ }).click();
  await expect(page.getByRole('heading', { name: 'One More Day', exact: true })).toBeVisible();
});

test('sample detail, missing game and unknown page routes', async ({ actors }) => {
  const page = await actors.page();
  await page.goto('/games/little-green-world');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Little Green World.');
  await expect(page.getByText('A concept, for now.', { exact: true })).toBeVisible();
  await expect(page.getByText(/This is sample content showing what a game page can look like/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play in browser', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Version history', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('No releases yet.');
  await page.getByRole('tab', { name: /^Comments/ }).click();
  await expect(page.getByText('No reviews yet. Yours could be the first.', { exact: true })).toBeVisible();
  actors.allowHttpError('/api/games/browser-missing-game', 404);
  await page.goto('/games/browser-missing-game');
  await expect(page.getByRole('heading', { name: 'That little world isn’t here.' })).toBeVisible();
  await expect(page.getByText('Game not found.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Explore the games', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/#games`);
  await page.goto('/browser-missing-route');
  await expect(page.getByRole('heading', { name: 'A little off the path.' })).toBeVisible();
  await page.getByRole('link', { name: 'Take me home' }).click();
  await expect(page).toHaveURL(`${origin}/`);
});

for (const width of [390, 320]) {
  test(`mobile ${width}: home, menu, sample detail and first-run studio fit`, async ({ actors }, testInfo) => {
    const page = await actors.page({ width, height: 844 });
    await home(page);
    await noOverflow(page, `${width}-home`, testInfo);
    await page.screenshot({ path: path.join(OUTPUT, width === 390 ? 'mobile-home.png' : 'mobile-home-320.png'), fullPage: true });
    await mobileMenu(page);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Games', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/#games`);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
    await page.goto('/games/little-green-world');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Little Green World.');
    await mobileMenu(page);
    await noOverflow(page, `${width}-sample-detail`, testInfo);
    for (const tab of ['Version history', 'Comments']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      await noOverflow(page, `${width}-sample-${tab.replaceAll(' ', '-')}`, testInfo);
    }
    await page.goto('/studio');
    await expect(page.getByRole('heading', { name: 'Your next chapter starts here.' })).toBeVisible();
    await noOverflow(page, `${width}-studio-setup`, testInfo);
  });
}

test('first-run UI: token required, short password rejected, valid setup opens private studio', async ({ actors }) => {
  const page = await actors.page();
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Your next chapter starts here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Create my studio' }).click();
  expect(await page.getByLabel('Setup token').evaluate(element => element.validity.valueMissing)).toBe(true);
  await page.getByLabel('Setup token').fill(TOKEN);
  const password = page.getByLabel('Create a password');
  await expect(password).toHaveAttribute('minlength', '12');
  await password.pressSequentially('too-short');
  await page.getByRole('button', { name: 'Create my studio' }).click();
  expect(await password.evaluate(element => element.validity.tooShort)).toBe(true);
  await expect(page.getByRole('navigation', { name: 'Studio navigation' })).toHaveCount(0);
  await password.fill(PASSWORD);
  await page.getByLabel('Setup token').fill('wrong-browser-token');
  actors.allowHttpError('/api/auth/setup', 403);
  await page.getByRole('button', { name: 'Create my studio' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid setup token.');
  await setup(page);
  await expect(page.getByRole('textbox', { name: 'Introduction', exact: true })).toBeVisible();
});

test('portfolio introduction and spotlight edits persist and render publicly', async ({ actors }) => {
  const admin = await actors.page();
  const visitor = await actors.page();
  await studio(admin);
  await admin.getByRole('textbox', { name: 'Introduction', exact: true }).fill(INTRODUCTION);
  await save(admin);
  await home(visitor);
  await expect(visitor.getByText(INTRODUCTION, { exact: true })).toBeVisible();
  await studioTab(admin, 'Spotlight');
  await admin.getByRole('combobox', { name: 'Highlight type', exact: true }).selectOption('game');
  await admin.getByLabel('Small label', { exact: true }).fill('BROWSER SPOTLIGHT');
  await admin.getByLabel('Title', { exact: true }).fill('An edited browser spotlight');
  await admin.getByRole('textbox', { name: 'Description', exact: true }).fill('Spotlight saved through the private studio.');
  await admin.getByLabel('Featured game').selectOption('after-the-rain');
  await save(admin);
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'An edited browser spotlight', exact: true })).toBeVisible();
  await expect(visitor.getByText('BROWSER SPOTLIGHT', { exact: true })).toBeVisible();
  await expect(visitor.getByText('Spotlight saved through the private studio.', { exact: true })).toBeVisible();
  await visitor.getByRole('link', { name: 'Explore An edited browser spotlight', exact: true }).click();
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('After the Rain.');
  await admin.reload();
  await expect(admin.getByRole('textbox', { name: 'Introduction', exact: true })).toHaveValue(INTRODUCTION);
  await studioTab(admin, 'Spotlight');
  await expect(admin.getByLabel('Title', { exact: true })).toHaveValue('An edited browser spotlight');
});

test('publish a non-sample game, upload web ZIP, interact with isolated iframe and download ZIP', async ({ actors }, testInfo) => {
  const admin = await actors.page();
  const visitor = await actors.page();
  await studio(admin);
  await studioTab(admin, 'Games');
  await admin.getByRole('button', { name: 'New game' }).click();
  await fillGame(admin);
  await expect(admin.getByRole('checkbox', { name: 'Publicly visible', exact: true })).not.toBeChecked();
  await save(admin);
  await home(visitor);
  await expect(visitor.getByRole('heading', { name: TITLE, exact: true })).toHaveCount(0);
  await admin.getByRole('checkbox', { name: 'Publicly visible', exact: true }).check();
  await save(admin);
  await publicFixture(visitor);
  await expect(visitor.getByText(SUMMARY, { exact: true })).toBeVisible();
  await expect(visitor.getByRole('tabpanel')).toContainText(DESCRIPTION.replace('\n', ' '));
  await expect(visitor.getByText('A concept, for now.', { exact: true })).toHaveCount(0);
  await expect(visitor.getByText('Interactive fixture · Released', { exact: true })).toBeVisible();
  await expect(visitor.getByText('Browser test', { exact: true })).toBeVisible();
  await expect(visitor.getByText('HTML fixture', { exact: true })).toBeVisible();
  await expect(visitor.getByText('Press the fixture button', { exact: true })).toBeVisible();
  await expect(visitor.getByText('Activate a focused button', { exact: true })).toBeVisible();
  await ensureWebVersion(admin);
  await visitor.reload();
  await expect(visitor.getByLabel('Game version')).toHaveValue(/.+/);
  const wasmResponse = visitor.waitForResponse(response => response.url().endsWith('/fixture.wasm'));
  const packResponse = visitor.waitForResponse(response => response.url().endsWith('/fixture.pck'));
  await visitor.getByRole('button', { name: 'Play in browser', exact: true }).first().click();
  const iframe = visitor.getByTitle('Play Browser fixture v1.0.0', { exact: true });
  await expect(iframe).toBeVisible();
  const frame = iframe.contentFrame();
  await expect(frame.getByRole('heading', { name: 'HTML fixture (not Godot)', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Run fixture interaction', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Fixture interaction succeeded');
  await expect(frame.getByText('crossOriginIsolated: true', { exact: true })).toBeVisible();
  expect(await visitor.evaluate(() => crossOriginIsolated)).toBe(true);
  await expect(frame.getByText('WASM instantiated', { exact: true })).toBeVisible();
  const wasm = await wasmResponse;
  expect(wasm.status()).toBe(200);
  expect(wasm.headers()['content-type']).toBe('application/wasm');
  expect(Buffer.from(await wasm.body())).toEqual(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  expect((await packResponse).headers()['content-type']).toBe('application/octet-stream');
  await expect(frame.getByText('Placeholder pack, not a Godot resource pack', { exact: true })).toBeVisible();
  await visitor.screenshot({ path: testInfo.outputPath('interactive-html-fixture.png'), fullPage: true });
  const downloading = visitor.waitForEvent('download');
  await visitor.getByRole('link', { name: 'Download HTML fixture (.zip)', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('browser-fixture-download.zip');
  const target = testInfo.outputPath('browser-fixture-download.zip');
  await download.saveAs(target);
  expect(await download.failure()).toBeNull();
  expect(await readFile(target)).toEqual(DOWNLOAD_ZIP);
  await visitor.getByRole('tab', { name: 'Version history', exact: true }).click();
  await expect(visitor.getByRole('tabpanel').getByRole('heading', { name: /^v1\.0\.0/ })).toBeVisible();
  await home(visitor);
  for (const filter of ['Play in browser', 'Released']) {
    await visitor.getByRole('button', { name: filter, exact: true }).click();
    await expect(visitor.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
    await expect(visitor.getByRole('heading', { name: 'Little Green World', exact: true })).toHaveCount(0);
  }
});

test('older version is preserved privately when hidden; invalid web ZIP shows feedback', async ({ actors }) => {
  const admin = await actors.page();
  const visitor = await actors.page();
  await studio(admin);
  await openGameEditor(admin);
  await ensureWebVersion(admin);
  await admin.getByRole('button', { name: 'Add version', exact: true }).click();
  await admin.getByLabel('Version name', { exact: true }).first().fill('v0.1');
  let older = versionEditor(admin, 'v0.1');
  await older.getByLabel('Release date', { exact: true }).fill('2026-01-01');
  await older.getByRole('textbox', { name: 'Release notes', exact: true }).fill('Older browser fixture release, kept for editing.');
  await save(admin);
  await publicFixture(visitor);
  await expect(visitor.getByLabel('Game version').getByRole('option')).toHaveCount(2);
  await visitor.getByRole('tab', { name: 'Version history', exact: true }).click();
  await expect(visitor.getByRole('tabpanel').getByRole('heading', { name: /^v0\.1/ })).toBeVisible();
  await older.getByRole('checkbox', { name: 'Show this version publicly', exact: true }).uncheck();
  await save(admin);
  await visitor.reload();
  await expect(visitor.getByLabel('Game version').getByRole('option')).toHaveText(['v1.0.0 — latest']);
  await visitor.getByRole('tab', { name: 'Version history', exact: true }).click();
  await expect(visitor.getByRole('tabpanel').getByRole('heading', { name: /^v0\.1/ })).toHaveCount(0);
  await expect(visitor.getByRole('tabpanel').getByRole('heading', { name: /^v1\.0\.0/ })).toBeVisible();
  await admin.reload();
  await expect(admin.getByRole('navigation', { name: 'Studio navigation' })).toBeVisible();
  await openGameEditor(admin);
  older = versionEditor(admin, 'v0.1');
  await expect(older.getByLabel('Version name', { exact: true })).toHaveValue('v0.1');
  await expect(older.getByRole('checkbox', { name: 'Show this version publicly', exact: true })).not.toBeChecked();
  await expect(admin.getByLabel('Version name', { exact: true })).toHaveCount(2);
  const current = versionEditor(admin, 'v1.0.0');
  const originalUrl = await current.getByLabel('Web build URL', { exact: true }).inputValue();
  actors.allowHttpError('/api/admin/uploads?kind=build', 400);
  await upload(admin, current, 'Upload Godot web export (.zip)', 'invalid.zip', Buffer.from('This is not a ZIP archive.'), 400);
  await expect(current.getByRole('alert')).toHaveText('Upload a valid, unencrypted ZIP archive.');
  await expect(current.getByLabel('Web build URL', { exact: true })).toHaveValue(originalUrl);
});

test('review requires stars, stays pending, then admin Feedback publishes comment and rating', async ({ actors }) => {
  const admin = await actors.page();
  const visitor = await actors.page();
  await studio(admin);
  await openGameEditor(admin);
  await publicFixture(visitor);
  await visitor.getByRole('tab', { name: /^Comments/ }).click();
  await visitor.getByLabel('Your name', { exact: true }).fill('Browser reviewer');
  await visitor.getByLabel('Your thoughts', { exact: true }).fill(REVIEW);
  await visitor.getByRole('button', { name: 'Leave a little feedback', exact: true }).click();
  await expect(visitor.getByRole('alert')).toHaveText('Choose a star rating first.');
  await visitor.getByRole('button', { name: 'Rate 4 stars', exact: true }).click();
  await expect(visitor.getByRole('button', { name: 'Rate 4 stars', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await visitor.getByRole('button', { name: 'Leave a little feedback', exact: true }).click();
  await expect(visitor.getByRole('heading', { name: 'Thanks for helping this game grow.' })).toBeVisible();
  await expect(visitor.getByText('Your review has been submitted for approval.', { exact: true })).toBeVisible();
  await visitor.reload();
  await visitor.getByRole('tab', { name: /^Comments/ }).click();
  await expect(visitor.getByText(REVIEW, { exact: true })).toHaveCount(0);
  await expect(visitor.getByText('No reviews yet. Yours could be the first.', { exact: true })).toBeVisible();
  await expect(visitor.getByText('1 ratings', { exact: true })).toHaveCount(0);
  await admin.reload();
  await expect(admin.getByRole('navigation', { name: 'Studio navigation' })).toBeVisible();
  await studioTab(admin, 'Feedback');
  const moderation = admin.getByRole('article').filter({ hasText: REVIEW });
  await expect(moderation.getByText('pending', { exact: true })).toBeVisible();
  await expect(moderation.getByText('4 / 5', { exact: true })).toBeVisible();
  await moderation.getByRole('button', { name: 'Approve & publish', exact: true }).click();
  await expect(admin.getByRole('status')).toContainText('Review approved and published.');
  await expect(moderation.getByText('approved', { exact: true })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByText('1 ratings', { exact: true })).toBeVisible();
  await expect(visitor.locator('.game-rating')).toContainText('4.0');
  await visitor.getByRole('tab', { name: /^Comments/ }).click();
  const review = visitor.getByRole('article').filter({ hasText: REVIEW });
  await expect(review.getByText('Browser reviewer', { exact: true })).toBeVisible();
  await expect(review.getByText(REVIEW, { exact: true })).toBeVisible();
  await home(visitor);
  const card = visitor.getByRole('link').filter({ has: visitor.getByRole('heading', { name: TITLE, exact: true }) });
  await expect(card).toContainText('4.0');
  await expect(card).toContainText('(1)');
});

test('journal UI publishes a note; home modal traps focus and Escape restores the trigger', async ({ actors }) => {
  const admin = await actors.page();
  const visitor = await actors.page();
  await studio(admin);
  await studioTab(admin, 'Journal');
  await admin.getByRole('button', { name: 'New note', exact: true }).click();
  await admin.getByLabel('Title', { exact: true }).fill('Browser journal note');
  await admin.getByLabel('Category', { exact: true }).fill('Browser diary');
  await admin.getByLabel('Date', { exact: true }).fill('2026-11-11');
  await admin.getByLabel('Your note').fill('This note was published using the browser editor.\nA second paragraph remains readable in the modal.');
  await admin.getByRole('checkbox', { name: 'Publicly visible', exact: true }).check();
  await save(admin);
  await home(visitor);
  const trigger = visitor.getByRole('button').filter({ has: visitor.getByRole('heading', { name: 'Browser journal note', exact: true }) });
  await trigger.click();
  const dialog = visitor.getByRole('dialog', { name: 'Browser journal note', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('A second paragraph remains readable in the modal.');
  const close = dialog.getByRole('button', { name: 'Close note', exact: true });
  await expect(close).toBeFocused();
  await visitor.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await visitor.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await visitor.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await visitor.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await admin.reload();
  await expect(admin.getByRole('navigation', { name: 'Studio navigation' })).toBeVisible();
  await studioTab(admin, 'Journal');
  await expect(admin.getByRole('article').filter({ hasText: 'Browser journal note' })).toContainText('PUBLIC');
});

test('populated mobile 390 and 320: public game, iframe and every studio section fit', async ({ actors }, testInfo) => {
  const admin = await actors.page();
  const visitor = await actors.page();
  await studio(admin);
  await openGameEditor(admin);
  await ensureWebVersion(admin);
  for (const width of [390, 320]) {
    await admin.setViewportSize({ width, height: 844 });
    await visitor.setViewportSize({ width, height: 844 });
    await home(visitor);
    await noOverflow(visitor, `${width}-populated-home`, testInfo);
    await publicFixture(visitor);
    await mobileMenu(visitor);
    await noOverflow(visitor, `${width}-published-detail`, testInfo);
    // Pick the playable release even when a worker restart left an older public version.
    await visitor.getByLabel('Game version').selectOption({ label: 'v1.0.0 — latest' });
    await visitor.getByRole('button', { name: 'Play in browser', exact: true }).first().click();
    const frame = visitor.getByTitle('Play Browser fixture v1.0.0', { exact: true }).contentFrame();
    await frame.getByRole('button', { name: 'Run fixture interaction', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Fixture interaction succeeded');
    await expect(frame.getByText('WASM instantiated', { exact: true })).toBeVisible();
    await noOverflow(visitor, `${width}-playing-detail`, testInfo);
    await visitor.getByRole('tab', { name: /^Comments/ }).click();
    await noOverflow(visitor, `${width}-published-comments`, testInfo);
    for (const tab of ['Website', 'Spotlight', 'Games', 'Journal', 'Feedback', 'Insights']) {
      await studioTab(admin, tab);
      await noOverflow(admin, `${width}-studio-${tab}`, testInfo);
    }
    await openGameEditor(admin);
    await noOverflow(admin, `${width}-studio-game-editor`, testInfo);
  }
});

test('Insights counts visitor actions, deduplicates reloads, and excludes creators and privacy opt-outs', async ({ actors }, testInfo) => {
  const admin = await actors.page();
  const visitor = await actors.page();
  await studio(admin);
  await openGameEditor(admin);
  await ensureWebVersion(admin);
  const readInsights = async () => {
    const response = await admin.request.get(`${origin}/api/admin/analytics?days=30`);
    expect(response.status()).toBe(200);
    return response.json();
  };
  const before = await readInsights();
  const fixture = before.games.find(game => game.title === TITLE);
  const journal = before.posts.find(post => post.visible);
  expect(journal).toBeTruthy();
  const action = async (type, callback) => {
    const response = visitor.waitForResponse(response => response.url() === `${origin}/api/events` && response.request().postDataJSON()?.type === type);
    await callback();
    expect((await response).status()).toBe(204);
  };
  await action('site_view', () => home(visitor));
  await action('site_view', () => visitor.reload());
  const post = visitor.getByRole('button').filter({ has: visitor.getByRole('heading', { name: journal.title, exact: true }) });
  await action('post_view', () => post.click());
  await visitor.keyboard.press('Escape');
  await action('post_view', () => post.click());
  await visitor.keyboard.press('Escape');
  await action('game_view', () => visitor.goto(`/games/${fixture.id}`));
  await action('game_view', () => visitor.reload());
  await action('play', () => visitor.getByRole('button', { name: 'Play in browser', exact: true }).first().click());
  await expect(visitor.getByTitle('Play Browser fixture v1.0.0', { exact: true }).contentFrame().getByRole('heading')).toBeVisible();
  const downloading = visitor.waitForEvent('download');
  await action('download', () => visitor.getByRole('link', { name: 'Download HTML fixture (.zip)', exact: true }).click());
  expect(await (await downloading).failure()).toBeNull();
  const counted = await readInsights();
  for (const metric of ['siteViews', 'gameViews', 'playStarts', 'downloadClicks', 'postViews']) {
    expect(counted.totals[metric], metric).toBe(before.totals[metric] + 1);
  }
  expect(counted.ratings).toEqual(before.ratings);
  expect(counted.games.find(game => game.id === fixture.id).views).toBe(fixture.views + 1);
  await admin.goto(`/games/${fixture.id}`);
  await admin.waitForLoadState('networkidle');
  expect((await readInsights()).totals).toEqual(counted.totals);
  for (const preference of ['doNotTrack', 'globalPrivacyControl']) {
    const privatePage = await actors.page();
    const requests = [];
    privatePage.on('request', request => { if (request.url().endsWith('/api/events')) requests.push(request.url()); });
    await privatePage.addInitScript(key => Object.defineProperty(navigator, key, { get: () => key === 'doNotTrack' ? '1' : true }), preference);
    await home(privatePage);
    await privatePage.waitForLoadState('networkidle');
    expect(requests).toEqual([]);
    expect(await privatePage.evaluate(() => sessionStorage.getItem('khoifee-visit'))).toBeNull();
  }
  await admin.goto('/studio');
  await studioTab(admin, 'Insights');
  await expect(admin.getByRole('heading', { name: 'See your worlds grow.' })).toBeVisible();
  await expect(admin.locator('.insight-stat').filter({ hasText: 'Game page views' }).locator('strong')).toHaveText(String(counted.totals.gameViews));
  await admin.getByLabel('Date range').selectOption('7');
  await expect(admin.locator('.activity-chart svg')).toHaveAttribute('aria-label', /last 7 days/);
  await admin.getByRole('button', { name: 'Download clicks', exact: true }).click();
  await expect(admin.locator('.activity-chart svg')).toHaveAttribute('aria-label', /^Download clicks/);
  await admin.getByText('View daily counts', { exact: true }).click();
  await expect(admin.locator('.daily-counts tbody tr')).toHaveCount(7);
  await admin.getByLabel('Date range').selectOption('90');
  await expect(admin.locator('.daily-counts tbody tr')).toHaveCount(90);
  await admin.getByLabel('Date range').selectOption('30');
  await expect(admin.locator('.daily-counts tbody tr')).toHaveCount(30);
  await admin.getByText('View daily counts', { exact: true }).click();
  await admin.getByRole('button', { name: 'Refresh insights' }).click();
  await expect(admin.getByRole('button', { name: 'Refresh insights' })).toBeEnabled();
  for (const width of [1440, 390, 320]) {
    await admin.setViewportSize({ width, height: 1000 });
    await noOverflow(admin, `insights-${width}`, testInfo);
    await admin.screenshot({ path: path.join(OUTPUT, `insights-${width}.png`), fullPage: true });
  }
});

test('bad login rejected, good login opens editor, logout protects fresh and reloaded studio', async ({ actors }, testInfo) => {
  // Ensure setup after a worker restart using the UI, but don't consume a login.
  const page = await actors.page();
  await page.goto('/studio');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (await page.getByLabel('Setup token').count()) {
    await setup(page);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Welcome back, creator.' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('incorrect-browser-password');
  actors.allowHttpError('/api/auth/login', 401);
  await page.getByRole('button', { name: 'Enter the studio', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid password.');
  await expect(page.getByRole('textbox', { name: 'Introduction', exact: true })).toHaveCount(0);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Enter the studio', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Introduction', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, creator.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Introduction', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back, creator.' })).toBeVisible();
  const fresh = await actors.page({ width: 320, height: 844 });
  await fresh.goto('/studio');
  await expect(fresh.getByRole('heading', { name: 'Welcome back, creator.' })).toBeVisible();
  await expect(fresh.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
  await noOverflow(fresh, '320-studio-login', testInfo);
});
