import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const fixture = { version: 2, documentId: 'interoperability', drawingMode: 'cad', cadUnit: 'mm', cadWidth: 800, cadHeight: 600,
  canvas: { width: 800, height: 600, backgroundColor: '#ffffff' }, objects: { objects: [
    { type: 'Rect', id: 'rectangle', name: 'Reference rectangle', left: 100, top: 100, width: 200, height: 100, stroke: '#008800', strokeWidth: 2, fill: 'transparent' },
  ] } };
async function open(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: '言語: English', exact: true }).or(page.getByRole('button', { name: 'Language: English', exact: true })).click();
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: 'drawing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.locator('.layer-label').filter({ hasText: 'Reference rectangle' })).toBeVisible();
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const path = '/VectorEditor/src/store/useEditorStore.ts'; const { useEditorStore } = await import(path);
    const s = useEditorStore.getState();
    return { layers: s.cadLayers, active: s.activeCadLayerId, history: s.history.length, objects: s.canvas.getObjects().map((o: { toObject: () => unknown }) => o.toObject()) };
  });
}
async function save(page: Page) {
  const download = page.waitForEvent('download');
  await page.locator('.toolbar').getByRole('button', { name: 'Save', exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}
async function focusEditor(page: Page) {
  await page.locator('.layer-label').filter({ hasText: 'Reference rectangle' }).first().click();
}

test('native clipboard copies internal objects and prefers new external PNG/SVG data', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page); await focusEditor(page);
  await page.keyboard.press('ControlOrMeta+C'); await page.keyboard.press('ControlOrMeta+V');
  await expect.poll(async () => (await state(page)).objects.length).toBe(2);
  const internal = await state(page); expect(new Set(internal.objects.map((o: { id: string }) => o.id)).size).toBe(2);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 3;
    c.getContext('2d')!.fillRect(0, 0, 4, 3);
    const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await page.keyboard.press('ControlOrMeta+V');
  await expect.poll(async () => (await state(page)).objects.at(-1).type).toBe('Image');
  expect((await state(page)).objects).toHaveLength(3);
  await page.keyboard.press('ControlOrMeta+Z'); await expect.poll(async () => (await state(page)).objects.length).toBe(2);
  await page.evaluate(() => navigator.clipboard.writeText('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="15" fill="#ff00ff"/></svg>'));
  await page.keyboard.press('ControlOrMeta+V');
  await expect.poll(async () => (await state(page)).objects.at(-1).type).toBe('Circle');
  expect((await state(page)).objects.at(-1).fill).toBe('#ff00ff');
  await page.getByLabel('Search layers').fill('');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.getByLabel('Search layers')).toHaveValue(/<svg/);
  expect((await state(page)).objects).toHaveLength(3);
});

test('rejects active SVG without changing objects or history', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await open(page); await focusEditor(page);
  const before = await state(page);
  await page.evaluate(() => navigator.clipboard.writeText('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.org/untrusted.png"/></svg>'));
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.getByText(/Cannot paste this image/)).toBeVisible();
  expect((await state(page)).objects).toEqual(before.objects); expect((await state(page)).history).toBe(before.history);
});

test('manages CAD layers, persists ByLayer styles and excludes non-printable geometry', async ({ page }) => {
  await open(page); await focusEditor(page);
  await page.getByRole('button', { name: 'Manage CAD layers', exact: true }).click();
  await page.getByRole('button', { name: 'Add CAD layer', exact: true }).click();
  await page.getByLabel('Layer name New layer', { exact: true }).fill('Walls');
  await page.getByRole('dialog').locator('input[type=color]').last().fill('#ff0000');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Drawing / assignment layer').selectOption({ label: 'Walls' });
  await page.getByRole('button', { name: 'By layer', exact: true }).click();
  await expect.poll(async () => (await state(page)).objects[0].stroke).toBe('#ff0000');
  const document = await save(page); expect(document.version).toBe(3); expect(document.cadLayers).toHaveLength(2);
  expect(document.objects.objects[0].cadStyleMode).toBe('layer');
  await page.getByRole('button', { name: 'Manage CAD layers', exact: true }).click();
  await page.getByLabel('Print / export Walls', { exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  expect((await state(page)).objects[0].visible).toBe(true);
  await page.locator('.toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Format', { exact: true }).selectOption('svg');
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click();
  const svg = await readFile((await (await download).path())!, 'utf8'); expect(svg).not.toContain('rgb(255,0,0)');
  await page.getByRole('button', { name: 'Manage CAD layers', exact: true }).click();
  await page.getByLabel('Delete Walls', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  expect((await state(page)).objects[0]).toMatchObject({ cadLayerId: '0', cadStyleMode: 'object', stroke: '#008800' });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await state(page)).layers.length).toBe(2);
  expect((await state(page)).objects[0].stroke).toBe('#ff0000');
  await page.reload();
  await expect(page.locator('canvas.upper-canvas')).toBeVisible();
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.locator('.layer-label').filter({ hasText: 'Reference rectangle' })).toBeVisible();
  expect((await state(page)).layers).toHaveLength(2); expect((await state(page)).objects[0].stroke).toBe('#ff0000');
});

test('layer locks and visibility protect canvas and object-list selection', async ({ page }) => {
  await open(page); await focusEditor(page);
  await page.getByRole('button', { name: 'Manage CAD layers', exact: true }).click();
  await page.getByLabel('Lock 0', { exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await focusEditor(page); await page.keyboard.press('Delete');
  expect((await state(page)).objects).toHaveLength(1);
  const locked = await save(page); expect(locked.objects.objects[0].locked).toBe(false); expect(locked.cadLayers[0].locked).toBe(true);
  await page.getByRole('button', { name: 'Manage CAD layers', exact: true }).click();
  await page.getByLabel('Lock 0', { exact: true }).uncheck(); await page.getByLabel('Visible 0', { exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  expect((await state(page)).objects[0].visible).toBe(false);
  await page.locator('.toolbar').getByRole('button', { name: 'Select All', exact: true }).click(); await page.keyboard.press('Delete');
  expect((await state(page)).objects).toHaveLength(1);
  await page.keyboard.press('ControlOrMeta+Z'); await expect.poll(async () => (await state(page)).objects[0].visible).toBe(true);
});

const dxf = [0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 0, 'ENDSEC', 0, 'SECTION', 2, 'TABLES', 0, 'LAYER', 2, 'Walls', 62, 1, 6, 'DASHED', 0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES', 0, 'LINE', 8, 'Walls', 10, -10, 20, 5, 11, 20, 21, 25,
  0, 'CIRCLE', 8, 'Walls', 10, 40, 20, 50, 40, 8, 0, 'TEXT', 1, '部屋A', 10, -10, 20, 50, 40, 12,
  0, 'INSERT', 2, 'BLOCK_A', 0, 'ENDSEC', 0, 'EOF', ''].join('\n');
test('previews DXF in a worker, requires units and imports as one undoable operation', async ({ page }) => {
  await open(page); const before = await state(page);
  await page.getByRole('button', { name: 'Import DXF', exact: true }).click();
  await page.getByLabel('DXF file', { exact: true }).setInputFiles({ name: 'reference.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  await page.getByRole('button', { name: 'Preview contents', exact: true }).click();
  await expect(page.getByText('Supported: 3 / Excluded: 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Unsupported entity: INSERT: 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to drawing', exact: true })).toBeDisabled();
  await page.getByLabel('Source drawing unit', { exact: true }).selectOption('cm');
  await page.getByRole('button', { name: 'Add to drawing', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await state(page); expect(after.objects).toHaveLength(4); expect(after.history).toBe(before.history + 1);
  expect(after.objects.some((o: { text?: string }) => o.text === '部屋A')).toBe(true);
  const saved = await save(page); expect(saved.cadLayers).toHaveLength(2);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await state(page)).objects.length).toBe(1); expect((await state(page)).layers).toHaveLength(1);
  await page.keyboard.press('ControlOrMeta+Shift+Z'); await expect.poll(async () => (await state(page)).objects.length).toBe(4);
});

test('decodes Japanese Shift_JIS TEXT with an explicit encoding choice', async ({ page }) => {
  await open(page);
  const parts = dxf.split('部屋A');
  const bytes = Buffer.concat([Buffer.from(parts[0]), Buffer.from([0x95, 0x94, 0x89, 0xae, 0x41]), Buffer.from(parts[1])]);
  await page.getByRole('button', { name: 'Import DXF', exact: true }).click();
  await page.getByLabel('DXF file', { exact: true }).setInputFiles({ name: 'shift-jis.dxf', mimeType: 'application/dxf', buffer: bytes });
  await page.getByRole('button', { name: 'Preview contents', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot import this file');
  await page.getByLabel('Text encoding').selectOption('shift_jis');
  await page.getByRole('button', { name: 'Preview contents', exact: true }).click();
  await expect(page.getByText('Supported: 3 / Excluded: 1', { exact: true })).toBeVisible();
  await page.getByLabel('Source drawing unit', { exact: true }).selectOption('mm');
  await page.getByRole('button', { name: 'Add to drawing', exact: true }).click();
  expect((await state(page)).objects.some((o: { text?: string }) => o.text === '部屋A')).toBe(true);
});
