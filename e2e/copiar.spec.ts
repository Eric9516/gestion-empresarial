import { expect, test } from '@playwright/test';
import { entrar } from './ayudas';

// Al lado del código y de la descripción de cada repuesto hay un botón discreto para copiarlos. Copia sin abrir el repuesto.
test('el código y la descripción de un repuesto se copian con su botón, sin abrir el repuesto', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await entrar(page);
  await page.goto('/deposito');
  await page.getByRole('combobox').first().selectOption({ label: 'Familia de ejemplo (AA)' });
  const fila = page.getByRole('row', { name: /AA00001/ });
  await fila.hover();

  await fila.getByRole('button', { name: 'Copiar código' }).click();
  await expect(fila.getByRole('button', { name: 'código copiado' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/AA00001$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await fila.getByRole('button', { name: 'Copiar descripción' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Rodamiento de ejemplo');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
