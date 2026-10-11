import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import katex from 'katex';

async function canvasObjects(page: Page) {
  return page.evaluate(async () => {
    const path = '/VectorEditor/src/store/useEditorStore.ts';
    const { useEditorStore } = await import(path);
    return useEditorStore.getState().canvas.getObjects().map(
      (object: { toObject: () => unknown }) => object.toObject(),
    );
  });
}

test('renders and places LaTeX, preserving the formula and font size when saved', async ({ page }) => {
  await page.goto('./');
  await page.locator('.header-right button.lang-btn').filter({ hasText: '日本語' }).click();
  await page.getByRole('button', { name: 'LaTeX数式', exact: true }).click();
  await page.locator('canvas.upper-canvas').click({ position: { x: 160, y: 140 } });

  const dialog = page.getByRole('dialog', { name: 'LaTeX数式入力' });
  const formula = String.raw`\frac{a^2 + b^2}{\sqrt{c}}`;
  await dialog.getByLabel('数式', { exact: true }).fill(formula);
  await dialog.getByLabel('サイズ', { exact: true }).fill('32');
  await expect(dialog.locator('.latex-render .katex')).toBeVisible();
  await expect(dialog.locator('.latex-render .katex-error')).toHaveCount(0);
  await expect(dialog.locator('.latex-render annotation')).toHaveText(formula);
  await dialog.getByRole('button', { name: '配置', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(1);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.toolbar').getByRole('button', { name: '保存', exact: true }).click();
  const savedPath = await (await downloadPromise).path();
  if (!savedPath) throw new Error('The saved drawing has no local path.');
  const saved = JSON.parse(await readFile(savedPath, 'utf8'));
  expect(saved.objects.objects).toHaveLength(1);
  const image = saved.objects.objects[0];
  expect(image).toMatchObject({
    type: 'Image',
    latexSource: formula,
    latexFontSize: 32,
  });
  expect(image.src).toMatch(/^data:image\/png;base64,/);
  expect(image.width).toBeGreaterThan(0);
  expect(image.height).toBeGreaterThan(0);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await canvasObjects(page)).length).toBe(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await canvasObjects(page))[0]).toMatchObject({
    latexSource: formula,
    latexFontSize: 32,
    src: image.src,
  });
});

test('ignores inherited KaTeX trust options when rendering links', () => {
  const formula = String.raw`\href{https://example.com/}{link}`;
  // Exercise inherited settings without changing Object.prototype globally.
  const inheritedOptions = Object.assign(Object.create({ trust: true }), {
    throwOnError: false,
    displayMode: true,
  });
  expect(katex.renderToString(formula, inheritedOptions)).not.toContain('<a ');
  expect(katex.renderToString(formula, { trust: true })).toContain('<a ');
});
