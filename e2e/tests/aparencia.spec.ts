import { test, expect, entrar, irPara, abrirMenu, dialogo, aviso, unico } from './apoio';

test.describe('aparência e preferências', () => {
  test('tema escuro, tamanho do texto e barra lateral ficam lembrados', async ({ page }) => {
    await entrar(page, 'beatriz');
    const html = page.locator('html');
    const tema = page.locator('.topbar .tools > button.b.icon');
    await tema.click(); // automático → claro
    await expect(html).toHaveAttribute('data-theme', 'light');
    await tema.click(); // claro → escuro
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const antes = await html.evaluate((el) => getComputedStyle(el).getPropertyValue('--fs'));
    await page.getByRole('button', { name: 'Aumentar texto' }).click();
    await expect.poll(() => html.evaluate((el) => getComputedStyle(el).getPropertyValue('--fs'))).not.toBe(antes);
    await page.getByRole('button', { name: 'Recolher menu' }).first().click();
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
  });

  test('cor do quadro e fundo da área de trabalho ficam na conta', async ({ page, browser }) => {
    await entrar(page, 'lucas');
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Cor do quadro' }).click();
    await dialogo(page, 'Cor do quadro').getByRole('radio', { name: 'Verde' }).click();
    await expect(page.locator('.board-area')).toHaveClass(/bc-verde/);
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Fundo da área de trabalho' }).click();
    await dialogo(page, 'Fundo da área de trabalho').getByRole('radio', { name: 'Areia' }).click();
    await expect(page.locator('main')).toHaveClass(/ws-areia/);

    // em outro navegador (outro computador), as escolhas continuam
    const ctx = await browser.newContext();
    const outro = await ctx.newPage();
    await entrar(outro, 'lucas');
    await expect(outro.locator('main')).toHaveClass(/ws-areia/);
    await expect(outro.locator('.board-area')).toHaveClass(/bc-verde/);
    await ctx.close();
  });

  test('mudar a ordem dos quadros pelo menu', async ({ page }) => {
    await entrar(page, 'paulo');
    await irPara(page, 'Tarefas');
    const nome = unico('Segundo');
    await page.getByRole('button', { name: 'Quadro', exact: true }).click();
    await dialogo(page, 'Novo quadro').getByLabel('Nome do quadro').fill(nome);
    await dialogo(page, 'Novo quadro').getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('tab', { name: nome })).toHaveAttribute('aria-selected', 'true');
    // Compara com a posição de antes (numa nova tentativa já existe outro quadro "Segundo") e espera o servidor
    // gravar antes de recarregar a página.
    const antes = (await page.getByRole('tab').allTextContents()).indexOf(nome);
    expect(antes).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    const gravou = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/boards\//.test(r.url()));
    await page.getByRole('menuitem', { name: 'Mover quadro para a esquerda' }).click();
    expect((await gravou).ok()).toBe(true);
    await expect(page.getByRole('tab').nth(antes - 1)).toHaveText(nome);
    await page.reload();
    await expect(page.getByRole('tab').nth(antes - 1)).toHaveText(nome);
  });

  test('ajuda e legenda abrem sem erro @celular', async ({ page }) => {
    await entrar(page, 'joao');
    await abrirMenu(page);
    await page.getByRole('button', { name: 'Legenda' }).click();
    await expect(dialogo(page, 'Legenda')).toBeVisible();
    await page.keyboard.press('Escape');
    await abrirMenu(page);
    await page.getByRole('button', { name: 'Ajuda' }).click();
    await expect(page.locator('.topbar h1')).toHaveText('Ajuda');
  });
  test('Meus dados: desligar e religar o resumo diário e os avisos de prazo por e-mail (item 46) @celular', async ({ page }) => {
    await entrar(page, 'beatriz');
    await abrirMenu(page);
    await page.getByRole('button', { name: 'Meus dados' }).last().click();
    const dlg = dialogo(page, 'Meus dados');
    await expect(dlg.getByText('beatriz@nerus.com.br')).toBeVisible();
    const resumo = dlg.getByLabel(/Receber resumo diário por e-mail/);
    const prazo = dlg.getByLabel(/Receber avisos de prazo por e-mail/);
    await expect(resumo).toBeChecked();
    await expect(prazo).toBeChecked();
    await resumo.click();
    await aviso(page, 'Resumo diário desligado.');
    await expect(resumo).not.toBeChecked();
    await page.reload();
    await abrirMenu(page);
    await page.getByRole('button', { name: 'Meus dados' }).last().click();
    await expect(dialogo(page, 'Meus dados').getByLabel(/Receber resumo diário/)).not.toBeChecked();
    await expect(dialogo(page, 'Meus dados').getByLabel(/Receber avisos de prazo/)).toBeChecked();
    await dialogo(page, 'Meus dados').getByLabel(/Receber resumo diário/).click();
    await aviso(page, 'Resumo diário ligado.');
  });
});
