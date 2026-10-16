import { expect, test } from '@playwright/test';
import { entrar } from './ayudas';

// Esta prueba cambia la reparación de ejemplo (la da por entregada): corre al final y cada corrida arranca con una base nueva.
test.describe('Reparaciones: recibir lo que vuelve del taller', () => {
  test.beforeEach(async ({ page }) => { await entrar(page); });

  test('se abre la reparación, no deja recibir más de lo pendiente y registra la entrega con su remito', async ({ page }) => {
    await page.goto('/mantenimiento');
    await page.getByRole('button', { name: 'Reparaciones', exact: true }).first().click();
    await expect(page.getByText('Reparación de ejemplo').first()).toBeVisible();
    await page.getByRole('row', { name: /Reparación de ejemplo/ }).getByRole('button', { name: 'Ver', exact: true }).click();

    // Abre el detalle y la línea todavía tiene pendiente 1 unidad.
    await page.getByRole('button', { name: 'Registrar entrega' }).click();
    const dialogo = page.getByRole('dialog').filter({ hasText: 'Registrar entrega' });
    await expect(dialogo).toBeVisible();

    // Más de lo pendiente: lo rechaza.
    await dialogo.getByLabel('Cantidad que vuelve ahora').fill('5');
    await dialogo.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText(/No podés registrar más de 1/)).toBeVisible();

    // La cantidad justa, con remito: se registra.
    await dialogo.getByLabel('Cantidad que vuelve ahora').fill('1');
    await dialogo.getByLabel('Punto de venta (remito)').fill('0001');
    await dialogo.getByLabel('Número de remito').fill('00000123');
    await dialogo.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Entrega registrada')).toBeVisible();
  });
});
