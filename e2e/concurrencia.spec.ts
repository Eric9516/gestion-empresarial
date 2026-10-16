import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

// Lo que pasa cuando varias personas trabajan sobre lo mismo a la vez (la prueba de carga con una base real está en scripts/pruebas/concurrencia).
async function abrirEdicion(page: Page) {
  await page.goto('/mantenimiento');
  await page.getByRole('combobox').first().selectOption({ label: 'Familia de ejemplo (AA)' });
  await page.getByText('AA00001').first().click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Descripción *')).toHaveValue('Rodamiento de ejemplo');
}

test.describe('Concurrencia', () => {
  test('dos personas editan el mismo repuesto: la segunda recibe un aviso y no pisa lo de la primera', async ({ browser }) => {
    const contexto = await browser.newContext({ baseURL: 'http://localhost:3013' });
    const ana = await contexto.newPage(), juan = await contexto.newPage();
    await entrar(ana);
    await abrirEdicion(ana);
    await abrirEdicion(juan);

    // Juan guarda primero
    const ubicacionDeJuan = `Estante J-${Date.now()}`;
    await juan.getByRole('dialog').getByLabel('Ubicación').fill(ubicacionDeJuan);
    await juan.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await expect(juan.getByText('Repuesto actualizado')).toBeVisible();

    // Ana guarda después, sobre la versión vieja que tenía abierta: no se pisa nada, se avisa y el formulario se llena con lo nuevo
    await ana.getByRole('dialog').getByLabel('Descripción *').fill('Rodamiento de ejemplo (cambio de Ana)');
    await ana.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await expect(ana.getByText(/Alguien modificó este repuesto/)).toBeVisible();
    await expect(ana.getByRole('dialog').getByLabel('Ubicación')).toHaveValue(ubicacionDeJuan);
    await expect(ana.getByRole('dialog').getByLabel('Descripción *')).toHaveValue('Rodamiento de ejemplo');

    // Ana revisa y guarda de nuevo, ahora sobre la versión nueva: se guarda
    await ana.getByRole('dialog').getByLabel('Descripción *').fill('Rodamiento de ejemplo');
    await ana.getByRole('dialog').getByLabel('Ubicación').fill('');
    await ana.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await expect(ana.getByText('Repuesto actualizado')).toBeVisible();
    await contexto.close();
  });

  test('dos proveedores abiertos a la vez: el que guarda segundo recibe el aviso', async ({ browser }) => {
    const contexto = await browser.newContext({ baseURL: 'http://localhost:3013' });
    const ana = await contexto.newPage(), juan = await contexto.newPage();
    await entrar(ana);
    for (const p of [ana, juan]) {
      await p.goto('/');
      await p.getByRole('row', { name: /Proveedor de ejemplo/ }).getByTitle('Editar').click();
      await expect(p.getByRole('dialog')).toBeVisible();
    }
    const rubroDeJuan = `Rubro J-${Date.now()}`;
    await juan.getByRole('dialog').getByLabel('Rubro').fill(rubroDeJuan);
    await juan.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await expect(juan.getByRole('dialog')).toBeHidden();

    await ana.getByRole('dialog').getByLabel('Rubro').fill('Rubro de Ana');
    await ana.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await expect(ana.getByText(/Alguien modificó este proveedor/)).toBeVisible();
    // la lista se actualizó con lo de Juan y lo de Ana no se guardó
    await expect(ana.getByRole('row', { name: /Proveedor de ejemplo/ })).toContainText(rubroDeJuan);

    // se deja como estaba
    await ana.getByRole('row', { name: /Proveedor de ejemplo/ }).getByTitle('Editar').click();
    await ana.getByRole('dialog').getByLabel('Rubro').fill('Repuestos');
    await ana.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
    await expect(ana.getByRole('dialog')).toBeHidden();
    await contexto.close();
  });

  test('varias altas a la vez en la misma subfamilia reciben números distintos', async ({ page }) => {
    await entrar(page);
    const env = readFileSync(join(import.meta.dirname, '..', '.env.ui-plan2'), 'utf8');
    const url = /VITE_SUPABASE_URL=(.+)/.exec(env)![1].trim(), clave = /VITE_SUPABASE_ANON_KEY=(.+)/.exec(env)![1].trim();
    const token = await page.evaluate(() => {
      const k = Object.keys(localStorage).find(x => x.endsWith('-auth-token'))!;
      return (JSON.parse(localStorage.getItem(k)!) as { access_token: string }).access_token;
    });
    const cab = { apikey: clave, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const [fam] = await (await page.request.get(`${url}/rest/v1/familias?codigo=eq.AA&select=id`, { headers: cab })).json();
    const [sub] = await (await page.request.get(`${url}/rest/v1/subfamilias?codigo=eq.AA&familia_id=eq.${fam.id}&select=id`, { headers: cab })).json();

    const pedir = (i: number) => page.request.post(`${url}/rest/v1/rpc/crear_repuesto`, {
      headers: cab,
      data: { p_familia_id: fam.id, p_subfamilia_id: sub.id, p_numero: null, p_descripcion: `zz concurrencia ${i}`, p_ubicacion: '', p_stock: 0, p_stock_minimo: 0, p_punto_pedido: 0, p_detalles: '' },
    });
    const respuestas = await Promise.all(Array.from({ length: 8 }, (_, i) => pedir(i)));
    const items = await Promise.all(respuestas.map(async r => { expect(r.ok(), await r.text()).toBe(true); return r.json() as Promise<{ id: string; codigo: string }>; }));
    const codigos = items.map(i => i.codigo);
    expect(new Set(codigos).size).toBe(8);
    expect(codigos.every(c => /^MAAAA\d{5}$/.test(c))).toBe(true);

    // se limpian
    const ids = items.map(i => i.id).join(',');
    const borrado = await page.request.delete(`${url}/rest/v1/items?id=in.(${ids})`, { headers: cab });
    expect(borrado.ok()).toBe(true);
  });
});
