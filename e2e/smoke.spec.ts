import { expect, test } from '@playwright/test';

test('loads the editor and switches drawing modes', async ({ page }) => {
  await page.goto('./');

  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('.lower-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'CAD' }).click();
  await expect(page.locator('.canvas-wrapper')).toHaveClass(/cad-mode/);
  await page.getByRole('button', { name: '挿絵' }).click();
  await expect(page.locator('.canvas-wrapper')).not.toHaveClass(/cad-mode/);
});
