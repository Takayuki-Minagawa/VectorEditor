import { expect, test, type Page } from '@playwright/test';

const fixture = {
  version: 2,
  documentId: 'startup-restore',
  drawingMode: 'illustration',
  cadUnit: 'mm',
  cadWidth: 800,
  cadHeight: 600,
  canvas: { width: 800, height: 600, backgroundColor: '#ffffff' },
  objects: { objects: [
    { type: 'Rect', id: 'rectangle', name: 'Reference rectangle', left: 100, top: 100, width: 200, height: 100, stroke: '#008800', strokeWidth: 2, fill: 'transparent' },
  ] },
};

async function objectCount(page: Page) {
  return page.evaluate(async () => {
    const path = '/VectorEditor/src/store/useEditorStore.ts';
    const { useEditorStore } = await import(path);
    return useEditorStore.getState().canvas?.getObjects().length ?? -1;
  });
}

async function autoSaveExists(page: Page) {
  return page.evaluate(() => new Promise<boolean>((resolve) => {
    const request = indexedDB.open('vectoreditor-autosave', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('snapshots', { keyPath: 'key' });
    };
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const database = request.result;
      try {
        const get = database.transaction('snapshots', 'readonly').objectStore('snapshots').get('current');
        get.onsuccess = () => { database.close(); resolve(Boolean(get.result)); };
        get.onerror = () => { database.close(); resolve(false); };
      } catch {
        database.close();
        resolve(false);
      }
    };
  }));
}

async function loadFixtureAndWaitForAutoSave(page: Page) {
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: 'drawing.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator('.layer-label').filter({ hasText: 'Reference rectangle' })).toBeVisible();
  // Auto-save runs on a 10 second interval.
  await expect.poll(() => autoSaveExists(page), { timeout: 25_000, intervals: [500] }).toBe(true);
}

test.describe('startup restore', () => {
  test.setTimeout(90_000);

  test('restores the auto-saved document without a blocking dialog by default', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas.upper-canvas')).toBeVisible();
    await loadFixtureAndWaitForAutoSave(page);

    await page.reload();
    await expect(page.locator('.layer-label').filter({ hasText: 'Reference rectangle' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => objectCount(page)).toBe(1);
    // The editor is interactive straight away: no inert wrapper, no blocker.
    await expect(page.locator('.app-interactive')).not.toHaveAttribute('inert', '');
    await expect(page.locator('.restore-blocker')).toHaveCount(0);
  });

  test('?restore=ask shows the confirmation dialog and ?restore=discard starts blank', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas.upper-canvas')).toBeVisible();
    await loadFixtureAndWaitForAutoSave(page);

    await page.goto('./?restore=ask');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('前回の作業を復元');
    await dialog.getByRole('button', { name: '復元する', exact: true }).click();
    await expect(page.locator('.layer-label').filter({ hasText: 'Reference rectangle' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('./?restore=discard');
    await expect(page.locator('canvas.upper-canvas')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => objectCount(page)).toBe(0);
    await expect.poll(() => autoSaveExists(page)).toBe(false);
  });

  test('the dialog can switch future launches to automatic restore', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas.upper-canvas')).toBeVisible();
    await loadFixtureAndWaitForAutoSave(page);

    await page.evaluate(() => localStorage.setItem('vectoreditor-startup-restore-v1', 'ask'));
    await page.reload();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: '復元する', exact: true }).click();
    await expect(page.locator('.layer-label').filter({ hasText: 'Reference rectangle' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('vectoreditor-startup-restore-v1'))).toBeNull();

    await page.reload();
    await expect(page.locator('.layer-label').filter({ hasText: 'Reference rectangle' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
