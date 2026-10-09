import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, entrar, outraPessoa, irPara, criarTarefa, dialogo, aviso, unico, api, numeroDe } from './apoio';
const idDe = async (page: Page, codigo: string) => (await api(page, 'GET', `/cards/by-code/${codigo}`)).card.id as string;

function ontem() {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

test.describe('arquivadas (item 35)', () => {
  test('ver, pesquisar por código e texto, desarquivar; a delegada com ciente aparece marcada e só para consulta', async ({ page, browser }) => {
    await entrar(page, 'paulo');
    await irPara(page, 'Tarefas');
    const propria = unico('Planilha de custos');
    const codigo = await criarTarefa(page, propria);
    const numero = await numeroDe(page, codigo);
    const card = page.locator('article.kc', { hasText: propria });
    await card.getByRole('button', { name: `Concluir ${propria}` }).click();
    await card.getByRole('button', { name: `Arquivar ${propria}` }).click();
    await expect(card).toHaveCount(0);

    // Paulo delega para Lucas, que conclui; Paulo dá o ciente (arquiva).
    const delegada = unico('Levantamento de preços');
    const origem = await criarTarefa(page, delegada);
    const lucasId = (await api(page, 'GET', '/me')).directReports.find((p: any) => /Lucas/.test(p.name)).id;
    const d = await api(page, 'POST', `/cards/${await idDe(page, origem)}/delegate`, { toUserId: lucasId });
    const lucas = await outraPessoa(browser, 'lucas');
    try {
      const boards = await api(lucas.page, 'GET', '/boards');
      const lista = (await api(lucas.page, 'GET', `/boards/${boards[0].id}`)).lists[0].id;
      await api(lucas.page, 'POST', `/cards/${d.cardId}/accept`, { listId: lista });
      await api(lucas.page, 'POST', `/cards/${d.cardId}/complete`);
    } finally {
      await lucas.fechar();
    }
    await api(page, 'POST', `/delegations/${d.delegationId}/ack`);

    await irPara(page, 'Arquivadas');
    const linha = page.locator('table.arch tbody tr', { hasText: propria });
    await expect(linha).toBeVisible();
    await expect(linha.getByRole('button', { name: 'Desarquivar' })).toBeVisible();
    const linhaDelegada = page.locator('table.arch tbody tr', { hasText: delegada });
    await expect(linhaDelegada.locator('.tag')).toHaveText('Delegada para Lucas Prado');
    await expect(linhaDelegada.getByRole('button', { name: 'Desarquivar' })).toHaveCount(0);
    await expect(linhaDelegada).toContainText('Só consulta');

    const pesquisa = page.getByLabel('Pesquisar nas arquivadas');
    await expect(linha.locator('td.code')).toHaveText(numero);
    await pesquisa.fill(numero);
    await expect(page.locator('table.arch tbody tr')).toHaveCount(1);
    await expect(linha).toBeVisible();
    await pesquisa.fill(delegada.split(' ').slice(0, 2).join(' '));
    await expect(linhaDelegada).toBeVisible();
    await pesquisa.fill('palavra-que-não-existe-em-nada');
    await expect(page.getByText('Nada encontrado.')).toBeVisible();
    await pesquisa.fill('');

    await linha.getByRole('button', { name: 'Desarquivar' }).click();
    await aviso(page, /Tarefa desarquivada/);
    await expect(linha).toHaveCount(0);
    await irPara(page, 'Tarefas');
    await expect(page.locator('article.kc', { hasText: propria })).toBeVisible();
  });
});

test.describe('tarefas em tabela (item 36)', () => {
  test('trocar para tabela, filtro pronto, filtro novo salvo, tirar condição, colunas e planilha', async ({ page }) => {
    await entrar(page, 'beatriz');
    await irPara(page, 'Tarefas');
    const atrasada = unico('Pagar fornecedor');
    const outra = unico('Revisar contrato');
    const cod = await criarTarefa(page, atrasada);
    await criarTarefa(page, outra);
    await api(page, 'PATCH', `/cards/${await idDe(page, cod)}`, { dueDate: ontem() });

    await page.getByRole('button', { name: 'Ver em tabela' }).click();
    const tabela = page.locator('table.tasks');
    await expect(tabela.locator('tbody tr', { hasText: atrasada })).toBeVisible();
    await expect(tabela.locator('tbody tr', { hasText: outra })).toBeVisible();
    await expect(tabela.locator('tbody tr', { hasText: atrasada }).locator('.due')).toHaveClass(/late/);

    // Filtro pronto
    await page.getByRole('button', { name: /^Filtro:/ }).click();
    await page.getByRole('menuitemradio', { name: 'Atrasadas' }).click();
    await expect(tabela.locator('tbody tr', { hasText: atrasada })).toBeVisible();
    await expect(tabela.locator('tbody tr', { hasText: outra })).toHaveCount(0);
    await expect(page.locator('.chip')).toHaveText(['Situação é Aberta', 'Prazo antes de hoje']);

    // Filtro novo, salvo com nome
    await page.getByRole('button', { name: /^Filtro:/ }).click();
    await page.getByRole('menuitem', { name: 'Novo filtro' }).click();
    const dlg = dialogo(page, 'Filtro');
    await dlg.getByLabel('Valor').fill(outra);
    const nome = unico('Contratos');
    await dlg.getByLabel(/Nome do filtro/).fill(nome);
    await dlg.getByRole('button', { name: 'Salvar filtro' }).click();
    await aviso(page, `Filtro “${nome}” salvo.`);
    await expect(page.getByRole('button', { name: `Filtro: ${nome}` })).toBeVisible();
    await expect(tabela.locator('tbody tr')).toHaveCount(1);
    await expect(tabela.locator('tbody tr', { hasText: outra })).toBeVisible();

    // O × tira a condição na hora
    await page.locator('.chip').getByRole('button', { name: 'Tirar esta condição' }).click();
    await expect(tabela.locator('tbody tr', { hasText: atrasada })).toBeVisible();

    // O filtro salvo continua na lista
    await page.getByRole('button', { name: /^Filtro:/ }).click();
    await page.getByRole('menuitemradio', { name: nome }).click();
    await expect(tabela.locator('tbody tr')).toHaveCount(1);

    // Colunas: mostrar "Origem"
    await page.getByRole('button', { name: 'Colunas' }).click();
    await dialogo(page, 'Colunas').getByLabel('Origem').check();
    await dialogo(page, 'Colunas').getByRole('button', { name: 'Pronto' }).click();
    await expect(tabela.locator('th', { hasText: 'Origem' })).toBeVisible();

    // Planilha
    const [baixado] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar planilha' }).click()]);
    const csv = fs.readFileSync(await baixado.path(), 'utf8');
    expect(csv).toContain('Código;Tarefa;Quadro · Fase;Prazo;Situação;Delegação;Checklist;Criada em;Origem');
    expect(csv).toContain(outra);

    // Clicar na linha abre a tarefa; a visão em tabela fica lembrada
    await tabela.locator('tbody tr', { hasText: outra }).locator('td.c-where').click();
    await expect(page.getByRole('dialog', { name: /^Tarefa #\d+$/ })).toBeVisible();
    await page.getByRole('dialog', { name: /^Tarefa #\d+$/ }).getByRole('button', { name: 'Fechar' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Ver em tabela' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: `Filtro: ${nome}` })).toBeVisible();
  });

  test('a tabela no celular rola para o lado @celular', async ({ page }) => {
    await entrar(page, 'joao');
    await irPara(page, 'Tarefas');
    await criarTarefa(page, unico('Tarefa do celular'));
    await page.getByRole('button', { name: 'Ver em tabela' }).click();
    const wrap = page.locator('.table-wrap');
    await expect(wrap.locator('table.tasks')).toBeVisible();
    const larguraPagina = await page.evaluate(() => document.documentElement.scrollWidth);
    const larguraTela = await page.evaluate(() => window.innerWidth);
    expect(larguraPagina).toBeLessThanOrEqual(larguraTela + 1);
  });
});
