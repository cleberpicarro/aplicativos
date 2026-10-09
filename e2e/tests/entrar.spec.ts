import type { Page } from '@playwright/test';
import { test, expect, entrar, EQUIPE } from './apoio';

/** Sair recarrega a página: espera o recarregamento terminar. */
async function sair(page: Page) {
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Sair' }).click()]);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
}

test.describe('entrar e sair', () => {
  test('senha errada mostra erro e não entra @celular', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('E-mail').fill(EQUIPE.joao);
    await page.getByLabel('Senha').fill('senha-errada');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  });

  test('cada pessoa cai na tela certa e consegue sair @celular', async ({ page }) => {
    await entrar(page, 'joao');
    await expect(page.locator('.topbar h1')).toHaveText('Tarefas');
    await expect(page.getByRole('link', { name: /Painel/ })).toHaveCount(0); // funcionário não tem equipe
    await sair(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

    await entrar(page, 'marina');
    await expect(page.locator('.topbar h1')).toHaveText('Painel');
    await sair(page);

    await entrar(page, 'renata');
    await expect(page.locator('.topbar h1')).toHaveText('Pessoas');
    await expect(page.getByRole('link', { name: /^Tarefas$/ })).toHaveCount(0);
  });

  test('esqueci minha senha responde igual para qualquer e-mail', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
    await page.getByLabel('E-mail').fill('ninguem@nerus.com.br');
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByText(/Se houver uma conta com ninguem@nerus.com.br, enviamos um link/)).toBeVisible();
  });
});
