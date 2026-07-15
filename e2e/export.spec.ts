import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

async function downloadFromExportDialog(page: import('@playwright/test').Page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: '出力', exact: true }).click();
  return downloadPromise;
}

async function openEditorInJapanese(page: import('@playwright/test').Page) {
  await page.goto('./');
  await page.locator('.header-right button.lang-btn').filter({ hasText: '日本語' }).click();
}

async function exportSvg(page: import('@playwright/test').Page): Promise<string> {
  await page.locator('.toolbar').getByRole('button', { name: '出力', exact: true }).click();
  await page.getByLabel('形式').selectOption('svg');
  const download = await downloadFromExportDialog(page);
  const path = await download.path();
  if (!path) throw new Error('The SVG download has no local path.');
  return readFile(path, 'utf8');
}

test('SVG dimensions do not depend on the editor zoom', async ({ page }) => {
  await openEditorInJapanese(page);

  const zoomOut = page.locator('.status-zoom-btn').filter({ hasText: '−' });
  await zoomOut.click();
  await zoomOut.click();
  await expect(page.locator('.status-zoom-label')).toHaveText('50%');
  const zoomedOutSvg = await exportSvg(page);

  await page.getByRole('button', { name: '表示倍率を100%に戻す', exact: true }).click();
  const zoomIn = page.locator('.status-zoom-btn').filter({ hasText: '+' });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  await expect(page.locator('.status-zoom-label')).toHaveText('200%');
  const zoomedInSvg = await exportSvg(page);

  for (const svg of [zoomedOutSvg, zoomedInSvg]) {
    expect(svg).toContain('width="1600px"');
    expect(svg).toContain('height="1200px"');
    expect(svg).toContain('viewBox="0 0 800 600"');
  }
});

test('CAD PDF uses the selected A4 landscape paper dimensions in millimetres', async ({ page }) => {
  await openEditorInJapanese(page);
  await page.getByRole('button', { name: 'CAD', exact: true }).click();
  await expect(page.locator('.canvas-wrapper')).toHaveClass(/cad-mode/);
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  const canvas = page.locator('canvas.upper-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The drawing canvas has no bounding box.');
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 220);
  await page.mouse.up();

  await page.locator('.toolbar').getByRole('button', { name: '出力', exact: true }).click();
  await page.getByLabel('形式').selectOption('pdf');
  await page.getByLabel('用紙サイズ').selectOption('4');
  await page.getByLabel('方向').selectOption('landscape');
  const download = await downloadFromExportDialog(page);
  const path = await download.path();
  if (!path) throw new Error('The PDF download has no local path.');

  const pdf = (await readFile(path)).toString('latin1');
  const mediaBox = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  expect(mediaBox).not.toBeNull();
  const widthMm = Number(mediaBox?.[1]) * 25.4 / 72;
  const heightMm = Number(mediaBox?.[2]) * 25.4 / 72;
  expect(widthMm).toBeCloseTo(297, 1);
  expect(heightMm).toBeCloseTo(210, 1);
});

test('copies a PNG export with ClipboardItem when the browser supports it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEditorInJapanese(page);
  await page.locator('.toolbar').getByRole('button', { name: '出力', exact: true }).click();
  await page.getByLabel('形式').selectOption('png');

  const copyButton = page.getByRole('dialog').getByRole('button', {
    name: 'クリップボードへコピー',
    exact: true,
  });
  await expect(copyButton).toBeEnabled();
  await copyButton.click();
  await expect(page.getByText('クリップボードへコピーしました')).toBeVisible();

  const clipboardTypes = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return items.flatMap((item) => item.types);
  });
  expect(clipboardTypes).toContain('image/png');
});

test('downloads R12 ASCII DXF and warns when an object is unsupported', async ({ page }) => {
  await openEditorInJapanese(page);
  const canvas = page.locator('canvas.upper-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The drawing canvas has no bounding box.');

  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  await page.getByRole('button', { name: '三角', exact: true }).click();
  await page.mouse.move(box.x + 220, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 160);
  await page.mouse.up();

  await page.getByRole('button', { name: 'CAD', exact: true }).click();
  await page.locator('.toolbar').getByRole('button', { name: '出力', exact: true }).click();
  await page.getByLabel('形式').selectOption('dxf');
  const download = await downloadFromExportDialog(page);
  const path = await download.path();
  if (!path) throw new Error('The DXF download has no local path.');
  const dxf = await readFile(path, 'ascii');

  expect(dxf).toContain('AC1009');
  expect(dxf).toMatch(/0\r\nPOLYLINE\r\n/);
  expect(dxf).not.toContain('LWPOLYLINE');
  await expect(page.getByText(/未対応.*Triangle/)).toBeVisible();
});
