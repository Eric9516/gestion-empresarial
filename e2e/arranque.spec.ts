import { expect, test } from '@playwright/test';
import { entrar } from './ayudas';

// Cuida que la app no pida lo mismo dos veces al abrir una pantalla (antes el perfil se pedía tres veces y los datos de la lista esperaban en fila).
test.describe('Arranque: sin pedidos repetidos', () => {
  for (const ruta of ['/', '/mantenimiento']) {
    test(`al abrir ${ruta} cada dato se pide una sola vez`, async ({ page }) => {
      await entrar(page);
      const pedidos: string[] = [];
      page.on('request', r => {
        const u = new URL(r.url());
        if (u.port === '54399' && r.method() === 'GET') pedidos.push(u.pathname + u.search);
      });
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      expect(pedidos.length).toBeGreaterThan(3);
      const repetidos = pedidos.filter((p, i) => pedidos.indexOf(p) !== i);
      expect(repetidos).toEqual([]);
    });
  }
});
