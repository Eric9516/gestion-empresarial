import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

// Las listas que crecen sin freno (retiros, movimientos de stock, historial de cambios) se piden de a páginas y con los filtros hechos en la base: la aplicación nunca
// trae todo. Esta prueba mira lo que la app le pide a la base y que las pantallas sigan funcionando (la velocidad con millones de filas se mide en
// `node scripts/pruebas/concurrencia/listas.mjs`).
function registrarPedidos(page: Page) {
  const pedidos: string[] = [];
  page.on('request', r => { if (r.url().includes('/rest/v1/')) pedidos.push(`${r.method()} ${decodeURIComponent(r.url())} ${r.postData() ?? ''}`); });
  return pedidos;
}

test.describe('Listas paginadas', () => {
  test.beforeEach(async ({ page }) => { await entrar(page); });

  test('historial de retiros: lo arma la base de a páginas y la búsqueda se hace en la base', async ({ page }) => {
    const pedidos = registrarPedidos(page);
    await page.goto('/deposito');
    await page.getByRole('button', { name: 'Retiros', exact: true }).first().click();
    // el retiro de ejemplo (2 unidades del repuesto de ejemplo, sector "Planta de ejemplo")
    await expect(page.getByText('Planta de ejemplo').first()).toBeVisible();
    expect(pedidos.some(p => /rpc\/historial_de_retiros/.test(p) && /"p_limite":50/.test(p))).toBe(true);
    // ninguna lectura directa y completa de la tabla de retiros
    // (salvo el aviso del menú: solo lo nuevo desde la última vez que se miró, de a 100 como mucho)
    expect(pedidos.filter(p => /\/rest\/v1\/retiros\?/.test(p) && !/created_at=gt\./.test(p))).toEqual([]);

    const buscador = page.getByPlaceholder('Buscar por repuesto, sector u operario...');
    // por un repuesto y por un sector (lo resuelve la base)
    await buscador.fill('rodamiento');
    await expect(page.getByText('Planta de ejemplo').first()).toBeVisible();
    await buscador.fill('Planta');
    await expect(page.getByText('Planta de ejemplo').first()).toBeVisible();
    await buscador.fill('zzzzzz-nada');
    await expect(page.getByText('Sin resultados')).toBeVisible();
    await expect.poll(() => pedidos.some(p => /rpc\/historial_de_retiros/.test(p) && /"p_texto":"zzzzzz-nada"/.test(p))).toBe(true);
  });

  test('movimientos de stock: se piden de a páginas y se buscan en la base', async ({ page }) => {
    const pedidos = registrarPedidos(page);
    await page.goto('/deposito');
    await page.getByRole('button', { name: /Movimientos/ }).first().click();
    await expect(page.getByText('Movimientos de stock').first()).toBeVisible();
    expect(pedidos.some(p => /rpc\/lista_de_movimientos/.test(p) && /"p_limite":50/.test(p))).toBe(true);
    expect(pedidos.filter(p => /\/rest\/v1\/ajustes_inventario\?/.test(p))).toEqual([]);
    await page.getByPlaceholder(/Número, artículo/).fill('zzzzzz-nada');
    await expect.poll(() => pedidos.some(p => /rpc\/lista_de_movimientos/.test(p) && /"p_texto":"zzzzzz-nada"/.test(p))).toBe(true);
    await expect(page.getByText('No hay movimientos')).toBeVisible();
  });

  test('historial de cambios: de a páginas con filtros que hace la base', async ({ page }) => {
    const pedidos = registrarPedidos(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: /Historial/ }).first().click();
    await expect(page.getByText('Historial de cambios').first()).toBeVisible();
    // pide una página con tope (no "todo")
    await expect.poll(() => pedidos.some(p => /\/rest\/v1\/audit_log\?/.test(p) && /limit=50/.test(p))).toBe(true);
    // un filtro por tipo se aplica en la base
    await page.getByLabel('Filtrar por tipo').selectOption({ label: 'Repuesto' });
    await expect.poll(() => pedidos.some(p => /\/rest\/v1\/audit_log\?/.test(p) && /tabla=eq\.items/.test(p))).toBe(true);
    await page.getByLabel('Filtrar por acción').selectOption({ label: 'Baja' });
    await expect.poll(() => pedidos.some(p => /\/rest\/v1\/audit_log\?/.test(p) && /accion=eq\.delete/.test(p))).toBe(true);
  });
});
