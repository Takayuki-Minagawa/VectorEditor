import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Language: English', exact: true }).or(page.getByRole('button', { name: '言語: English', exact: true })).click();
  await expect(page.locator('canvas.upper-canvas')).toBeVisible();
}
const fixture = {
  version: 2, documentId: 'test-drawing', drawingMode: 'cad', cadUnit: 'mm', cadWidth: 800, cadHeight: 600,
  canvas: { width: 800, height: 600, backgroundColor: '#ffffff' }, objects: { objects: [
    { type: 'Rect', id: 'test-rect', name: 'Test rectangle', left: 100, top: 100, originX: 'left', originY: 'top', width: 200, height: 100, strokeWidth: 0, fill: '#4488cc' },
  ] },
};
async function loadFixture(page: Page, value: unknown = fixture) {
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: 'drawing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await expect(page.locator('.layer-label').filter({ hasText: 'Test rectangle' })).toBeVisible();
}
async function clickPoint(page: Page, x: number, y: number) {
  const position = await page.evaluate(async ({ x, y }) => {
    const modulePath = '/VectorEditor/src/store/useEditorStore.ts';
    const { useEditorStore } = await import(modulePath);
    const canvas = useEditorStore.getState().canvas;
    const v = canvas.viewportTransform;
    const b = canvas.upperCanvasEl.getBoundingClientRect();
    return { x: b.x + v[0] * x + v[2] * y + v[4], y: b.y + v[1] * x + v[3] * y + v[5] };
  }, { x, y });
  await page.mouse.click(position.x, position.y);
}
async function saveJson(page: Page) {
  const promise = page.waitForEvent('download');
  await page.locator('.toolbar').getByRole('button', { name: 'Save', exact: true }).click();
  const download = await promise; return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

test('export presets survive reload and affect actual PNG dimensions and CAD PDF paper', async ({ page }) => {
  await open(page);
  await page.locator('.toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Format', { exact: true }).selectOption('png');
  await page.getByLabel('Margin (px)', { exact: true }).fill('8');
  await page.getByRole('dialog').getByLabel('Scale', { exact: true }).selectOption('3');
  await page.getByLabel('Transparent', { exact: true }).check();
  await page.getByLabel('Preset name').fill('Transparent PNG');
  await page.getByRole('button', { name: 'Save new', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.locator('.toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export presets', { exact: true }).selectOption({ label: 'Transparent PNG' });
  await expect(page.getByLabel('Transparent', { exact: true })).toBeChecked();
  const promise = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const bytes = await readFile((await (await promise).path())!);
  expect(bytes.readUInt32BE(16)).toBe(2448); expect(bytes.readUInt32BE(20)).toBe(1848);
  await page.getByRole('button', { name: 'CAD', exact: true }).click();
  await page.locator('.toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByLabel('Export presets', { exact: true }).locator('option')).toHaveCount(1);
  await page.getByLabel('Preset name').fill('A4 PDF');
  await page.getByRole('button', { name: 'Save new', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export presets', { exact: true }).selectOption({ label: 'A4 PDF' });
  const pdfPromise = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const pdf = (await readFile((await (await pdfPromise).path())!)).toString('latin1');
  const box = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/)!;
  expect(Number(box[1]) * 25.4 / 72).toBeCloseTo(297, 1);
});

test('calibrates selected geometry with two clicks, preserves origin, undoes and reloads JSON', async ({ page }) => {
  await open(page); await loadFixture(page);
  await page.locator('.layer-label').filter({ hasText: 'Test rectangle' }).click();
  await page.getByRole('button', { name: 'Calibrate size', exact: true }).click();
  await clickPoint(page, 100, 100); await clickPoint(page, 300, 100);
  await expect(page.getByRole('dialog', { name: 'Calibrate size' })).toBeVisible();
  await page.getByLabel('Known length').fill('1'); await page.getByRole('dialog').getByLabel('Unit', { exact: true }).selectOption('m');
  await expect(page.getByText('Scale factor: 5×', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply calibration', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await saveJson(page);
  expect(saved.objects.objects[0].scaleX).toBe(5);
  expect(saved.objects.objects[0].left).toBeCloseTo(100);
  expect(saved.objects.objects[0].top).toBeCloseTo(100);
  await page.locator('.toolbar').getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saveJson(page)).objects.objects[0].scaleX).toBe(1);
  await loadFixture(page, saved);
  expect((await saveJson(page)).objects.objects[0].scaleX).toBe(5);
});

test('measures area, distance and angle without adding objects; Escape cancels', async ({ page }) => {
  await open(page); await loadFixture(page);
  await page.locator('.layer-label').filter({ hasText: 'Test rectangle' }).click();
  await page.getByRole('button', { name: 'Area / perimeter', exact: true }).click();
  await expect(page.getByText('Area (excluding holes): 20000 mm²', { exact: true })).toBeVisible();
  await expect(page.getByText('Outer perimeter: 600 mm', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByLabel('Unit', { exact: true }).selectOption('cm');
  await expect(page.getByText('Area (excluding holes): 200 cm²', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Measure distance', exact: true }).click();
  await clickPoint(page, 100, 100); await clickPoint(page, 300, 100);
  await expect(page.getByText('Distance: 200 mm', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Measure angle', exact: true }).click();
  await clickPoint(page, 300, 100); await clickPoint(page, 100, 100); await clickPoint(page, 100, 200);
  await expect(page.getByText('Angle: 90°', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Measure angle', exact: true }).click();
  await clickPoint(page, 100, 100); await page.keyboard.press('Escape');
  await expect(page.locator('.geometry-instructions')).toHaveCount(0);
  expect((await saveJson(page)).objects.objects).toHaveLength(1);
});

test('exports a project backup, previews it and restores a second project', async ({ page }) => {
  await open(page); await loadFixture(page);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Portable drawing');
  await page.getByRole('button', { name: 'Save as new project', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  const bytes = await readFile((await (await promise).path())!);
  const backup = JSON.parse(bytes.toString()); expect(backup.projects).toHaveLength(1);
  await page.getByLabel('Backup JSON', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByText(/1 projects \/ 1 versions \/ 0 symbols/)).toBeVisible();
  await page.getByRole('button', { name: 'Restore as copies', exact: true }).click();
  await expect(page.getByText('Backup restored. Open it from Projects or Symbols.', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(2);
});

test('calibrates multiple objects after zoom and pan, and cancels without changing geometry', async ({ page }) => {
  await open(page);
  const multi = { ...fixture, objects: { objects: [...fixture.objects.objects,
    { ...fixture.objects.objects[0], id: 'second', name: 'Second rectangle', left: 400 },
  ] } };
  await loadFixture(page, multi);
  await page.locator('.layer-label').filter({ hasText: 'Test rectangle' }).click();
  await page.locator('.layer-label').filter({ hasText: 'Second rectangle' }).click({ modifiers: ['ControlOrMeta'] });
  await page.getByRole('button', { name: 'Calibrate size', exact: true }).click();
  await clickPoint(page, 100, 100);
  await page.keyboard.press('Escape');
  expect((await saveJson(page)).objects.objects.map((o: { scaleX: number }) => o.scaleX)).toEqual([1, 1]);
  await page.locator('.layer-label').filter({ hasText: 'Test rectangle' }).click();
  await page.locator('.layer-label').filter({ hasText: 'Second rectangle' }).click({ modifiers: ['ControlOrMeta'] });
  await page.getByRole('button', { name: 'Calibrate size', exact: true }).click();
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -120);
  await page.keyboard.down('Space'); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10);
  await page.mouse.up(); await page.keyboard.up('Space');
  await clickPoint(page, 100, 100); await clickPoint(page, 300, 100);
  await page.getByLabel('Known length').fill('400');
  await page.getByRole('button', { name: 'Apply calibration', exact: true }).click();
  const saved = await saveJson(page);
  expect(saved.objects.objects[0].left).toBeCloseTo(100);
  expect(saved.objects.objects[1].left).toBeCloseTo(700);
  expect(saved.objects.objects.map((o: { scaleX: number }) => o.scaleX)).toEqual([2, 2]);
});

test('a selection preset cannot export without a selection; presets can be updated and deleted', async ({ page }) => {
  await open(page); await loadFixture(page);
  await page.locator('.layer-label').filter({ hasText: 'Test rectangle' }).click();
  await page.locator('.toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Area', { exact: true }).selectOption('selection');
  await page.getByLabel('Preset name').fill('Selection');
  await page.getByRole('button', { name: 'Save new', exact: true }).click();
  await page.getByLabel('Preset name').fill('Renamed selection');
  await page.getByRole('button', { name: 'Update preset', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await clickPoint(page, 700, 500);
  await page.locator('.toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export presets', { exact: true }).selectOption({ label: 'Renamed selection' });
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByLabel('Export presets', { exact: true }).locator('option')).toHaveCount(1);
});
