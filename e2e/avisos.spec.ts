import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrar, DUENO } from './ayudas';

// Los avisos del menú (el número rojo): cuando otra persona hace algo, el dueño lo ve en el menú sin tener que abrir cada sección,
// y al abrir la sección el aviso se apaga. Lo prueba con dos personas a la vez: el dueño mirando y un usuario común mandando una sugerencia.
const COMUN = { email: 'comun@plan2.test', clave: DUENO.clave };

async function enviarSugerenciaComoComun(browser: Browser, texto: string) {
  const contexto = await browser.newContext({ baseURL: 'http://localhost:3013', viewport: { width: 1280, height: 800 }, locale: 'es-AR' });
  const otra: Page = await contexto.newPage();
  await entrar(otra, COMUN);
  await otra.locator('.user-badge button').first().click();
  await otra.getByRole('menuitem', { name: /Sugerencia/ }).click();
  await otra.getByPlaceholder('Escribí tu idea o sugerencia acá...').fill(texto);
  await otra.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(otra.getByText('¡Gracias! Tu sugerencia fue enviada')).toBeVisible();
  await contexto.close();
}

test.describe('Avisos en el menú', () => {
  test.beforeEach(async ({ page }) => { await entrar(page); });

  test('una sugerencia nueva se ve en el menú (con número) y se apaga al abrirla', async ({ page, browser }) => {
    // El dueño ya está mirando: la primera visita deja marcado "visto hasta ahora".
    await page.goto('/mantenimiento');
    await page.waitForLoadState('networkidle');
    const menu = page.getByRole('navigation', { name: 'Secciones' });
    await expect(menu.locator('.menu-lateral-cant')).toHaveCount(0);

    await enviarSugerenciaComoComun(browser, 'aviso-e2e');

    // Al volver a la pantalla (o a los 30 segundos) el menú muestra el aviso en Configuración.
    await page.reload();
    await expect(menu.getByRole('button', { name: /Configuración/ }).locator('.menu-lateral-cant')).toHaveText('1');

    // En Configuración, el aviso está en "Sugerencias" y se apaga al abrirla.
    await menu.getByRole('button', { name: /Configuración/ }).click();
    const sugerencias = menu.getByRole('button', { name: /Sugerencias/ });
    await expect(sugerencias.locator('.menu-lateral-cant')).toHaveText('1');
    const guardado = page.waitForResponse(r => r.url().includes('marcar_aviso_visto'));
    await sugerencias.click();
    expect((await guardado).status()).toBeLessThan(300);
    await expect(page.getByText('aviso-e2e')).toBeVisible();
    await expect(menu.locator('.menu-lateral-cant')).toHaveCount(0);

    // Y queda apagado también si se vuelve a cargar (se guardó en la base, no solo en la pantalla).
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(menu.locator('.menu-lateral-cant')).toHaveCount(0);
  });

  test('@celular el aviso aparece en el botón del menú y como número en Configuración', async ({ page, browser }) => {
    await page.goto('/mantenimiento');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Menú', exact: true })).not.toHaveAttribute('title', 'Hay novedades');

    await enviarSugerenciaComoComun(browser, 'aviso-celular-e2e');

    await page.reload();
    const hamburguesa = page.getByRole('button', { name: 'Menú', exact: true });
    await expect(hamburguesa).toHaveAttribute('title', 'Hay novedades');
    await expect(hamburguesa.locator('.hamburger-aviso')).toBeVisible();
    await hamburguesa.click();
    await expect(page.getByRole('dialog', { name: 'Menú' }).getByRole('button', { name: /Configuración/ }).locator('.aviso-numero')).toHaveText('1');

    // Se apaga al abrir las sugerencias.
    await page.getByRole('dialog', { name: 'Menú' }).getByRole('button', { name: /Configuración/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Configuración' })).toBeVisible();
    await page.getByRole('button', { name: 'Menú', exact: true }).click();
    await page.getByRole('dialog', { name: 'Menú' }).getByRole('button', { name: /Sugerencias/ }).click();
    await expect(page.getByText('aviso-celular-e2e')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Menú', exact: true })).not.toHaveAttribute('title', 'Hay novedades');
  });
});
