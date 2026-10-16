import { expect, type Page } from '@playwright/test';

// Usuario y clave del cliente de ejemplo "Plan 2" que arma scripts/pruebas/supabase-local/servidor-ui.mjs. Son datos de prueba, de un servidor que solo existe en esta computadora.
export const DUENO = { email: 'dueno@plan2.test', clave: 'Prueba-UI-9!zz' };

export async function entrar(page: Page, usuario = DUENO) {
  await page.goto('/login');
  await page.getByPlaceholder('tu@correo.com').fill(usuario.email);
  await page.getByPlaceholder('••••••••').fill(usuario.clave);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // Entrar lleva a la pantalla principal (el Directorio).
  await expect(page).not.toHaveURL(/\/login/);
}
