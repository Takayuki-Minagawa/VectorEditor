import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

type Point = { x: number; y: number };

test.use({ viewport: { width: 1440, height: 1000 } });

async function open(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Language: English', exact: true })
    .or(page.getByRole('button', { name: '言語: English', exact: true })).click();
  await expect(page.locator('canvas.upper-canvas')).toBeVisible();
}

// The store is read only: drawing, zoom, pan, history and file loading use the UI.
async function geometry(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/VectorEditor/src/store/useEditorStore.ts';
    const { useEditorStore } = await import(modulePath) as typeof import('../src/store/useEditorStore');
    return useEditorStore.getState().canvas!.getObjects().map((object) => ({
      bounds: object.getBoundingRect(),
      center: { x: object.getCenterPoint().x, y: object.getCenterPoint().y },
      strokeWidth: object.strokeWidth,
      angle: object.angle,
      originX: object.originX,
      originY: object.originY,
    }));
  });
}

async function viewport(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/VectorEditor/src/store/useEditorStore.ts';
    const { useEditorStore } = await import(modulePath) as typeof import('../src/store/useEditorStore');
    return [...useEditorStore.getState().canvas!.viewportTransform];
  });
}

async function screenPoint(page: Page, point: Point) {
  return page.evaluate(async ({ x, y }) => {
    const modulePath = '/VectorEditor/src/store/useEditorStore.ts';
    const { useEditorStore } = await import(modulePath) as typeof import('../src/store/useEditorStore');
    const canvas = useEditorStore.getState().canvas!;
    const v = canvas.viewportTransform;
    const box = canvas.upperCanvasEl.getBoundingClientRect();
    return { x: box.x + v[0] * x + v[2] * y + v[4], y: box.y + v[1] * x + v[3] * y + v[5] };
  }, point);
}

async function beginDrag(page: Page, tool: string, start: Point, end: Point) {
  await page.locator('.tool-panel').getByRole('button', { name: tool, exact: true }).click();
  const from = await screenPoint(page, start);
  const to = await screenPoint(page, end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
}

async function draw(page: Page, tool: string, start: Point, end: Point) {
  const count = (await geometry(page)).length;
  await beginDrag(page, tool, start, end);
  await page.mouse.up();
  await expect.poll(async () => (await geometry(page)).length).toBe(count + 1);
  return (await geometry(page)).at(-1)!;
}

function expectDragBounds(object: Awaited<ReturnType<typeof draw>>, start: Point, end: Point) {
  // Mouse events round fractional CSS positions; allow one scene unit at these zooms.
  expect(Math.abs(object.bounds.left - Math.min(start.x, end.x))).toBeLessThan(1);
  expect(Math.abs(object.bounds.top - Math.min(start.y, end.y))).toBeLessThan(1);
  // Fabric's bounding rectangle includes the stroke outside the nominal size.
  expect(Math.abs(object.bounds.width - Math.abs(end.x - start.x) - object.strokeWidth)).toBeLessThan(1);
  expect(Math.abs(object.bounds.height - Math.abs(end.y - start.y) - object.strokeWidth)).toBeLessThan(1);
}

async function saveJson(page: Page) {
  const promise = page.waitForEvent('download');
  await page.locator('.toolbar').getByRole('button', { name: 'Save', exact: true }).click();
  const download = await promise;
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

async function loadJson(page: Page, document: unknown) {
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: 'placement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
}

test('rectangles follow the mouse in all four drag directions', async ({ page }) => {
  await open(page);
  const directions = [
    [{ x: 100, y: 100 }, { x: 220, y: 180 }],
    [{ x: 420, y: 100 }, { x: 300, y: 180 }],
    [{ x: 100, y: 330 }, { x: 220, y: 250 }],
    [{ x: 420, y: 330 }, { x: 300, y: 250 }],
  ];
  for (const [start, end] of directions) {
    expectDragBounds(await draw(page, 'Rect', start, end), start, end);
  }
  await page.screenshot({ path: 'test-results/drawing-placement.png', fullPage: true });
});

test('the other bounded shapes keep their reverse-drag placement', async ({ page }) => {
  await open(page);
  for (const [index, tool] of ['Rounded', 'Circle', 'Ellipse', 'Triangle', 'Diamond', 'Wall'].entries()) {
    const end = { x: 80 + (index % 3) * 180, y: 100 + Math.floor(index / 3) * 170 };
    const start = { x: end.x + 100, y: end.y + 100 };
    expectDragBounds(await draw(page, tool, start, end), start, end);
  }
});

test('new rectangle placement survives Undo, Redo and JSON Save/Load', async ({ page }) => {
  await open(page);
  const original = await draw(page, 'Rect', { x: 350, y: 260 }, { x: 150, y: 140 });
  const saved = await saveJson(page);
  const toolbar = page.locator('.toolbar');
  await toolbar.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await geometry(page)).length).toBe(0);
  await toolbar.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => geometry(page)).toEqual([original]);
  await toolbar.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await geometry(page)).length).toBe(0);
  await loadJson(page, saved);
  await expect.poll(() => geometry(page)).toEqual([original]);
});

test('CAD drawing uses document coordinates after mouse-wheel zoom and pan', async ({ page }) => {
  await open(page);
  await loadJson(page, {
    version: 2, documentId: 'cad-placement', drawingMode: 'cad', cadUnit: 'mm', cadWidth: 800, cadHeight: 600,
    canvas: { width: 800, height: 600, backgroundColor: '#ffffff' }, objects: { objects: [] },
  });
  await expect.poll(async () => (await viewport(page))[0]).not.toBe(1);
  const beforeZoom = await viewport(page);
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await viewport(page))[0]).toBeGreaterThan(beforeZoom[0]);
  const beforePan = await viewport(page);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(center.x + 30, center.y + 15, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => (await viewport(page))[4]).toBeCloseTo(beforePan[4] + 30, 1);
  await expect.poll(async () => (await viewport(page))[5]).toBeCloseTo(beforePan[5] + 15, 1);
  const start = { x: 400, y: 300 };
  const end = { x: 240, y: 180 };
  expectDragBounds(await draw(page, 'Rect', start, end), start, end);
});

test('text starts at the clicked corner and columns stay centered on the click', async ({ page }) => {
  await open(page);
  for (const [tool, point] of [['Text', { x: 150, y: 140 }], ['Column', { x: 400, y: 280 }]] as const) {
    await page.locator('.tool-panel').getByRole('button', { name: tool, exact: true }).click();
    const screen = await screenPoint(page, point);
    await page.mouse.click(screen.x, screen.y);
  }
  await expect.poll(async () => (await geometry(page)).length).toBe(2);
  const [text, column] = await geometry(page);
  expect(Math.abs(text.bounds.left - 150)).toBeLessThan(1);
  expect(Math.abs(text.bounds.top - 140)).toBeLessThan(1);
  expect(Math.abs(column.center.x - 400)).toBeLessThan(1);
  expect(Math.abs(column.center.y - 280)).toBeLessThan(1);
});

test('numeric rotation keeps new rectangles and text centered, and Undo restores placement', async ({ page }) => {
  await open(page);
  for (const tool of ['Rect', 'Text']) {
    if (tool === 'Rect') {
      await draw(page, tool, { x: 120, y: 100 }, { x: 280, y: 180 });
    } else {
      await page.locator('.tool-panel').getByRole('button', { name: tool, exact: true }).click();
      const point = await screenPoint(page, { x: 350, y: 260 });
      await page.mouse.click(point.x, point.y);
    }
    const before = await geometry(page);
    const original = before.at(-1)!;
    const rotation = page.getByLabel('Rotation', { exact: true });
    await rotation.fill('90');
    await rotation.press('Tab');
    await expect.poll(async () => (await geometry(page)).at(-1)!.angle).toBe(90);
    const rotated = (await geometry(page)).at(-1)!;
    expect(rotated.center.x).toBeCloseTo(original.center.x, 6);
    expect(rotated.center.y).toBeCloseTo(original.center.y, 6);
    await page.locator('.toolbar').getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => geometry(page)).toEqual(before);
  }
});

test('measure and stretch previews paint the dragged region and disappear on cancellation', async ({ page }) => {
  await open(page);
  const pixel = async (point: Point) => page.locator('canvas.lower-canvas').evaluate((element, { x, y }) => {
    const canvas = element as HTMLCanvasElement;
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    return [...canvas.getContext('2d')!.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data];
  }, point);
  const inside = { x: 260, y: 190 };
  const outside = { x: 90, y: 105 };
  for (const tool of ['LaTeX Measure', 'Stretch']) {
    const insideBefore = await pixel(inside);
    const outsideBefore = await pixel(outside);
    await beginDrag(page, tool, { x: 280, y: 210 }, { x: 120, y: 130 });
    await expect.poll(() => pixel(inside)).not.toEqual(insideBefore);
    expect(await pixel(outside)).toEqual(outsideBefore);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(() => pixel(inside)).toEqual(insideBefore);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await geometry(page)).toHaveLength(0);
  }
});
