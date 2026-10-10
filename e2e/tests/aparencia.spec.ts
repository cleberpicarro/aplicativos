import { test, expect, entrar, irPara, dialogo, unico } from './apoio';

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
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Mover quadro para a esquerda' }).click();
    await expect(page.getByRole('tab').first()).toHaveText(nome);
    await page.reload();
    await expect(page.getByRole('tab').first()).toHaveText(nome);
  });

  test('ajuda e legenda abrem sem erro @celular', async ({ page }) => {
    await entrar(page, 'joao');
    await page.getByRole('button', { name: 'Legenda' }).click();
    await expect(dialogo(page, 'Legenda')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Ajuda' }).click();
    await expect(page.locator('.topbar h1')).toHaveText('Ajuda');
  });
});
