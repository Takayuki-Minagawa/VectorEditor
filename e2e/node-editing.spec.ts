import { expect, test, type Page } from '@playwright/test';

async function openEditorInJapanese(page: Page): Promise<void> {
  await page.goto('./');
  await page.locator('.header-right button.lang-btn').filter({ hasText: '日本語' }).click();
  await expect(page.locator('canvas.upper-canvas')).toBeVisible();
}

type FractionPoint = readonly [x: number, y: number];

async function canvasPoint(page: Page, point: FractionPoint): Promise<{ x: number; y: number }> {
  const canvas = page.locator('canvas.upper-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The drawing canvas has no bounding box.');
  return { x: box.x + box.width * point[0], y: box.y + box.height * point[1] };
}

async function dragOnCanvas(page: Page, start: FractionPoint, end: FractionPoint): Promise<void> {
  const from = await canvasPoint(page, start);
  const to = await canvasPoint(page, end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

function toast(page: Page, text: string) {
  return page.locator('.toast').filter({ hasText: text });
}

test('inserts and deletes nodes with the node-edit tool', async ({ page }) => {
  await openEditorInJapanese(page);

  await page.getByRole('button', { name: '直線', exact: true }).click();
  await dragOnCanvas(page, [0.2, 0.5], [0.6, 0.5]);

  await page.getByRole('button', { name: 'ノード編集', exact: true }).click();
  const middle = await canvasPoint(page, [0.4, 0.5]);
  await page.mouse.click(middle.x, middle.y);

  // Double-click the segment middle: the line becomes a polyline with a node.
  await page.mouse.dblclick(middle.x, middle.y);
  await expect(toast(page, 'ノードを追加しました。')).toBeVisible();

  // Drag the new node upwards.
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y - 80, { steps: 4 });
  await page.mouse.up();

  // Double-click the moved node to delete it again.
  await page.mouse.dblclick(middle.x, middle.y - 80);
  await expect(toast(page, 'ノードを削除しました。')).toBeVisible();

  // Deleting an endpoint of the remaining two-point polyline must be refused.
  const start = await canvasPoint(page, [0.2, 0.5]);
  await page.mouse.dblclick(start.x, start.y);
  await expect(toast(page, 'これ以上ノードを削除できません。')).toBeVisible();
});

test('applies Boolean union from the context menu', async ({ page }) => {
  await openEditorInJapanese(page);

  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await dragOnCanvas(page, [0.25, 0.3], [0.45, 0.55]);
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await dragOnCanvas(page, [0.35, 0.4], [0.6, 0.65]);

  await expect(page.locator('.layer-list .layer-item')).toHaveCount(2);

  // Rubber-band select both rectangles with the select tool, starting from an
  // empty corner well away from the drawn shapes.
  await page.getByRole('button', { name: '選択', exact: true }).click();
  await dragOnCanvas(page, [0.05, 0.05], [0.75, 0.8]);
  await expect(page.locator('.layer-list .layer-item.selected')).toHaveCount(2);

  // Right-click inside the overlap of the two rectangles.
  const target = await canvasPoint(page, [0.3, 0.35]);
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await page.locator('.context-menu').getByRole('button', { name: '合体', exact: true }).click();

  await expect(toast(page, 'ブーリアン演算を適用しました。')).toBeVisible();
  await expect(page.locator('.layer-list .layer-item')).toHaveCount(1);

  // The whole operation is one history step.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.layer-list .layer-item')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.layer-list .layer-item')).toHaveCount(1);
});
