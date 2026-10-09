import { test as base, expect, type Browser, type Page } from '@playwright/test';

export const SENHA = 'nerus2026';
/** Equipe de exemplo (SEED_DEMO): Helena (CEO) > Carlos (diretor) > Marina e Paulo (gestores) > João, Beatriz (da Marina) e Lucas (do Paulo). Renata é a administradora. */
export const EQUIPE = {
  renata: 'renata@nerus.com.br',
  helena: 'helena@nerus.com.br',
  carlos: 'carlos@nerus.com.br',
  marina: 'marina@nerus.com.br',
  paulo: 'paulo@nerus.com.br',
  joao: 'joao@nerus.com.br',
  beatriz: 'beatriz@nerus.com.br',
  lucas: 'lucas@nerus.com.br',
} as const;
export type Pessoa = keyof typeof EQUIPE;

/** Título único por execução, para os roteiros não se atrapalharem. */
export const unico = (t: string) => `${t} ${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 100)}`;

/** Todo roteiro falha se a página tiver erro de JavaScript ou se o servidor responder 500. */
export const test = base.extend<{ vigiar: void }>({
  vigiar: [async ({ page }, use) => {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(`erro na página: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 500) erros.push(`servidor respondeu ${r.status()} em ${r.url()}`); });
    await use();
    expect(erros, 'erros durante o roteiro').toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function entrar(page: Page, quem: Pessoa) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EQUIPE[quem]);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.topbar h1')).toBeVisible();
}

/** Abre uma janela separada (outra pessoa logada ao mesmo tempo). */
export async function outraPessoa(browser: Browser, quem: Pessoa, opts: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`erro na página de ${quem}: ${e.message}`); });
  await entrar(page, quem);
  return { page, fechar: () => ctx.close() };
}

export async function irPara(page: Page, menu: string) {
  const link = page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: new RegExp(`^${menu}(\\s*\\d+)?$`) });
  await link.click();
  await expect(page.locator('.topbar h1')).toHaveText(menu);
}

/** Cria uma tarefa na fase indicada do quadro aberto e devolve o código dela. */
export async function criarTarefa(page: Page, titulo: string, fase = 'A fazer') {
  const col = page.getByRole('region', { name: fase, exact: true });
  await col.getByRole('button', { name: 'Adicionar tarefa' }).click();
  await col.getByLabel('Título da nova tarefa').fill(titulo);
  await col.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const card = col.locator('article.kc', { hasText: titulo });
  await expect(card).toBeVisible();
  await col.getByRole('button', { name: 'Cancelar' }).click();
  return (await card.locator('.code').innerText()).trim();
}

export async function abrirTarefa(page: Page, codigo: string) {
  await page.goto(`/#/tarefa/${codigo}`);
  const dlg = page.getByRole('dialog', { name: `Tarefa ${codigo}` });
  await expect(dlg).toBeVisible();
  return dlg;
}

export function dialogo(page: Page, titulo: string) {
  return page.getByRole('dialog', { name: titulo });
}

export async function aviso(page: Page, texto: string | RegExp) {
  await expect(page.locator('.toast').filter({ hasText: texto })).toBeVisible();
}
