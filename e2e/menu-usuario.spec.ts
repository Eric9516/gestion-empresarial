import { expect, test } from '@playwright/test';
import { entrar, DUENO } from './ayudas';

// El menú del nombre (arriba a la derecha): quién tiene la sesión abierta, perfil, sugerencia y cerrar sesión.
// Configuración y las áreas viven en el menú lateral, no acá.
test.describe('Menú del nombre', () => {
  test('muestra nombre, correo y rol, y solo lo propio de la cuenta', async ({ page }) => {
    await entrar(page);
    await page.goto('/deposito');
    await page.locator('.user-badge button').first().click();
    const menu = page.locator('.user-dropdown.open');
    await expect(menu).toContainText(DUENO.email);
    await expect(menu).toContainText('Dueño');
    await expect(menu.getByRole('menuitem', { name: /Mi perfil/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Cerrar sesión/ })).toBeVisible();
    // lo que ya está en el menú lateral no se repite
    await expect(menu.getByRole('menuitem', { name: /Configuración/ })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: /Inicio/ })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: /Configuración/ })).toHaveCount(1);
  });

  test('el menú lateral lleva de un área a otra', async ({ page }) => {
    await entrar(page);
    await page.goto('/deposito');
    const lateral = page.getByRole('navigation', { name: 'Secciones' });
    await lateral.getByRole('button', { name: 'Directorio', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Proveedor de ejemplo')).toBeVisible();
    await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Depósito principal' }).click();
    await expect(page).toHaveURL(/\/deposito/);
    // ya no hay botón de "volver" arriba
    await expect(page.locator('.app-header .btn-volver-directorio, .app-header .btn-deposito')).toHaveCount(0);
  });
});
