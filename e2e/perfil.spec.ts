import { expect, test, type Page } from '@playwright/test';
import { entrar, DUENO } from './ayudas';

const COMUN = { email: 'comun@plan2.test', clave: DUENO.clave };

async function abrirMiPerfil(page: Page) {
  await page.goto('/deposito');
  await page.locator('.user-badge button').first().click();
  await page.getByRole('menuitem', { name: /Mi perfil/ }).click();
  const perfil = page.getByRole('dialog', { name: /Mi perfil/ });
  await expect(perfil).toBeVisible();
  return perfil;
}

test.describe('Mi perfil', () => {
  test.beforeEach(async ({ page }) => { await entrar(page); });

  test('muestra los permisos solo con su nombre y la explicación aparece con el signo de pregunta', async ({ page }) => {
    const perfil = await abrirMiPerfil(page);
    await expect(perfil.getByText('Mis permisos')).toBeVisible();
    await expect(perfil.getByText('Ver todos los retiros')).toBeVisible();
    await expect(perfil.getByText('Ajustar inventario')).toBeVisible();
    await expect(perfil.getByText('Resetear contraseñas')).toBeVisible();
    await expect(perfil.getByText('Mi cuenta')).toBeVisible();
    await expect(perfil.getByText('Cuenta creada')).toBeVisible();

    // todavía no se explica nada
    await expect(perfil.getByText('Ve los retiros que hizo cualquier persona')).toHaveCount(0);
    const ayuda = perfil.getByRole('button', { name: /¿Qué significa cada cosa\?/ });
    await ayuda.click();
    await expect(perfil.getByText('Ve los retiros que hizo cualquier persona')).toBeVisible();
    await expect(perfil.getByText('Control total: configura la empresa')).toBeVisible();
    await ayuda.click();
    await expect(perfil.getByText('Ve los retiros que hizo cualquier persona')).toHaveCount(0);
  });

  test('una persona sin permisos especiales no ve ninguno (ni los que no tiene)', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await entrar(page, COMUN);
    const perfil = await abrirMiPerfil(page);
    await expect(perfil.getByText('Sin permisos especiales')).toBeVisible();
    await expect(perfil.getByText('Ver todos los retiros')).toHaveCount(0);
    await expect(perfil.getByText('Ajustar inventario')).toHaveCount(0);
    await expect(perfil.getByText('Resetear contraseñas')).toHaveCount(0);
    // y la ayuda tampoco explica lo que no tiene
    await perfil.getByRole('button', { name: /¿Qué significa cada cosa?/ }).click();
    await expect(perfil.getByText('Ve los retiros que hizo cualquier persona')).toHaveCount(0);
    await expect(perfil.getByText('Trabaja en su área')).toBeVisible();
  });

  test('cambiar la contraseña: pide la actual, valida la nueva y deja todo como estaba', async ({ page }) => {
    const perfil = await abrirMiPerfil(page);
    const abrirFormulario = () => perfil.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await abrirFormulario();

    // sin completar, una contraseña corta, que no coincide, o una actual equivocada: no cambia nada
    await perfil.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByText('Escribí tu contraseña actual')).toBeVisible();
    await perfil.getByLabel('Contraseña actual').fill(DUENO.clave);
    await perfil.getByLabel('Contraseña nueva (al menos 8 caracteres)').fill('corta');
    await perfil.getByLabel('Repetir la contraseña nueva').fill('corta');
    await perfil.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByText('al menos 8 caracteres').first()).toBeVisible();
    await perfil.getByLabel('Contraseña actual').fill('no-es-la-clave');
    await perfil.getByLabel('Contraseña nueva (al menos 8 caracteres)').fill('Clave-nueva-123');
    await perfil.getByLabel('Repetir la contraseña nueva').fill('Clave-nueva-123');
    await perfil.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByText('La contraseña actual no es correcta')).toBeVisible();

    // cambiarla de verdad y volver a ponerla como estaba (las demás pruebas entran con la de siempre)
    await perfil.getByLabel('Contraseña actual').fill(DUENO.clave);
    await perfil.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByText('Contraseña cambiada')).toBeVisible();
    await abrirFormulario();
    await perfil.getByLabel('Contraseña actual').fill('Clave-nueva-123');
    await perfil.getByLabel('Contraseña nueva (al menos 8 caracteres)').fill(DUENO.clave);
    await perfil.getByLabel('Repetir la contraseña nueva').fill(DUENO.clave);
    await perfil.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByText('Contraseña cambiada').first()).toBeVisible();
  });

  test('cerrar la sesión en los demás equipos', async ({ page }) => {
    const perfil = await abrirMiPerfil(page);
    await perfil.getByRole('button', { name: 'Cerrar sesión en los demás equipos' }).click();
    await expect(page.getByText('Se cerró la sesión en los demás equipos')).toBeVisible();
  });
});
