import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

// Revisa cada pantalla con axe (el verificador de accesibilidad que usan Google y Microsoft): contraste de colores, botones sin nombre, campos sin etiqueta,
// jerarquía de títulos, etc. Falla si aparece cualquier problema serio, así la accesibilidad no se pierde con el tiempo.
async function problemas(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  return r.violations.map(v => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.length} lugar(es), p. ej. ${v.nodes[0]?.target.join(' ')}`);
}

test.describe('Accesibilidad', () => {
  test('el login no tiene problemas', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
    expect(await problemas(page)).toEqual([]);
  });

  test.describe('con sesión iniciada', () => {
    test.beforeEach(async ({ page }) => { await entrar(page); });

    test('Directorio: proveedores', async ({ page }) => {
      await expect(page.getByText('Proveedor de ejemplo').first()).toBeVisible();
      expect(await problemas(page)).toEqual([]);
    });

    test('Directorio: formulario de proveedor', async ({ page }) => {
      await page.getByRole('row', { name: /Proveedor de ejemplo/ }).getByTitle('Editar').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await problemas(page)).toEqual([]);
    });

    test('Depósito: búsqueda de repuestos', async ({ page }) => {
      await page.goto('/mantenimiento');
      await page.getByRole('combobox').first().selectOption({ label: 'Familia de ejemplo (AA)' });
      await expect(page.getByText('Rodamiento de ejemplo').first()).toBeVisible();
      expect(await problemas(page)).toEqual([]);
    });

    // Cada pestaña de cada sección, una por una.
    for (const [ruta, pestanas] of [
      ['/', ['Comisionistas', 'Envíos', 'Tareas']],
      ['/mantenimiento', ['A retirar', 'Retiros', 'Tareas', 'Reparaciones', 'Informe', 'Movimientos']],
    ] as const) {
      for (const pestana of pestanas) {
        test(`${ruta === '/' ? 'Directorio' : 'Depósito'}: pestaña ${pestana}`, async ({ page }) => {
          await page.goto(ruta);
          await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: pestana, exact: true }).click();
          await page.waitForLoadState('networkidle');
          expect(await problemas(page)).toEqual([]);
        });
      }
    }

    test('@celular el menú del celular, abierto', async ({ page }) => {
      await page.getByRole('button', { name: 'Menú', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Menú' })).toBeVisible();
      expect(await problemas(page)).toEqual([]);
    });

    test('@celular la lista de proveedores en tarjetas', async ({ page }) => {
      await expect(page.locator('.prov-card').first()).toBeVisible();
      expect(await problemas(page)).toEqual([]);
    });

    test('Configuración', async ({ page }) => {
      await page.goto('/admin');
      await expect(page.getByRole('heading', { level: 1, name: 'Configuración' })).toBeVisible();
      expect(await problemas(page)).toEqual([]);
    });
  });
});
