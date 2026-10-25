import { test, expect, entrar, criarTarefa, abrirTarefa, aviso, unico, dialogo } from './apoio';

test.describe('uso no celular', () => {
  test('as telas principais cabem na largura, sem rolar para o lado @celular', async ({ page, isMobile }) => {
    await entrar(page, 'marina');
    for (const rota of ['/painel', '/quadros', '/entrada', '/delegadas', '/avisos', '/ajuda']) {
      await page.goto(`/#${rota}`);
      await expect(page.locator('.topbar h1')).toBeVisible();
      const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sobra, `a tela ${rota} passou da largura`).toBeLessThanOrEqual(1);
      // A3 da revisão de UX: em tela com pouco conteúdo, a barra de cima não estica (antes ocupava 1/3 da tela).
      if (!isMobile) continue;
      const barra = await page.locator('.side').evaluate((el) => el.getBoundingClientRect().height);
      expect(barra, `a barra de cima de ${rota} esticou`).toBeLessThan(80);
    }
  });

  test('a página termina perto da fase visível, mesmo com outra fase comprida @celular', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'só no celular');
    await entrar(page, 'beatriz');
    // Enche a fase "Feito" (fora da tela, à direita) com muitas tarefas.
    const col = page.getByRole('region', { name: 'Feito', exact: true });
    await col.getByRole('button', { name: 'Adicionar tarefa' }).click();
    await col.getByLabel('Título da nova tarefa').fill(Array.from({ length: 30 }, (_, i) => unico(`Antiga ${i + 1}`)).join('\n'));
    await col.getByLabel('Título da nova tarefa').press('Enter');
    await dialogo(page, 'O texto tem 30 linhas').getByRole('button', { name: 'Criar 30 tarefas' }).click();
    await expect(page.locator('.toast', { hasText: '30 tarefas criadas.' })).toBeVisible();
    await page.keyboard.press('Escape');
    // Item 69: a fase longa rola por dentro; a página não fica com a altura dela.
    const fase = await col.evaluate((el) => el.getBoundingClientRect().height);
    const m = await page.evaluate(() => ({ pagina: document.documentElement.scrollHeight, tela: window.innerHeight }));
    expect(fase, 'a fase passou da altura da tela').toBeLessThanOrEqual(m.tela);
    expect(m.pagina, 'a página ficou muito mais comprida que a tela').toBeLessThan(m.tela * 1.6);
  });

  test('criar tarefa e mudar de fase pelo “Mover para” @celular', async ({ page }) => {
    await entrar(page, 'joao');
    const titulo = unico('Ligar para cliente');
    const codigo = await criarTarefa(page, titulo);
    const dlg = await abrirTarefa(page, codigo);
    await dlg.getByLabel('Fase').selectOption({ label: 'Fazendo' });
    await dlg.getByRole('button', { name: 'Mover', exact: true }).click();
    await aviso(page, 'Tarefa movida para “Fazendo”.');
    await dlg.getByRole('button', { name: 'Concluir' }).click();
    await aviso(page, 'Tarefa concluída.');
    await dlg.getByRole('button', { name: 'Fechar' }).click();
    await expect(page.getByRole('region', { name: 'Fazendo', exact: true }).locator('article.kc.done', { hasText: titulo })).toBeVisible();
  });
});
