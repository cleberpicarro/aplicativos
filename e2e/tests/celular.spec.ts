import { test, expect, entrar, criarTarefa, abrirTarefa, aviso, unico } from './apoio';

test.describe('uso no celular', () => {
  test('as telas principais cabem na largura, sem rolar para o lado @celular', async ({ page }) => {
    await entrar(page, 'marina');
    for (const rota of ['/painel', '/quadros', '/entrada', '/delegadas', '/avisos', '/ajuda']) {
      await page.goto(`/#${rota}`);
      await expect(page.locator('.topbar h1')).toBeVisible();
      const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sobra, `a tela ${rota} passou da largura`).toBeLessThanOrEqual(1);
    }
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
