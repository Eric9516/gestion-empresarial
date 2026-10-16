import { expect, test } from '@playwright/test';
import { entrar } from './ayudas';

test.describe('Directorio: proveedores y comisionistas', () => {
  test.beforeEach(async ({ page }) => { await entrar(page); });

  test('la lista de proveedores busca y filtra', async ({ page }) => {
    const fila = page.getByRole('row', { name: /Proveedor de ejemplo/ });
    await expect(fila).toBeVisible();
    await expect(fila).toContainText('Repuestos');

    // Un texto que no existe: queda vacía y lo dice.
    const buscador = page.getByPlaceholder('Buscar proveedor...');
    await buscador.fill('zzzz-no-existe');
    await expect(page.getByText('Sin resultados')).toBeVisible();
    await expect(fila).toHaveCount(0);

    // Parte del nombre: vuelve a aparecer.
    await buscador.fill('ejemplo');
    await expect(fila).toBeVisible();

    // Filtro de estado: el de ejemplo está activo, así que en "Inactivos" no está.
    await buscador.fill('');
    await page.getByRole('combobox').nth(1).selectOption('inactivo');
    await expect(fila).toHaveCount(0);
    await page.getByRole('combobox').nth(1).selectOption('activo');
    await expect(fila).toBeVisible();
  });

  test('un proveedor: se le agrega un contacto, se le cambia otro y se quita, sin duplicar ni perder los demás', async ({ page }) => {
    const abrirEdicion = async () => {
      await page.getByRole('row', { name: /Proveedor de ejemplo/ }).getByTitle('Editar').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    };
    const nombres = page.getByRole('dialog').getByPlaceholder('Juan Pérez');
    const guardar = async () => {
      await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
    };
    const fila = page.getByRole('row', { name: /Proveedor de ejemplo/ });

    // 1) agregar un contacto nuevo y cambiarle el cargo al que ya había
    await abrirEdicion();
    await expect(nombres).toHaveCount(1);
    await page.getByRole('button', { name: '+ Agregar contacto' }).click();
    await nombres.nth(1).fill('Contacto nuevo');
    await page.getByRole('dialog').getByPlaceholder('Ventas').first().fill('Compras');
    await guardar();
    await expect(fila).toContainText('Contacto nuevo');
    await expect(fila).toContainText('Contacto de ejemplo · Compras');

    // 2) quitar el nuevo: queda solo el original, con su cargo
    await abrirEdicion();
    await expect(nombres).toHaveCount(2);
    // Se quita el que tiene ese nombre (el orden de los contactos no importa).
    const posicion = await nombres.evaluateAll(campos => campos.findIndex(c => (c as HTMLInputElement).value === 'Contacto nuevo'));
    expect(posicion).toBeGreaterThanOrEqual(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Quitar contacto' }).nth(posicion).click();
    await expect(nombres).toHaveCount(1);
    await guardar();
    await expect(fila).not.toContainText('Contacto nuevo');
    await expect(fila).toContainText('Contacto de ejemplo · Compras');

    // 3) dejar el dato como estaba
    await abrirEdicion();
    await page.getByRole('dialog').getByPlaceholder('Ventas').first().fill('');
    await guardar();
    await expect(fila).toContainText('Contacto de ejemplo');
    await expect(fila).not.toContainText('Compras');
  });

  test('comisionistas: aparece la lista y se puede abrir el detalle', async ({ page }) => {
    await page.getByRole('button', { name: 'Comisionistas' }).first().click();
    await expect(page.getByRole('row', { name: /Comisionista de ejemplo/ })).toBeVisible();
    await page.getByRole('row', { name: /Comisionista de ejemplo/ }).getByTitle('Ver').click();
    await expect(page.getByRole('dialog')).toContainText('Comisionista de ejemplo');
  });

  test('@celular en el celular los proveedores se ven como tarjetas, no como tabla', async ({ page }) => {
    await expect(page.getByRole('table')).toBeHidden();
    await expect(page.locator('.prov-card').filter({ hasText: 'Proveedor de ejemplo' })).toBeVisible();
  });
});
