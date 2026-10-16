import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

// Medición de ESCALA DEL NAVEGADOR: le entrega a la app catálogos sintéticos enormes (se responde el pedido de repuestos desde la propia prueba, sin base de datos)
// y mide lo que importa: cuánto tarda en estar usable, cuánta memoria usa, cuánto se traba mientras busca y escribe, y cuánto tarda cada búsqueda.
// No corre con el resto (tarda y es de medición): `ESCALA=1 pnpm exec playwright test e2e/escala-cliente.spec.ts --project=computadora`
// Con `ESCALA_ITEMS=5000,50000` se eligen los tamaños.
test.skip(!process.env.ESCALA, 'medición de escala: se corre a pedido con ESCALA=1');
test.setTimeout(10 * 60_000);

const TAMANOS = (process.env.ESCALA_ITEMS ?? '5000,50000,200000').split(',').map(Number);
const PALABRAS = ['rodamiento', 'junta', 'tornillo', 'bomba', 'valvula', 'sensor', 'correa', 'filtro', 'motor', 'reten', 'acople', 'resorte'];

function repuesto(i: number) {
  const n = String(i).padStart(5, '0');
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    codigo: `MAA${String.fromCharCode(65 + (i % 20))}${String.fromCharCode(65 + (i % 7))}${n}`, numero: n,
    descripcion: `${PALABRAS[i % 12]} ${PALABRAS[(i * 7) % 12]} tipo ${i % 97} medida ${i % 53}`,
    detalles: i % 5 === 0 ? `compatible con equipo ${i % 31} y repuesto alternativo ${i % 211}` : null,
    ubicacion: `Estante ${i % 40}`, stock: i % 100, stock_minimo: 5, punto_pedido: 8, activo: true,
    familia_id: '00000000-0000-4000-8000-00000000f001', subfamilia_id: '00000000-0000-4000-8000-00000000f002',
    foto_url: null, foto_url_2: null, foto_url_3: null, foto_pendiente: false, foto_pendiente_2: false, foto_pendiente_3: false, estado_reposicion: null,
  };
}

async function prepararPagina(page: Page, total: number) {
  await page.addInitScript(() => {
    (window as unknown as { __largas: number[] }).__largas = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) (window as unknown as { __largas: number[] }).__largas.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* sin soporte */ }
  });
  await page.route(/\/rest\/v1\/items\?.*select=id%2Ccodigo/, async route => {
    const url = new URL(route.request().url());
    const desde = Number(url.searchParams.get('offset') ?? 0), limite = Number(url.searchParams.get('limit') ?? 1000);
    const filas = [];
    for (let i = desde; i < Math.min(total, desde + limite); i++) filas.push(repuesto(i + 1));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `${desde}-${desde + filas.length - 1}/${total}`, 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(filas) });
  });
}

const memoria = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const m = (await cdp.send('Performance.getMetrics')).metrics.find(x => x.name === 'JSHeapUsedSize')!.value;
  await cdp.detach();
  return m / 1048576;
};
const largas = (page: Page) => page.evaluate(() => (window as unknown as { __largas: number[] }).__largas.slice());

test('el catálogo con muchísimos repuestos: carga, memoria, búsqueda y trabas', async ({ page }) => {
  const filas: string[] = [];
  await entrar(page);
  for (const total of TAMANOS) {
    await prepararPagina(page, total);
    await page.goto('/mantenimiento');
    const t0 = Date.now();
    const buscador = page.getByPlaceholder('Código, número o descripción...');
    await expect(buscador).toBeVisible();
    // la lista queda usable cuando se puede buscar y aparece el primer resultado
    await buscador.fill('MAAAA');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 5 * 60_000 });
    const usable = Date.now() - t0;
    const mem = await memoria(page);

    // búsquedas escribiendo de a una letra (como una persona) y búsqueda completa
    const tiempos: number[] = [];
    for (const consulta of ['rodamiento', 'bomba 12', 'valvula tipo 5 medida', 'zzzz-nada']) {
      await buscador.fill('');
      const t = Date.now();
      await buscador.pressSequentially(consulta, { delay: 0 });
      if (consulta.startsWith('zzzz')) await expect(page.getByText('Sin resultados').first()).toBeVisible({ timeout: 60_000 });
      else await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
      tiempos.push(Date.now() - t);
    }
    const trabas = await largas(page);
    const peorTraba = trabas.length ? Math.max(...trabas) : 0;
    filas.push(`${total.toLocaleString('es-AR').padStart(9)} repuestos | usable en ${(usable / 1000).toFixed(1).padStart(5)} s | memoria ${mem.toFixed(0).padStart(5)} MB | búsqueda ${Math.max(...tiempos).toFixed(0).padStart(5)} ms (peor de 4) | trabas: ${trabas.length} (la peor ${peorTraba.toFixed(0)} ms)`);
    await page.unroute(/\/rest\/v1\/items\?.*select=id%2Ccodigo/);
  }
  console.log('\n' + filas.join('\n'));
});
