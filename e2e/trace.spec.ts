import { expect, test } from '@playwright/test';

test('vectorizes a small PNG, previews it, inserts it, and undoes once', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      (url.protocol === 'http:' || url.protocol === 'https:')
      && url.hostname !== '127.0.0.1'
      && url.hostname !== 'localhost'
    ) {
      externalRequests.push(request.url());
    }
  });

  await page.setContent(`
    <div
      id="trace-fixture"
      style="position:relative;width:48px;height:48px;background:#fff"
    >
      <span style="position:absolute;left:7px;top:8px;width:13px;height:12px;background:#000"></span>
      <span style="position:absolute;left:28px;top:26px;width:12px;height:14px;background:#000"></span>
    </div>
  `);
  const png = await page.locator('#trace-fixture').screenshot();

  await page.goto('./');
  await page.locator('.toolbar').getByRole('button', {
    name: 'ベクター化',
    exact: true,
  }).click();

  const dialog = page.getByRole('dialog', { name: '画像をベクター化' });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'small-trace.png',
    mimeType: 'image/png',
    buffer: png,
  });

  await expect(dialog.locator('svg[role="img"]')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator('.trace-stats')).toContainText('図形: 2');
  await dialog.getByRole('button', { name: 'キャンバスに挿入', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('.layer-list [role="treeitem"]')).toHaveCount(2);
  const undo = page.locator('.toolbar').getByRole('button', {
    name: '戻す',
    exact: true,
  });
  await expect(undo).toBeEnabled();
  await undo.click();

  await expect(page.locator('.layer-list [role="treeitem"]')).toHaveCount(0);
  await expect(page.getByText('オブジェクトなし', { exact: true })).toBeVisible();
  expect(externalRequests).toEqual([]);
});
