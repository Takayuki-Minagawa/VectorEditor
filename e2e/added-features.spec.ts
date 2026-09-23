import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('canvas.upper-canvas')).toBeVisible();
}

async function canvasPoint(page: Page, x: number, y: number) {
  const box = await page.locator('canvas.upper-canvas').boundingBox();
  if (!box) throw new Error('Canvas is missing');
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

async function drawingState(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/VectorEditor/src/store/useEditorStore.ts');
    const state = useEditorStore.getState();
    return { pages: state.pages, activePageId: state.activePageId, objects: state.canvas!.getObjects().map((object) => object.toObject(['bezierNodeModes'])), history: state.history.length };
  });
}

test('crops a raster image, undoes, redoes and saves the visible pixels', async ({ page }) => {
  await page.setContent('<div id="fixture" style="width:100px;height:80px;background:linear-gradient(90deg,red,blue)"></div>');
  const png = await page.locator('#fixture').screenshot();
  await open(page);
  await page.locator('input[type=file][accept*=".png"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await expect.poll(async () => (await drawingState(page)).objects.length).toBe(1);
  await page.getByRole('button', { name: '選択', exact: true }).click();
  const image = (await drawingState(page)).objects[0] as { left: number; top: number; width: number; height: number };
  const canvas = page.locator('canvas.upper-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is missing');
  await page.mouse.click(box.x + image.left + image.width / 2, box.y + image.top + image.height / 2);
  await page.getByRole('button', { name: '画像を切り抜き' }).click();
  const handle = page.locator('.image-crop-handle.se');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Crop handle is missing');
  await page.mouse.move(handleBox.x + 8, handleBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 20, handleBox.y - 10, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('dialog').getByRole('button', { name: '切り抜きを確定' }).click();
  await expect.poll(async () => ((await drawingState(page)).objects[0] as { width: number }).width).toBeLessThan(100);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => ((await drawingState(page)).objects[0] as { width: number }).width).toBe(100);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => ((await drawingState(page)).objects[0] as { width: number }).width).toBeLessThan(100);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.toolbar').getByRole('button', { name: '保存', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
  expect(saved.objects.objects[0].width).toBeLessThan(100);
});

test('draws a Bézier path with drag handles and one Undo step', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'ベジェペン', exact: true }).click();
  const a = await canvasPoint(page, .2, .3);
  const b = await canvasPoint(page, .4, .5);
  const c = await canvasPoint(page, .6, .3);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x + 35, b.y - 20, { steps: 5 }); await page.mouse.up();
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await drawingState(page)).objects.length).toBe(1);
  const path = (await drawingState(page)).objects[0] as { type: string; bezierNodeModes: Record<string, string> };
  expect(path.type).toBe('Path');
  expect(path.bezierNodeModes['1']).toBe('smooth');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await drawingState(page)).objects.length).toBe(0);
});

test('keeps page contents separate and downloads a two-page PDF', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  const a = await canvasPoint(page, .2, .2), b = await canvasPoint(page, .4, .4);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up();
  await page.locator('.page-panel').getByRole('button', { name: '追加', exact: true }).click();
  await expect.poll(async () => (await drawingState(page)).pages.length).toBe(2);
  expect((await drawingState(page)).objects).toHaveLength(0);
  await page.getByRole('button', { name: '円', exact: true }).click();
  const c = await canvasPoint(page, .5, .5), d = await canvasPoint(page, .6, .6);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(d.x, d.y); await page.mouse.up();
  await page.locator('.page-panel .page-item').first().click();
  await expect.poll(async () => (await drawingState(page)).objects[0]?.type).toBe('Rect');
  await page.locator('.page-panel .page-item').last().click();
  await expect.poll(async () => (await drawingState(page)).objects[0]?.type).toBe('Circle');
  await page.locator('.toolbar').getByRole('button', { name: '出力', exact: true }).click();
  await page.getByLabel('形式').selectOption('pdf');
  await page.getByLabel('全ページをPDFに出力').check();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: '出力', exact: true }).click();
  const pdf = (await readFile((await (await downloadPromise).path())!)).toString('latin1');
  expect((pdf.match(/\/Type\s*\/Page\b/g) ?? [])).toHaveLength(2);
});

test('imports and exports R12 ARC and polyline bulges without flattening', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'CAD', exact: true }).click();
  const dxf = [0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES',
    0, 'ARC', 10, 50, 20, 50, 40, 20, 50, 300, 51, 60,
    0, 'POLYLINE', 70, 0, 0, 'VERTEX', 10, 0, 20, 0, 42, -1,
    0, 'VERTEX', 10, 20, 20, 0, 0, 'SEQEND',
    0, 'ENDSEC', 0, 'EOF', ''].join('\n');
  await page.getByRole('button', { name: 'DXF読込', exact: true }).click();
  await page.getByLabel('DXFファイル').setInputFiles({ name: 'curves.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  await page.getByRole('button', { name: '内容を確認' }).click();
  await expect(page.getByText('追加できる要素: 2件 / 除外する要素: 0件')).toBeVisible();
  await page.getByLabel('元図面の1単位').selectOption('mm');
  await page.getByRole('button', { name: '図面へ追加' }).click();
  await expect.poll(async () => (await drawingState(page)).objects.length).toBe(2);
  await page.locator('.toolbar').getByRole('button', { name: '出力', exact: true }).click();
  await page.getByLabel('形式').selectOption('dxf');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: '出力', exact: true }).click();
  const result = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(result).toMatch(/0\r\nARC\r\n/);
  expect(result).toMatch(/42\r\n-1\r\n/);
});
