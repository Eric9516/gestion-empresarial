import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

// Depósitos que el dueño nombra y personaliza: Configuración → Depósito → Depósitos. El cliente de ejemplo tiene el depósito que crea la instalación ("Depósito principal").
// Cada prueba deja las cosas como estaban (se comparte una sola base).
async function irADepositos(page: Page) {
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Depósito', exact: true }).click();
  await page.getByRole('button', { name: /Depósitos/ }).click();
  await expect(page.getByText(/\d+ de \d+ en uso/)).toBeVisible();
}

async function editar(page: Page, desde: string, nombre: string, icono: string) {
  await page.getByRole('button', { name: `Editar ${desde}` }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Nombre').fill(nombre);
  await modal.getByRole('button', { name: icono, exact: true }).click();
  await modal.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Depósito guardado')).toBeVisible();
}

test.describe('Depósitos', () => {
  test('el dueño ve su depósito, con la letra y cuántos permite el plan, y no puede pasarse del tope', async ({ page }) => {
    await entrar(page);
    await irADepositos(page);
    const lista = page.getByRole('listitem').filter({ hasText: 'Depósito principal' });
    await expect(lista).toContainText('Principal');
    await expect(lista).toContainText(/Letra [A-Z]/);
    // el plan de ejemplo permite un solo depósito: el botón de crear queda bloqueado y dice por qué
    await expect(page.getByRole('button', { name: /Nuevo depósito/ })).toBeDisabled();
    await expect(page.getByText(/El plan permite hasta 1 depósito/)).toBeVisible();
  });

  test('cambiar el nombre y el ícono se ve en el encabezado, en el menú y en Mi perfil; después se deja como estaba', async ({ page }) => {
    await entrar(page);
    await irADepositos(page);
    await editar(page, 'Depósito principal', 'Mantenimiento', 'herramienta');

    await page.goto('/deposito');
    await expect(page.getByRole('heading', { name: 'Mantenimiento', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Mantenimiento', exact: true })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Mantenimiento', exact: true })).toBeVisible();

    await irADepositos(page);
    await editar(page, 'Mantenimiento', 'Depósito principal', 'deposito');
    await page.goto('/deposito');
    await expect(page.getByRole('heading', { name: 'Depósito principal' })).toBeVisible();
  });

  test('un nombre vacío no se puede guardar y una letra repetida o inválida avisa', async ({ page }) => {
    await entrar(page);
    await irADepositos(page);
    await page.getByRole('button', { name: 'Editar Depósito principal' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Nombre').fill('   ');
    await expect(modal.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    await modal.getByLabel('Nombre').fill('Depósito principal');
    await modal.getByLabel('Letra de los códigos').fill('');
    await expect(modal.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    await modal.getByRole('button', { name: 'Cancelar' }).click();
  });
});
