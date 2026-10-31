import { test, expect, entrar, irPara, dialogo, unico, api, aviso, outraPessoa } from './apoio';

/** Item 50: na caixa de entrada, cada linha tem Aceitar, Delegar e Descartar, e dá para descartar várias de uma vez. */
test.describe('caixa de entrada: aceitar, delegar e descartar', () => {
  const capturar = (page: Parameters<typeof api>[0], titulo: string) =>
    api(page, 'POST', '/capture', { title: titulo, url: `https://exemplo.com/${encodeURIComponent(titulo)}` });

  test('descartar uma tarefa, desfazer, e descartar várias selecionadas; elas aparecem em Arquivadas', async ({ page }) => {
    await entrar(page, 'marina');
    const um = unico('Papel um');
    const dois = unico('Papel dois');
    const tres = unico('Papel três');
    for (const t of [um, dois, tres]) await capturar(page, t);
    await irPara(page, 'Caixa de entrada');

    const linha = (t: string) => page.locator('.row.inbox', { hasText: t });
    await expect(linha(um).getByRole('button', { name: 'Aceitar', exact: true })).toBeVisible();
    await expect(linha(um).getByRole('button', { name: 'Delegar', exact: true })).toBeVisible();

    // Uma só, pelo botão da linha, com Desfazer.
    await linha(um).getByRole('button', { name: 'Descartar', exact: true }).click();
    await aviso(page, 'Tarefa descartada.');
    await expect(linha(um)).toHaveCount(0);
    await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click();
    await aviso(page, 'A tarefa voltou para a caixa de entrada.');
    await expect(linha(um)).toBeVisible();

    // Várias, pelas caixinhas.
    await linha(dois).getByRole('checkbox').check();
    await linha(tres).getByRole('checkbox').check();
    await expect(page.locator('.inbox-bar')).toContainText('2 selecionadas');
    await page.getByRole('button', { name: 'Descartar selecionadas' }).click(); // item 58: sem confirmação, com Desfazer
    await aviso(page, '2 tarefas descartadas.');
    await expect(linha(dois)).toHaveCount(0);
    await expect(linha(tres)).toHaveCount(0);

    // Em Arquivadas, com a etiqueta "Descartada"; Desarquivar devolve à caixa de entrada.
    await irPara(page, 'Arquivadas');
    const arq = page.locator('table.arch tr', { hasText: dois });
    await expect(arq.locator('.tag', { hasText: 'Descartada' })).toBeVisible();
    await expect(arq).toContainText('Caixa de entrada');
    await arq.getByRole('button', { name: 'Desarquivar' }).click();
    await aviso(page, 'Tarefa desarquivada: de volta à caixa de entrada.');
    await irPara(page, 'Caixa de entrada');
    await expect(linha(dois)).toBeVisible();
    await expect(linha(tres)).toHaveCount(0);
  });

  test('delegar direto da caixa de entrada: escolhe o quadro e a pessoa numa janela só', async ({ page, browser }) => {
    await entrar(page, 'marina');
    const titulo = unico('Repassar da caixa');
    await capturar(page, titulo);
    await irPara(page, 'Caixa de entrada');
    await page.locator('.row.inbox', { hasText: titulo }).getByRole('button', { name: 'Delegar', exact: true }).click();
    const d = dialogo(page, 'Delegar tarefa');
    await expect(d.getByLabel('Quadro')).toBeVisible();
    await expect(d.getByLabel('Fase')).toBeVisible();
    const para = d.getByLabel('Para (subordinado direto)');
    await para.selectOption((await para.locator('option', { hasText: 'João' }).getAttribute('value'))!);
    await d.getByRole('button', { name: 'Delegar', exact: true }).click();
    await aviso(page, /delegada para João/);
    await expect(page.locator('.row.inbox', { hasText: titulo })).toHaveCount(0);
    await irPara(page, 'Tarefas');
    await expect(page.locator('article.kc', { hasText: titulo })).toBeVisible();

    const joao = await outraPessoa(browser, 'joao');
    try {
      await irPara(joao.page, 'Caixa de entrada');
      const row = joao.page.locator('.row.inbox', { hasText: titulo });
      await expect(row).toContainText('Marina');
      // Recebida por delegação: não se descarta, devolve-se.
      await expect(row.getByRole('button', { name: 'Descartar', exact: true })).toHaveCount(0);
      await expect(row.getByRole('button', { name: 'Devolver' })).toBeVisible();
    } finally {
      await joao.fechar();
    }
  });

  test('aceitar com um clique repete o último quadro e fase; a setinha deixa escolher outro', async ({ page }) => {
    await entrar(page, 'beatriz');
    const um = unico('Aceite um');
    const dois = unico('Aceite dois');
    for (const t of [um, dois]) await capturar(page, t);
    await irPara(page, 'Caixa de entrada');
    const linha = (t: string) => page.locator('.row.inbox', { hasText: t });

    // Primeira vez: o Aceitar pergunta o lugar.
    await linha(um).getByRole('button', { name: 'Aceitar', exact: true }).click();
    const dlg = dialogo(page, 'Aceitar e organizar');
    await dlg.getByLabel('Fase').selectOption({ label: 'Fazendo' });
    await dlg.getByRole('button', { name: 'Aceitar' }).click();
    await expect(linha(um)).toHaveCount(0);

    // Depois: um clique, mesmo lugar, sem janela; o aviso diz onde e abre a tarefa.
    await linha(dois).getByRole('button', { name: 'Aceitar', exact: true }).click();
    await expect(linha(dois)).toHaveCount(0);
    await expect(dlg).toHaveCount(0);
    await aviso(page, /Tarefa aceita em “.+ · Fazendo”\./);
    await page.locator('.toast').getByRole('button', { name: 'Abrir' }).click();
    await expect(page.getByRole('dialog', { name: /^Tarefa #\d+$/ }).getByLabel('Título', { exact: true })).toHaveValue(dois);
    await page.keyboard.press('Escape');
    await irPara(page, 'Tarefas');
    await expect(page.getByRole('region', { name: 'Fazendo', exact: true }).locator('article.kc', { hasText: dois })).toBeVisible();
  });
});
