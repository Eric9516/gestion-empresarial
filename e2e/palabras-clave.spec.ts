import { expect, test, type Page } from '@playwright/test';
import { entrar } from './ayudas';

// Palabras clave: cómo llama la gente de planta a un repuesto. Cuentan en la búsqueda (sin importar tildes ni plural) y no se muestran en la
// lista de resultados. La prueba deja el repuesto como estaba (se comparte una sola base).
async function ponerPalabrasClave(page: Page, texto: string) {
  await page.goto('/deposito');
  await page.getByRole('combobox').first().selectOption({ label: 'Familia de ejemplo (AA)' });
  await page.getByText('Rodamiento de ejemplo').first().click();
  await page.getByRole('button', { name: /Editar/ }).first().click();
  await page.getByLabel('Palabras clave').fill(texto);
  await page.getByRole('button', { name: /^Guardar/ }).click();
  await expect(page.getByLabel('Palabras clave')).toHaveCount(0);
}

test.describe('Palabras clave', () => {
  test('se encuentra el repuesto por su palabra clave aunque se busque sin tildes y en plural, y no aparece en la lista', async ({ page }) => {
    await entrar(page);
    await ponerPalabrasClave(page, 'rulemán de cinta');

    await page.goto('/deposito');
    const buscador = page.getByPlaceholder('Código, número o descripción...');
    await buscador.fill('rulemanes cinta');
    await expect(page.getByText('Rodamiento de ejemplo').first()).toBeVisible();
    // la palabra clave no se muestra en la lista de resultados
    await expect(page.locator('main').getByText('rulemán de cinta')).toHaveCount(0);

    await ponerPalabrasClave(page, '');
    await page.goto('/deposito');
    await page.getByPlaceholder('Código, número o descripción...').fill('rulemanes cinta');
    await expect(page.getByText(/Sin resultados/)).toBeVisible();
  });
});
