import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

// Cada persona elige dónde va el menú en la computadora (a la izquierda, arriba o abajo). Queda guardado en su perfil: sigue igual al
// recargar, en las dos pantallas, y en cualquier computadora. La prueba lo deja a la izquierda al terminar (se comparte una sola base).
const menu = (page: Page) => page.getByRole('navigation', { name: 'Secciones' });

async function elegir(page: Page, nombre: 'Menú a la izquierda' | 'Menú arriba' | 'Menú abajo') {
  // en la posición lateral el selector aparece al abrir el menú (al acercar el mouse)
  if (await menu(page).evaluate(n => n.classList.contains('menu-lateral'))) await menu(page).hover();
  // el selector es un ícono discreto: las otras opciones aparecen al pasar el mouse por encima
  await menu(page).getByRole('radiogroup', { name: 'Dónde va el menú' }).hover();
  await menu(page).getByRole('radio', { name: nombre }).click();
  await expect(menu(page).getByRole('radio', { name: nombre })).toHaveAttribute('aria-checked', 'true');
  // al sacar el mouse se vuelve a cerrar: queda solo el ícono de la posición elegida (antes quedaba abierto por el foco del clic)
  await page.mouse.move(640, 420);
  await expect(menu(page).getByRole('radio', { checked: false })).toHaveCount(0);
  await expect(menu(page).getByRole('radio', { checked: true })).toBeVisible();
}

test.describe('Dónde va el menú', () => {
  test('se puede poner arriba o abajo, se mantiene al recargar y en las dos pantallas, y vuelve a la izquierda', async ({ page }) => {
    await entrar(page);
    await page.goto('/deposito');
    await expect(menu(page)).toHaveClass(/menu-lateral/);

    await elegir(page, 'Menú arriba');
    await expect(menu(page)).toHaveClass(/menu-barra-arriba/);
    // las secciones siguen funcionando desde la barra
    await menu(page).getByRole('button', { name: /Retiros/ }).click();
    await expect(page.getByText('Historial de retiros')).toBeVisible();

    await page.reload();
    await expect(menu(page)).toHaveClass(/menu-barra-arriba/);
    await page.goto('/');
    await expect(menu(page)).toHaveClass(/menu-barra-arriba/);

    await elegir(page, 'Menú abajo');
    await expect(menu(page)).toHaveClass(/menu-barra-abajo/);
    await page.goto('/deposito');
    await expect(menu(page)).toHaveClass(/menu-barra-abajo/);

    await elegir(page, 'Menú a la izquierda');
    await expect(menu(page)).toHaveClass(/menu-lateral/);
    await page.reload();
    await expect(menu(page)).toHaveClass(/menu-lateral/);
  });
});
