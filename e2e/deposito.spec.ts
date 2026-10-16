import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

// El stock inicial del repuesto de ejemplo no es un número fijo (el retiro de ejemplo ya descontó unidades): cada prueba lo lee al empezar,
// compara contra eso y deja todo como estaba.
async function buscarElRepuesto(page: Page) {
  await page.goto('/mantenimiento');
  await page.getByRole('combobox').first().selectOption({ label: 'Familia de ejemplo (AA)' });
  await expect(page.getByText('Rodamiento de ejemplo').first()).toBeVisible();
}

async function stockMostrado(page: Page) {
  const mostrar = page.getByRole('button', { name: 'Stock', exact: true });
  if (await mostrar.count()) await mostrar.click();
  const columna = await page.locator('thead th').evaluateAll(ths => ths.findIndex(t => t.textContent?.trim() === 'Stock'));
  expect(columna).toBeGreaterThanOrEqual(0);
  const celda = page.getByRole('row', { name: /Rodamiento de ejemplo/ }).getByRole('cell').nth(columna);
  const texto = (await celda.textContent()) ?? '';
  return Number(texto.replace(/\D/g, ''));
}

test.describe('Depósito: buscar y retirar un repuesto', () => {
  test.beforeEach(async ({ page }) => { await entrar(page); });

  test('buscar por código encuentra el repuesto y por un texto raro no encuentra nada', async ({ page }) => {
    await page.goto('/mantenimiento');
    const buscador = page.getByPlaceholder('Código, número o descripción...');
    await buscador.fill('AA00001');
    await expect(page.getByText('Rodamiento de ejemplo').first()).toBeVisible();
    await buscador.fill('rodamiento ejemplo');
    await expect(page.getByText('Rodamiento de ejemplo').first()).toBeVisible();
    await buscador.fill('zzzzzz-nada');
    await expect(page.getByText('Rodamiento de ejemplo')).toHaveCount(0);
  });

  test('no se puede retirar más de lo que hay: se avisa con el stock real y no se registra nada', async ({ page }) => {
    await buscarElRepuesto(page);
    const antes = await stockMostrado(page);
    await page.getByRole('button', { name: 'Retirar', exact: true }).first().click();
    await page.getByRole('button', { name: /A retirar/ }).first().click();
    await page.getByRole('spinbutton').first().fill(String(antes + 50));
    await expect(page.getByText(/no se puede retirar más/)).toBeVisible();
    await page.getByLabel('Sector *').selectOption({ label: 'Planta de ejemplo' });
    await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
    await expect(page.getByText(`No hay stock suficiente: `).filter({ hasText: `(hay ${antes}, pedís ${antes + 50})` })).toBeVisible();
    // no se abrió el resumen para confirmar y el stock no cambió
    await expect(page.getByRole('button', { name: /Sí, confirmar retiro/ })).toHaveCount(0);
    await buscarElRepuesto(page);
    expect(await stockMostrado(page)).toBe(antes);
    // se deja el carrito vacío para no afectar otras pruebas
    await page.getByRole('button', { name: /A retirar/ }).first().click();
    await page.getByRole('button', { name: 'Quitar' }).first().click();
  });

  test('retirar: pasa a "A retirar", se confirma con el sector y el stock baja; devolverlo lo deja como estaba', async ({ page }) => {
    await buscarElRepuesto(page);
    const antes = await stockMostrado(page);
    expect(antes).toBeGreaterThan(2);

    // 1) agregarlo a "A retirar"
    await page.getByRole('button', { name: 'Retirar', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /A retirar\s*\(?1\)?/ }).first()).toBeVisible();
    await page.getByRole('button', { name: /A retirar/ }).first().click();
    await expect(page.getByText('Rodamiento de ejemplo').first()).toBeVisible();

    // 2) sin sector no deja confirmar
    await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
    await expect(page.getByText('Elegí el sector antes de confirmar')).toBeVisible();

    // 3) con sector y una observación se confirma
    await page.getByLabel('Sector *').selectOption({ label: 'Planta de ejemplo' });
    await page.getByLabel('Observación general (opcional)').fill('prueba-e2e');
    await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
    await page.getByRole('button', { name: /Sí, confirmar retiro/ }).click();
    await expect(page.getByText('Retiro confirmado')).toBeVisible();

    // 4) el stock bajó una unidad
    await buscarElRepuesto(page);
    expect(await stockMostrado(page)).toBe(antes - 1);

    // 5) se devuelve esa unidad desde el historial (el retiro de ejemplo tiene 2 unidades; el nuestro, 1) y el stock vuelve a lo de antes
    await page.getByRole('button', { name: 'Retiros', exact: true }).first().click();
    // Primero se espera a que el historial cargue (aparecen los botones de abrir cada retiro), recién después se abren de a uno.
    const cerradas = page.getByRole('button', { name: 'Ver el detalle del retiro' });
    await expect(cerradas.first()).toBeVisible();
    for (let n = 0; n < 10 && await cerradas.count(); n++) await cerradas.first().click();
    const devolver = page.getByRole('button', { name: /Devolver/ });
    await expect(devolver.first()).toBeVisible();
    let devuelto = false;
    const cantidadDeBotones = await devolver.count();
    for (let i = 0; i < cantidadDeBotones && !devuelto; i++) {
      await devolver.nth(i).click();
      const dialogo = page.getByRole('dialog');
      if ((await dialogo.textContent())?.includes('retiraste 1)')) {
        await dialogo.getByRole('button', { name: 'Confirmar devolución' }).click();
        await expect(page.getByText(/Devolviste 1 unidad/)).toBeVisible();
        devuelto = true;
      } else {
        await dialogo.getByRole('button', { name: 'Cancelar' }).click();
        await expect(dialogo).toBeHidden();
      }
    }
    expect(devuelto).toBe(true);
    await buscarElRepuesto(page);
    expect(await stockMostrado(page)).toBe(antes);
  });
});
