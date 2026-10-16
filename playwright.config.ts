import { defineConfig, devices } from '@playwright/test';

// Pruebas de pantalla: abren la app de verdad en un navegador y hacen lo que haría una persona (entrar, buscar, retirar, guardar...).
// Corren contra el Supabase LOCAL de prueba (scripts/pruebas/supabase-local), nunca contra un proyecto real. Se usa el Microsoft Edge que ya está
// instalado, así no hay que bajar otro navegador. Se corren con `pnpm pruebas:pantalla`.
// En la computadora se usa el Microsoft Edge instalado. En GitHub (variable CI) se usa el Chromium que baja Playwright.
const NAVEGADOR = process.env.CI ? undefined : 'msedge';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Las pruebas comparten una sola base: van de a una, en orden, y cada archivo deja las cosas como estaban.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3013',
    channel: NAVEGADOR,
    locale: 'es-AR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'computadora', use: { ...devices['Desktop Chrome'], channel: NAVEGADOR, viewport: { width: 1280, height: 800 } }, grepInvert: /@celular/ },
    { name: 'celular', use: { ...devices['Pixel 7'], channel: NAVEGADOR }, grep: /@celular/ },
  ],
  webServer: {
    command: 'node e2e/levantar.mjs',
    url: 'http://localhost:3013',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
