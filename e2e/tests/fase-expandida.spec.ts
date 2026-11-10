import { test, expect, entrar, abrirTarefa, aviso, unico, api, dialogo } from './apoio';
import type { Page } from '@playwright/test';

/** Item 85: fase expandida (lista em tela cheia), prioridade, ações em massa, recolher e limite. */

async function quadroCom(page: Page, titulos: string[]) {
  const nome = unico('Fase longa');
  const b = await api(page, 'POST', '/boards', { name: nome });
  const board = await api(page, 'GET', `/boards/${b.id}`);
  await api(page, 'POST', '/cards/batch', { listId: board.lists[0].id, titles: titulos });
  await page.reload();
  await page.getByRole('tab', { name: nome }).click();
  await expect(page.getByRole('region', { name: 'A fazer', exact: true }).locator('article.kc')).toHaveCount(titulos.length);
  return nome;
}
const titulosDaLista = (page: Page) => page.locator('table.phase tbody td.c-title');

test.describe('fase expandida (item 85)', () => {
  test('expandir, mudar a prioridade, mexer em várias de uma vez e voltar ao quadro', async ({ page, isMobile }) => {
    test.skip(isMobile, 'só no computador');
    await entrar(page, 'lucas');
    await quadroCom(page, ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco']);

    await page.getByRole('button', { name: 'Opções da fase A fazer' }).click();
    await page.getByRole('menuitem', { name: 'Expandir fase' }).click();
    await expect(page).toHaveURL(/fase=/);
    await expect(titulosDaLista(page)).toHaveText(['Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco']);
    await expect(page.locator('table.phase tbody .prio')).toHaveText(['1º', '2º', '3º', '4º', '5º']);

    // Digitar a posição: Delta vira a 1ª.
    await page.getByRole('button', { name: /Prioridade 4ª de 5/ }).click();
    await page.getByLabel('Nova posição na fase').fill('1');
    await page.getByLabel('Nova posição na fase').press('Enter');
    await aviso(page, 'Tarefa agora é a 1ª da fase.');
    await expect(titulosDaLista(page)).toHaveText(['Delta', 'Alfa', 'Bravo', 'Charlie', 'Eco']);

    // F5 mantém a fase expandida.
    await page.reload();
    await expect(titulosDaLista(page)).toHaveText(['Delta', 'Alfa', 'Bravo', 'Charlie', 'Eco']);

    // Busca e atalhos só nesta fase.
    await page.getByLabel('Buscar nesta fase').fill('char');
    await expect(titulosDaLista(page)).toHaveText(['Charlie']);
    await page.getByLabel('Buscar nesta fase').fill('');
    await expect(page.getByRole('button', { name: /^Sem prazo/ })).toContainText('5');

    // Marcar duas e mandar para o fim; Desfazer volta como estava.
    await page.getByLabel('Marcar Delta').check();
    await page.getByLabel('Marcar Alfa').check();
    await expect(page.getByRole('toolbar', { name: 'Ações nas tarefas marcadas' })).toContainText('2 marcadas');
    await page.getByRole('toolbar').getByRole('button', { name: 'Para o fim' }).click();
    await expect(titulosDaLista(page)).toHaveText(['Bravo', 'Charlie', 'Eco', 'Delta', 'Alfa']);
    await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click();
    await expect(titulosDaLista(page)).toHaveText(['Delta', 'Alfa', 'Bravo', 'Charlie', 'Eco']);

    // Mover as marcadas para outra fase.
    await page.getByRole('toolbar').getByRole('button', { name: 'Mover para…' }).click();
    await page.locator('.bulk-pop').getByRole('button', { name: 'Fazendo' }).click();
    await aviso(page, '2 tarefas movidas para “Fazendo”.');
    await expect(titulosDaLista(page)).toHaveText(['Bravo', 'Charlie', 'Eco']);
    await expect(page.getByRole('toolbar', { name: 'Ações nas tarefas marcadas' })).toHaveCount(0);

    // Ordenar por título é só para olhar; "Aplicar esta ordem no quadro" grava.
    const porTitulo = page.locator('table.phase thead').getByRole('button', { name: 'Tarefa', exact: true });
    await porTitulo.click();
    await expect(titulosDaLista(page)).toHaveText(['Bravo', 'Charlie', 'Eco']);
    await porTitulo.click();
    await expect(titulosDaLista(page)).toHaveText(['Eco', 'Charlie', 'Bravo']);
    await page.getByRole('button', { name: 'Aplicar esta ordem no quadro' }).click();
    await expect(page.locator('table.phase tbody .prio')).toHaveText(['1º', '2º', '3º']);
    await expect(titulosDaLista(page)).toHaveText(['Eco', 'Charlie', 'Bravo']);

    // Esc volta ao quadro, que já está na nova ordem.
    await page.locator('table.phase').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('Escape');
    await expect(page.locator('table.phase')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'A fazer', exact: true }).locator('article.kc .t')).toHaveText(['Eco', 'Charlie', 'Bravo']);
  });

  test('campo Prioridade na tarefa aberta, fase recolhida e limite de tarefas', async ({ page, isMobile }) => {
    test.skip(isMobile, 'só no computador');
    await entrar(page, 'lucas');
    await quadroCom(page, ['Um', 'Dois', 'Três']);
    const id = await page.getByRole('region', { name: 'A fazer', exact: true }).locator('article.kc', { hasText: 'Três' }).getAttribute('data-id');
    const dlg = await abrirTarefa(page, id!);
    await expect(dlg.getByText('Prioridade em “A fazer”')).toBeVisible();
    await expect(dlg.getByLabel('Prioridade (1 é a mais importante)')).toHaveValue('3');
    await dlg.getByLabel('Prioridade (1 é a mais importante)').fill('1');
    await dlg.getByLabel('Prioridade (1 é a mais importante)').press('Enter');
    await aviso(page, 'Prioridade: 1ª de 3 em “A fazer”.');
    await dlg.getByRole('button', { name: 'Fechar' }).click();
    await expect(page.getByRole('region', { name: 'A fazer', exact: true }).locator('article.kc .t')).toHaveText(['Três', 'Um', 'Dois']);

    // Recolher a fase Feito: vira uma faixa; fica gravado.
    await page.getByRole('button', { name: 'Opções da fase Feito' }).click();
    await page.getByRole('menuitem', { name: 'Recolher fase' }).click();
    await expect(page.locator('.col.folded')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.col.folded')).toHaveCount(1);
    await page.getByRole('button', { name: 'Abrir a fase Feito' }).click();
    await expect(page.locator('.col.folded')).toHaveCount(0);

    // Limite: acima dele o contador fica laranja.
    await page.getByRole('button', { name: 'Opções da fase A fazer' }).click();
    await page.getByRole('menuitem', { name: 'Limite de tarefas…' }).click();
    await dialogo(page, 'Limite de tarefas').getByLabel('No máximo').fill('2');
    await dialogo(page, 'Limite de tarefas').getByRole('button', { name: 'Salvar' }).click();
    await aviso(page, 'Limite da fase “A fazer”: 2 tarefas.');
    await expect(page.getByRole('region', { name: 'A fazer', exact: true }).locator('.col-h .n')).toHaveClass(/over/);
  });

  test('no celular, a fase não expande nem recolhe @celular', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'só no celular');
    await entrar(page, 'lucas');
    await page.getByRole('button', { name: 'Opções da fase A fazer' }).first().click();
    await expect(page.getByRole('menuitem', { name: 'Ordenar por nome (A–Z)' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Expandir fase' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Recolher fase' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Expandir a fase/ })).toHaveCount(0);
  });
});

test.describe('cor da fase (item 87)', () => {
  test('escolher a cor pinta a faixa do topo, fica gravada e sai com “Sem cor” @celular', async ({ page, isMobile }) => {
    await entrar(page, 'lucas');
    await quadroCom(page, ['Uma']);
    const fase = page.getByRole('region', { name: 'A fazer', exact: true }).first();
    await expect(fase.locator('.col-h')).not.toHaveClass(/phase-tone/);
    await page.getByRole('button', { name: 'Opções da fase A fazer' }).first().click();
    await page.getByRole('menuitem', { name: 'Cor da fase…' }).click();
    await dialogo(page, 'Cor da fase').getByRole('radio', { name: 'Verde' }).click();
    await aviso(page, 'Fase “A fazer” agora é verde.');
    await expect(fase.locator('.col-h')).toHaveClass(/phase-tone bc-verde/);
    // Só a faixa: os cartões continuam como estavam.
    await expect(fase.locator('article.kc').first()).not.toHaveClass(/painted/);
    await page.reload();
    await expect(page.getByRole('region', { name: 'A fazer', exact: true }).first().locator('.col-h')).toHaveClass(/bc-verde/);
    if (!isMobile) {
      // A fase recolhida e a expandida mostram a mesma cor.
      await page.getByRole('button', { name: 'Opções da fase A fazer' }).click();
      await page.getByRole('menuitem', { name: 'Recolher fase' }).click();
      await expect(page.locator('.col.folded .fold-open')).toHaveClass(/bc-verde/);
      await page.getByRole('button', { name: 'Abrir a fase A fazer' }).click();
      await page.getByRole('button', { name: 'Expandir a fase A fazer' }).click();
      await expect(page.locator('.ph-title .ph-tone')).toHaveClass(/bc-verde/);
      await page.getByRole('button', { name: /Voltar ao quadro/ }).click();
    }
    await page.getByRole('button', { name: 'Opções da fase A fazer' }).first().click();
    await page.getByRole('menuitem', { name: 'Cor da fase…' }).click();
    await dialogo(page, 'Cor da fase').getByRole('radio', { name: 'Sem cor' }).click();
    await aviso(page, 'A fase “A fazer” ficou sem cor.');
    await expect(page.getByRole('region', { name: 'A fazer', exact: true }).first().locator('.col-h')).not.toHaveClass(/phase-tone/);
  });
});

