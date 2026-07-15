import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openCadEditorInJapanese(page: Page): Promise<void> {
  await page.goto('./');
  await page.locator('.header-right button.lang-btn').filter({ hasText: '日本語' }).click();
  await expect(page.locator('canvas.upper-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'CAD', exact: true }).click();
  await expect(page.locator('.canvas-wrapper')).toHaveClass(/cad-mode/);
}

type FractionPoint = readonly [x: number, y: number];

async function drawShape(
  page: Page,
  tool: '矩形' | '円',
  start: FractionPoint,
  end: FractionPoint,
): Promise<void> {
  await page.getByRole('button', { name: tool, exact: true }).click();
  const canvas = page.locator('canvas.upper-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The drawing canvas has no bounding box.');

  await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1]);
  await page.mouse.up();
}

async function drawRectangle(
  page: Page,
  start: FractionPoint = [0.3, 0.3],
  end: FractionPoint = [0.6, 0.55],
): Promise<void> {
  await drawShape(page, '矩形', start, end);
}

function layersNamed(page: Page, label: string) {
  return page.locator('.layer-list .layer-item').filter({
    has: page.locator('.layer-label', { hasText: label }),
  });
}

function sectionLayer(page: Page) {
  return layersNamed(page, '断面プロファイル').first();
}

async function selectedSectionArea(page: Page): Promise<number> {
  const panel = page.locator('.section-properties-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('断面積 A', { exact: true })).toBeVisible();
  await expect(panel.getByText('重心軸断面二次モーメント', { exact: true })).toBeVisible();

  const output = panel.locator('.section-result-row').filter({
    has: page.getByText('A', { exact: true }),
  }).locator('output');
  await expect(output).toContainText('mm²');
  const text = (await output.textContent()) ?? '';
  const area = Number(text.replace(/[^0-9.eE+-]/g, ''));
  expect(area).toBeGreaterThan(0);
  return area;
}

async function exportCurrentDrawing(page: Page, format: 'svg' | 'png' | 'pdf'): Promise<Buffer> {
  await page.locator('.toolbar').getByRole('button', { name: '出力', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('形式').selectOption(format);
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '出力', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error(`The ${format.toUpperCase()} export has no local path.`);
  return readFile(path);
}

test('generates a dimension-driven H-section and preserves it through history', async ({ page }) => {
  await openCadEditorInJapanese(page);
  await page.locator('.toolbar').getByRole('button', { name: '断面', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '断面の作成・編集' });
  await expect(dialog.locator('#section-panel-standard')).toBeVisible();
  await expect(dialog.locator('#section-panel-edit')).toBeHidden();
  await dialog.getByRole('tab', { name: '選択形状を編集' }).click();
  await expect(dialog.locator('#section-panel-standard')).toBeHidden();
  await expect(dialog.locator('#section-panel-edit')).toBeVisible();
  await dialog.getByRole('tab', { name: '基本形状から生成' }).click();
  await expect(dialog.locator('#section-panel-standard')).toBeVisible();
  await expect(dialog.locator('#section-panel-edit')).toBeHidden();
  await dialog.getByRole('combobox', { name: '断面種類' }).selectOption('h-section');
  await dialog.getByRole('button', { name: '断面形状を生成' }).click();
  await expect(page.getByText('基本断面を生成しました。')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(layersNamed(page, 'H形鋼')).toHaveCount(1);
  expect(await selectedSectionArea(page)).toBeCloseTo(4_533, 5);

  await page.locator('.toolbar').getByRole('button', { name: '戻す', exact: true }).click();
  await expect(layersNamed(page, 'H形鋼')).toHaveCount(0);

  await page.locator('.toolbar').getByRole('button', { name: 'やり直し', exact: true }).click();
  await expect(layersNamed(page, 'H形鋼')).toHaveCount(1);
  await layersNamed(page, 'H形鋼').click();
  expect(await selectedSectionArea(page)).toBeCloseTo(4_533, 5);
});

test('creates a CAD section, shows its properties, and preserves it through history and JSON reload', async ({ page }) => {
  await openCadEditorInJapanese(page);
  await drawRectangle(page);
  await expect(page.locator('.layer-list .layer-label')).toHaveText('矩形');

  await page.locator('.toolbar').getByRole('button', { name: '断面', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '断面の作成・編集' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '断面を作成', exact: true }).click();
  await expect(page.getByText('断面を更新しました。')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(sectionLayer(page)).toBeVisible();
  const originalArea = await selectedSectionArea(page);

  await page.locator('.toolbar').getByRole('button', { name: '戻す', exact: true }).click();
  await expect(page.locator('.layer-list .layer-label')).toHaveText('矩形');
  await expect(page.locator('.section-properties-panel')).toHaveCount(0);

  await page.locator('.toolbar').getByRole('button', { name: 'やり直し', exact: true }).click();
  await expect(sectionLayer(page)).toBeVisible();
  await sectionLayer(page).click();
  expect(await selectedSectionArea(page)).toBe(originalArea);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.toolbar').getByRole('button', { name: '保存', exact: true }).click();
  const download = await downloadPromise;
  const savedPath = await download.path();
  if (!savedPath) throw new Error('The saved project has no local path.');

  await page.locator('.toolbar').getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.locator('.layer-list .layer-label')).toHaveCount(0);

  await page.locator('input[type="file"][accept=".json"]').setInputFiles(savedPath);
  await expect(page.getByText('プロジェクトを読み込みました')).toBeVisible();
  await expect(sectionLayer(page)).toBeVisible();
  await sectionLayer(page).click();
  expect(await selectedSectionArea(page)).toBe(originalArea);
});

test('unions overlapping rectangles, cuts a circular hole, and restores both states through history', async ({ page }) => {
  await openCadEditorInJapanese(page);
  await drawRectangle(page, [0.25, 0.25], [0.5, 0.55]);
  await drawRectangle(page, [0.4, 0.38], [0.65, 0.68]);

  const rectangles = layersNamed(page, '矩形');
  await expect(rectangles).toHaveCount(2);
  await rectangles.nth(0).click();
  await rectangles.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.status-left')).toContainText('選択: 2');

  await page.locator('.toolbar').getByRole('button', { name: '断面', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '断面の作成・編集' });
  await dialog.getByRole('button', { name: '材料を合成', exact: true }).click();
  await page.keyboard.press('Escape');

  await expect(sectionLayer(page)).toBeVisible();
  await expect(rectangles).toHaveCount(0);
  const unionArea = await selectedSectionArea(page);

  await drawShape(page, '円', [0.43, 0.43], [0.49, 0.5]);
  const circle = layersNamed(page, '円');
  await expect(circle).toHaveCount(1);
  await sectionLayer(page).click();
  await circle.click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.status-left')).toContainText('選択: 2');

  await page.locator('.toolbar').getByRole('button', { name: '断面', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '断面の作成・編集' });
  await dialog.getByRole('button', { name: '選択形状で切り抜き', exact: true }).click();
  await page.keyboard.press('Escape');

  await expect(circle).toHaveCount(0);
  await expect(sectionLayer(page)).toBeVisible();
  const cutArea = await selectedSectionArea(page);
  expect(cutArea).toBeLessThan(unionArea);

  const svg = (await exportCurrentDrawing(page, 'svg')).toString('utf8');
  expect(svg).toMatch(/fill-rule:\s*evenodd|fill-rule="evenodd"/);
  expect([...await exportCurrentDrawing(page, 'png')].slice(0, 8)).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect((await exportCurrentDrawing(page, 'pdf')).subarray(0, 4).toString('ascii')).toBe('%PDF');

  await page.locator('.toolbar').getByRole('button', { name: '戻す', exact: true }).click();
  await expect(sectionLayer(page)).toBeVisible();
  await expect(circle).toHaveCount(1);
  await sectionLayer(page).click();
  expect(await selectedSectionArea(page)).toBe(unionArea);

  await page.locator('.toolbar').getByRole('button', { name: 'やり直し', exact: true }).click();
  await expect(circle).toHaveCount(0);
  await expect(sectionLayer(page)).toBeVisible();
  await sectionLayer(page).click();
  expect(await selectedSectionArea(page)).toBe(cutArea);
});

test('previews and applies a radius only to selected convex corners', async ({ page }) => {
  await openCadEditorInJapanese(page);
  await drawRectangle(page, [0.3, 0.3], [0.62, 0.58]);

  await page.locator('.toolbar').getByRole('button', { name: '断面', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '断面の作成・編集' });
  await dialog.getByRole('button', { name: '断面を作成', exact: true }).click();
  await page.keyboard.press('Escape');
  const rectangularArea = await selectedSectionArea(page);

  await page.locator('.toolbar').getByRole('button', { name: '断面', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '断面の作成・編集' });
  const corners = dialog.locator('.section-corner-row');
  await expect(corners).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(corners.nth(index).locator('input[type="checkbox"]')).toBeChecked();
  }
  await expect(dialog.getByText(/選択角の最大R:/)).toBeVisible();
  await expect(dialog.getByText('オレンジの破線が確定前のR形状です。')).toBeVisible();

  for (let index = 1; index < 4; index += 1) {
    await corners.nth(index).locator('input[type="checkbox"]').uncheck();
  }
  await expect(dialog.getByText('Rを適用する凸角 (1/4)')).toBeVisible();
  await dialog.getByRole('button', { name: '凸角にRを適用', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();

  const filletedArea = await selectedSectionArea(page);
  expect(filletedArea).toBeLessThan(rectangularArea);

  await page.locator('.toolbar').getByRole('button', { name: '戻す', exact: true }).click();
  await sectionLayer(page).click();
  expect(await selectedSectionArea(page)).toBe(rectangularArea);

  await page.locator('.toolbar').getByRole('button', { name: 'やり直し', exact: true }).click();
  await sectionLayer(page).click();
  expect(await selectedSectionArea(page)).toBe(filletedArea);
});
