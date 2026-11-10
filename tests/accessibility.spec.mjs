import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.mjs';

let app, server, dataDir, base;
test.beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'khoifee-accessibility-'));
  app = createApp({ dataDir, bootstrapToken: 'accessibility-fixture', production: true });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  app.locals.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function assertAccessible(page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
}

test('review form is accessible', async ({ page }) => {
  await page.goto(`${base}/games/little-green-world`);
  await page.getByRole('tab', { name: 'Comments' }).click();
  await assertAccessible(page);
});

for (const width of [1440, 390]) {
  for (const route of ['/', '/games/little-green-world', '/studio']) {
    test(`accessible ${route} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}${route}`);
      await page.waitForLoadState('networkidle');
      await assertAccessible(page);
    });
  }
}

test('creator forms have accessible labels and contrast', async ({ page }) => {
  const response = await page.request.post(`${base}/api/auth/setup`, {
    headers: { Origin: base },
    data: { token: 'accessibility-fixture', password: 'accessibility-test-password' },
  });
  expect(response.status()).toBe(201);
  await page.goto(`${base}/studio`);
  await page.getByRole('heading', { name: 'Make yourself at home.' }).waitFor();
  await assertAccessible(page);
  await page.getByRole('button', { name: 'Spotlight', exact: true }).click();
  await assertAccessible(page);
  await page.getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Edit game' }).first().click();
  await page.getByRole('button', { name: 'Add version', exact: true }).click();
  await assertAccessible(page);
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await page.getByRole('heading', { name: 'See your worlds grow.' }).waitFor();
  await page.locator('.insight-stat').first().waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertAccessible(page);
  }
  await page.getByText('View daily counts', { exact: true }).click();
  await assertAccessible(page);
});
