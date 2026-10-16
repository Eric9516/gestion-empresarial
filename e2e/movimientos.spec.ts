import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

async function abrirMovimientos(page: Page) {
  await page.goto('/mantenimiento');
  await page.getByRole('button', { name: /Movimientos/ }).first().click();
  await expect(page.getByText('Movimientos de stock').first()).toBeVisible();
}

async function agregarElRepuesto(page: Page) {
  await page.getByLabel('Buscar artículo').fill('AA00001');
  await page.getByRole('button', { name: /Agregar/ }).first().click();
}

test.describe('Movimientos de stock: cargas y ajustes con comprobante', () => {
  test.beforeEach(async ({ page }) => { await entrar(page); });

  test('una carga suma stock y queda con su número; un ajuste lo deja como estaba', async ({ page }) => {
    await abrirMovimientos(page);

    // Carga de stock: solo suma, no pide motivo
    await page.getByRole('button', { name: '+ Cargar stock' }).click();
    await expect(page.getByRole('button', { name: 'Guardar la carga' })).toBeDisabled();
    await agregarElRepuesto(page);
    await expect(page.getByRole('button', { name: /Suma/ })).toHaveCount(0); // en una carga no hay suma/resta por línea
    await page.getByLabel(/Cantidad \(/).fill('7');
    await expect(page.getByText(/quedará/)).toBeVisible();
    await page.getByLabel('Referencia (opcional)').fill('Remito de prueba');
    await page.getByRole('button', { name: /Guardar la carga/ }).click();
    await page.getByRole('button', { name: 'Sí, cargar' }).click();
    await expect(page.getByText(/Carga de stock registrada: CAR 0001-\d{8}/)).toBeVisible();

    // aparece en la lista con su comprobante y la referencia se puede buscar
    await page.getByPlaceholder(/Número, artículo/).fill('Remito de prueba');
    await expect(page.getByText(/CAR 0001-\d{8}/).first()).toBeVisible();

    // Ajuste: resta lo cargado (pide motivo)
    await page.getByRole('button', { name: '+ Ajuste' }).click();
    await agregarElRepuesto(page);
    await page.getByLabel(/Cantidad \(/).fill('7');
    await expect(page.getByRole('button', { name: /Guardar el ajuste/ })).toBeDisabled(); // falta el motivo
    await page.getByLabel(/^Motivo/).selectOption({ label: 'Conteo físico' });
    await page.getByRole('button', { name: /Guardar el ajuste/ }).click();
    await page.getByRole('button', { name: 'Sí, ajustar' }).click();
    await expect(page.getByText(/Ajuste de inventario registrada: AJU 0001-\d{8}/)).toBeVisible();
  });

  test('un ajuste no puede dejar el stock en negativo', async ({ page }) => {
    await abrirMovimientos(page);
    await page.getByRole('button', { name: '+ Ajuste' }).click();
    await agregarElRepuesto(page);
    await page.getByLabel(/Cantidad \(/).fill('999999');
    await expect(page.getByText(/no puede quedar en negativo/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Guardar el ajuste/ })).toBeDisabled();
  });

  test('en la ficha del repuesto el stock no se escribe: se cambia con "Cambiar stock…"', async ({ page }) => {
    await page.goto('/mantenimiento');
    await page.getByRole('combobox').first().selectOption({ label: 'Familia de ejemplo (AA)' });
    await page.getByText('Rodamiento de ejemplo').first().click();
    await page.getByRole('button', { name: /Editar/ }).first().click();
    await expect(page.getByRole('button', { name: /Cambiar stock/ })).toBeVisible();
    await expect(page.locator('input#item-form-7')).toHaveCount(0);
    await page.getByRole('button', { name: /Cambiar stock/ }).click();
    await expect(page.getByText('Nuevo movimiento de stock')).toBeVisible();
    await expect(page.getByText(/Rodamiento de ejemplo/).first()).toBeVisible();
  });
});
