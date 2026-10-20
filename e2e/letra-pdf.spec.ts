import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

// En el Informe, lo que no se usa todo el tiempo (exportar el PDF y el tamaño de su letra) va en el botón "⋯" para no cargar la pantalla.
// La letra es de cada persona: queda en su perfil y sigue igual al recargar. La prueba la deja en "Chica" al terminar (se comparte una sola base).
async function abrirMenu(page: Page) {
  await page.getByRole('button', { name: 'Más acciones' }).click();
  return page.getByRole('menu');
}

test('el Informe guarda en "⋯" el PDF y la letra elegida queda en el perfil', async ({ page }) => {
  await entrar(page);
  await page.goto('/deposito');
  await page.getByRole('button', { name: /Informe/ }).first().click();
  await expect(page.getByRole('button', { name: /Exportar informe PDF/ })).toHaveCount(0);

  let menu = await abrirMenu(page);
  await expect(menu.getByRole('menuitem', { name: /Exportar informe PDF/ })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Chica' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: 'Grande' }).click();
  await expect(menu).toBeHidden();

  try {
    await page.reload();
    await page.getByRole('button', { name: /Informe/ }).first().click();
    menu = await abrirMenu(page);
    await expect(menu.getByRole('menuitemradio', { name: 'Grande' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  } finally {
    if (!(await page.getByRole('menu').isVisible())) menu = await abrirMenu(page);
    await menu.getByRole('menuitemradio', { name: 'Chica' }).click();
  }
});
