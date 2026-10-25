import { test, expect, entrar, criarTarefa, abrirTarefa, aviso, unico } from './apoio';

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

  test('menu de 3 barrinhas: abre grande, fecha com Voltar e ao escolher uma tela (item 68) @celular', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'só no celular');
    await entrar(page, 'marina');
    const menu = page.getByRole('navigation', { name: 'Principal' });
    // Fechado: só o ☰ e o logo; as telas do menu ficam escondidas.
    await expect(menu).toBeHidden();
    const abrir = page.getByRole('button', { name: /^Abrir menu/ });
    await abrir.click();
    await expect(menu).toBeVisible();
    // Opções grandes para o dedo (pelo menos 44 pixels de altura) e a tela atual marcada.
    const altura = await menu.getByRole('link', { name: /^Tarefas$/ }).evaluate((el) => el.getBoundingClientRect().height);
    expect(altura).toBeGreaterThanOrEqual(44);
    await expect(menu.getByRole('link', { name: /^Tarefas$/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Meus dados' }).last()).toBeVisible();
    // O botão Voltar do celular fecha o menu sem sair da tela.
    await page.goBack();
    await expect(menu).toBeHidden();
    await expect(page.locator('.topbar h1')).toHaveText('Tarefas');
    // Escolher uma tela fecha o menu; Voltar depois disso volta para a tela anterior.
    await abrir.click();
    await menu.getByRole('link', { name: /^Caixa de entrada/ }).click();
    await expect(page.locator('.topbar h1')).toHaveText('Caixa de entrada');
    await expect(menu).toBeHidden();
    await page.goBack();
    await expect(page.locator('.topbar h1')).toHaveText('Tarefas');
    // Fechar no X e tocando no fundo escuro.
    await abrir.click();
    await page.getByRole('button', { name: 'Fechar menu' }).click();
    await expect(menu).toBeHidden();
    await abrir.click();
    await page.locator('.menu-scrim').click({ position: { x: 400, y: 400 } });
    await expect(menu).toBeHidden();
    await expect(page.locator('.topbar h1')).toHaveText('Tarefas');
  });
});
