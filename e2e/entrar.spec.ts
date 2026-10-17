import { expect, test } from '@playwright/test';
import { DUENO, entrar } from './ayudas';

test.describe('Entrar a la app', () => {
  test('con la clave equivocada avisa y no deja pasar', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('tu@correo.com').fill(DUENO.email);
    await page.getByPlaceholder('••••••••').fill('clave-equivocada');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.getByText('Email o contraseña incorrectos')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('sin haber entrado, cualquier pantalla lleva al login', async ({ page }) => {
    await page.goto('/deposito');
    await expect(page).toHaveURL(/\/login/);
  });

  test('con la clave correcta entra al Directorio y muestra el nombre de la empresa', async ({ page }) => {
    await entrar(page);
    await expect(page).toHaveTitle(/Cliente Plan 2/);
    await expect(page.getByText('Proveedor de ejemplo')).toBeVisible();
  });

  test('la dirección vieja del Depósito (/mantenimiento) sigue funcionando y lleva a /deposito', async ({ page }) => {
    await entrar(page);
    await page.goto('/mantenimiento');
    await expect(page).toHaveURL(/\/deposito$/);
    await expect(page.getByRole('heading', { name: 'Depósito de mantenimiento' })).toBeVisible();
  });

  test('si ya entró, /login lo manda de nuevo a la pantalla principal', async ({ page }) => {
    await entrar(page);
    await page.goto('/login');
    await expect(page).not.toHaveURL(/\/login/);
  });
});
