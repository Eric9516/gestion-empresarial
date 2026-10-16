import { expect, test } from '@playwright/test';
import { entrar } from './ayudas';

// El catálogo vive en el servidor: la aplicación nunca lo descarga entero para filtrarlo en el navegador. Esta prueba mira lo que la app le pide a la base:
// ninguna lectura grande de la tabla de repuestos, y búsquedas con tope. Con esto, 5.000 repuestos o 1.000.000 cuestan lo mismo en el navegador.
// (La velocidad con muchísimos repuestos se mide en la base: `node scripts/pruebas/concurrencia/busqueda.mjs`.)
test.describe('Catálogo en el servidor', () => {
  test.beforeEach(async ({ page }) => { await entrar(page); });

  test('buscar repuestos se hace en la base, de a tandas con tope, y no se baja el catálogo', async ({ page }) => {
    const pedidos: string[] = [];
    page.on('request', r => { if (r.url().includes('/rest/v1/')) pedidos.push(`${r.method()} ${decodeURIComponent(r.url())} ${r.postData() ?? ''}`); });

    await page.goto('/mantenimiento');
    await page.getByPlaceholder('Código, número o descripción...').fill('rodamiento');
    await expect(page.getByText('Rodamiento de ejemplo').first()).toBeVisible();

    // ninguna lectura grande ni paginada de la tabla de repuestos
    expect(pedidos.filter(p => /\/rest\/v1\/items\?/.test(p) && /limit=\d{3,}|offset=|select=\*/.test(p))).toEqual([]);
    // la búsqueda la hizo la función de la base, con un tope
    const busquedas = pedidos.filter(p => /rpc\/buscar_repuestos/.test(p));
    expect(busquedas.length).toBeGreaterThan(0);
    expect(busquedas.every(p => /"p_limite":(\d+)/.test(p) && Number(/"p_limite":(\d+)/.exec(p)![1]) <= 500)).toBe(true);
  });

  test('sin escribir nada no se pide nada del catálogo', async ({ page }) => {
    const pedidos: string[] = [];
    page.on('request', r => { if (/\/rest\/v1\/(items|rpc\/buscar_repuestos)/.test(r.url())) pedidos.push(r.url()); });
    await page.goto('/mantenimiento');
    await expect(page.getByText('Buscá un repuesto')).toBeVisible();
    // el único pedido permitido es el de "¿hay algún repuesto?" (trae una fila como mucho)
    expect(pedidos.filter(u => /rpc\/buscar_repuestos/.test(u) || !/limit=1\b/.test(decodeURIComponent(u)))).toEqual([]);
  });

  test('el informe de reposición lo arma la base: pide solo lo que hay que reponer, con tope', async ({ page }) => {
    const pedidos: string[] = [];
    page.on('request', r => { if (r.url().includes('/rest/v1/')) pedidos.push(`${r.method()} ${decodeURIComponent(r.url())} ${r.postData() ?? ''}`); });
    await page.goto('/mantenimiento');
    await page.getByRole('button', { name: /Informe/ }).first().click();
    await expect(page.getByText('No hay nada para reponer').first()).toBeVisible();
    expect(pedidos.some(p => /rpc\/repuestos_a_reponer/.test(p) && /"p_limite":500/.test(p))).toBe(true);
    expect(pedidos.filter(p => /\/rest\/v1\/items\?/.test(p) && /limit=\d{3,}|offset=|select=\*/.test(p))).toEqual([]);
  });

  test('informe de reposición: aparece lo que llegó al punto de pedido, se marca su estado y se arma la solicitud', async ({ page }) => {
    const irAlInforme = async () => { await page.goto('/mantenimiento'); await page.getByRole('button', { name: /Informe/ }).first().click(); };
    const editarRepuesto = async (minimo: string, puntoDePedido: string) => {
      await page.goto('/mantenimiento');
      await page.getByRole('combobox').first().selectOption({ label: 'Familia de ejemplo (AA)' });
      await page.getByText('Rodamiento de ejemplo').first().click();
      await page.getByRole('button', { name: /Editar/ }).first().click();
      await page.getByLabel(/Stock mínimo/).fill(minimo);
      await page.getByLabel(/Punto de pedido/).fill(puntoDePedido);
      await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
      await expect(page.getByText('Repuesto actualizado')).toBeVisible();
    };
    // el repuesto de ejemplo queda por debajo de su punto de pedido
    await editarRepuesto('500', '400');
    try {
      await irAlInforme();
      await expect(page.getByRole('row', { name: /AA00001/ })).toBeVisible();

      // el estado se guarda en la base y se ve también al volver a entrar
      await page.getByLabel(/Estado de .*AA00001/).selectOption({ label: 'Pasado a compras' });
      await expect(page.getByText(/1 artículo: pasado a compras/i)).toBeVisible();
      await irAlInforme();
      await expect(page.getByLabel(/Estado de .*AA00001/)).toHaveValue('compras');

      // el filtro por estado lo hace la base
      await page.getByLabel('Filtrar por estado').selectOption('sin');
      await expect(page.getByRole('row', { name: /AA00001/ })).toHaveCount(0);
      await page.getByLabel('Filtrar por estado').selectOption('compras');
      await expect(page.getByRole('row', { name: /AA00001/ })).toBeVisible();

      // se selecciona y se arma la solicitud de presupuesto
      await page.getByLabel(/Seleccionar .*AA00001/).check();
      await page.getByRole('button', { name: /Armar solicitud de presupuesto \(1\)/ }).click();
      await expect(page.getByRole('dialog')).toContainText('Rodamiento de ejemplo');
      await page.keyboard.press('Escape');
    } finally {
      await editarRepuesto('0', '0'); // se deja como estaba
    }
  });
});
