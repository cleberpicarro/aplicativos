import { test, expect, entrar, outraPessoa, irPara, criarTarefa, abrirTarefa, dialogo, unico, api, numeroDe } from './apoio';

test.describe('transferir e buscar', () => {
  test('transferir para colega: sai de quem transferiu e chega na caixa de entrada do colega, com o número da caixa de entrada dela', async ({ page, browser }) => {
    await entrar(page, 'joao');
    const titulo = unico('Atualizar planilha');
    const codigo = await criarTarefa(page, titulo);
    const dlg = await abrirTarefa(page, codigo);
    await dlg.getByRole('button', { name: 'Transferir' }).click();
    const t = dialogo(page, 'Transferir tarefa');
    const opcoes = await t.locator('select option').allInnerTexts();
    expect(opcoes.some((o) => o.includes('Beatriz'))).toBe(true); // colega
    expect(opcoes.some((o) => o.includes('Marina'))).toBe(true); // superior direto
    expect(opcoes.some((o) => o.includes('Lucas'))).toBe(false); // de outra equipe
    await t.locator('select').selectOption({ label: opcoes.find((o) => o.includes('Beatriz'))! });
    await t.getByRole('button', { name: 'Transferir' }).click();
    await expect(page.locator('article.kc', { hasText: titulo })).toHaveCount(0);

    const beatriz = await outraPessoa(browser, 'beatriz');
    try {
      await irPara(beatriz.page, 'Caixa de entrada');
      const row = beatriz.page.locator('.row.inbox', { hasText: titulo });
      await expect(row.locator('.code')).toHaveText(await numeroDe(beatriz.page, codigo));
      await expect(row.getByText('João Alves')).toBeVisible();
      await expect(row.getByRole('button', { name: 'Devolver' })).toHaveCount(0); // transferida não se devolve
    } finally {
      await beatriz.fechar();
    }
  });

  test('buscar pelo número (com ou sem #), pelo código antigo ST- e por texto @celular', async ({ page }) => {
    await entrar(page, 'lucas');
    await irPara(page, 'Tarefas').catch(() => undefined);
    const titulo = unico('Pedido de compra');
    const codigo = await criarTarefa(page, titulo);
    const numero = await numeroDe(page, codigo);
    const antigo = (await api(page, 'GET', `/cards/${codigo}`)).card.code as string;
    const busca = page.getByLabel('Buscar tarefa ou número');
    for (const termo of [numero, numero.slice(1), antigo]) {
      await busca.fill(termo);
      await expect(page.locator('.search-pop button', { hasText: titulo })).toBeVisible();
      await expect(page.locator('.search-pop button', { hasText: titulo }).locator('.code')).toContainText(numero);
    }
    await busca.fill(titulo.split(' ').slice(-1)[0]);
    await page.locator('.search-pop button', { hasText: titulo }).click();
    await expect(page.getByRole('dialog', { name: `Tarefa ${numero}` })).toBeVisible();
  });
});
