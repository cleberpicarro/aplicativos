import { test, expect, entrar, outraPessoa, irPara, criarTarefa, abrirTarefa, dialogo, aviso, unico } from './apoio';
import type { Page } from '@playwright/test';

async function delegar(page: Page, codigo: string, para: RegExp, obs?: string) {
  const dlg = await abrirTarefa(page, codigo);
  await dlg.getByRole('button', { name: 'Delegar' }).click();
  const d = dialogo(page, 'Delegar tarefa');
  await d.getByLabel('Para (subordinado direto)').selectOption({ label: (await d.locator('#d-to option').allInnerTexts()).find((t) => para.test(t))! });
  if (obs) await d.getByLabel('Observação (opcional)').fill(obs);
  await d.getByRole('button', { name: 'Delegar' }).click();
  await expect(d).toHaveCount(0);
  await expect(dlg.locator('.box', { hasText: 'Repassada para' })).toBeVisible();
  const filho = (await dlg.locator('.box .code').innerText()).trim();
  await dlg.getByRole('button', { name: 'Fechar' }).click();
  return filho;
}

async function aceitarDaCaixa(page: Page, titulo: string) {
  await irPara(page, 'Caixa de entrada');
  const row = page.locator('.row.inbox', { hasText: titulo });
  await row.getByRole('button', { name: 'Aceitar e organizar' }).click();
  await dialogo(page, 'Aceitar e organizar').getByRole('button', { name: 'Aceitar' }).click();
  await expect(row).toHaveCount(0);
}

async function concluir(page: Page, codigo: string) {
  const dlg = await abrirTarefa(page, codigo);
  await dlg.getByRole('button', { name: 'Concluir' }).click();
  await aviso(page, /foi avisado\(a\) para dar o ciente/);
  await dlg.getByRole('button', { name: 'Fechar' }).click();
}

test.describe('delegação de ponta a ponta', () => {
  test('diretor → gestora → funcionário, com reabertura e ciente, três pessoas logadas ao mesmo tempo', async ({ page, browser }) => {
    const titulo = unico('Orçamento de marketing');
    // Carlos (diretor) cria e delega para Marina
    await entrar(page, 'carlos');
    await irPara(page, 'Meus quadros');
    const origem = await criarTarefa(page, titulo);
    const paraMarina = await delegar(page, origem, /Marina/, 'Preciso até sexta');

    const marina = await outraPessoa(browser, 'marina');
    const joao = await outraPessoa(browser, 'joao');
    try {
      // Marina vê o aviso, aceita e repassa para João
      await expect(marina.page.getByRole('link', { name: /Caixa de entrada/ }).locator('.n')).not.toHaveText('0');
      await aceitarDaCaixa(marina.page, titulo);
      const dlgM = await abrirTarefa(marina.page, paraMarina);
      await expect(dlgM.locator('.cmt p')).toHaveText(['Preciso até sexta']);
      await expect(dlgM.getByText(`Desdobramento de ${origem}`)).toBeVisible();
      await dlgM.getByRole('button', { name: 'Fechar' }).click();
      const paraJoao = await delegar(marina.page, paraMarina, /João/);

      // João aceita e conclui
      await aceitarDaCaixa(joao.page, titulo);
      await concluir(joao.page, paraJoao);

      // Marina reabre com comentário
      await irPara(marina.page, 'Tarefas delegadas');
      const precisa = marina.page.locator('section[aria-labelledby="h-need"]');
      await expect(precisa.getByText(titulo)).toBeVisible();
      await precisa.locator('.row', { hasText: titulo }).getByRole('button', { name: 'Reabrir' }).click();
      const ro = dialogo(marina.page, 'Reabrir tarefa');
      await ro.getByRole('textbox').fill('Faltou a parte de eventos');
      await ro.getByRole('button', { name: 'Reabrir e devolver' }).click();
      await expect(precisa.getByText(titulo)).toHaveCount(0);

      // João vê a reabertura (ao voltar para a janela), conclui de novo; Marina dá ciente
      await joao.page.reload();
      const dlgJ = await abrirTarefa(joao.page, paraJoao);
      await expect(dlgJ.locator('.cmt p').last()).toHaveText('Faltou a parte de eventos');
      await dlgJ.getByRole('button', { name: 'Fechar' }).click();
      await concluir(joao.page, paraJoao);
      await marina.page.reload();
      await precisa.locator('.row', { hasText: titulo }).getByRole('button', { name: 'Dar ciente' }).click();
      await aviso(marina.page, 'Ciente dado. Tarefa arquivada.');

      // Marina conclui a dela; Carlos dá ciente pela tarefa
      await concluir(marina.page, paraMarina);
      await page.reload();
      const dlgC = await abrirTarefa(page, paraMarina);
      await dlgC.getByRole('button', { name: 'Dar ciente' }).click();
      await aviso(page, 'Ciente dado. Tarefa arquivada.');
      await expect(dlgC.getByText('Tarefa arquivada.')).toBeVisible();

      // Diretor vê o log; gestora não tem a aba de log
      await dlgC.getByRole('tab', { name: 'Log' }).click();
      await expect(dlgC.locator('.log li')).not.toHaveCount(0);
      await expect(dlgC.locator('.log')).toContainText('deu ciente: tarefa arquivada');
      const dlgM2 = await abrirTarefa(marina.page, paraJoao);
      await expect(dlgM2.getByRole('tab', { name: 'Log' })).toHaveCount(0);
    } finally {
      await marina.fechar();
      await joao.fechar();
    }
  });

  test('devolver com justificativa, redelegar para outra pessoa e cancelar', async ({ page, browser }) => {
    const titulo = unico('Inventário do estoque');
    await entrar(page, 'marina');
    await irPara(page, 'Meus quadros');
    const origem = await criarTarefa(page, titulo);
    const filho = await delegar(page, origem, /João/);

    const joao = await outraPessoa(browser, 'joao');
    try {
      await irPara(joao.page, 'Caixa de entrada');
      const row = joao.page.locator('.row.inbox', { hasText: titulo });
      await row.getByRole('button', { name: 'Devolver' }).click();
      const dv = dialogo(joao.page, 'Devolver tarefa');
      await dv.getByRole('button', { name: 'Devolver' }).click();
      await expect(dv).toBeVisible(); // sem justificativa não devolve
      await dv.getByLabel('Justificativa (obrigatória)').fill('Estou de férias');
      await dv.getByRole('button', { name: 'Devolver' }).click();
      await expect(row).toHaveCount(0);
    } finally {
      await joao.fechar();
    }

    await irPara(page, 'Tarefas delegadas');
    const precisa = page.locator('section[aria-labelledby="h-need"]');
    const linha = precisa.locator('.row', { hasText: titulo });
    await expect(linha.getByText('“Estou de férias”')).toBeVisible();
    await linha.getByRole('button', { name: 'Redelegar' }).click();
    const rd = dialogo(page, 'Redelegar tarefa');
    await rd.getByLabel('Para').selectOption({ label: 'Beatriz Lima' });
    await rd.getByRole('button', { name: 'Redelegar' }).click();
    await expect(precisa.getByText(titulo)).toHaveCount(0);

    const beatriz = await outraPessoa(browser, 'beatriz');
    try {
      await irPara(beatriz.page, 'Caixa de entrada');
      await expect(beatriz.page.locator('.row.inbox', { hasText: titulo }).locator('.code')).toHaveText(filho); // mesmo código
    } finally {
      await beatriz.fechar();
    }

    const dlg = await abrirTarefa(page, filho);
    await dlg.getByRole('button', { name: 'Cancelar delegação' }).click();
    await dialogo(page, 'Cancelar delegação').getByRole('button', { name: 'Cancelar delegação' }).click();
    await aviso(page, 'Delegação cancelada.');
  });

  test('avisos: quem recebe uma delegação vê o aviso e abre a tarefa por ele', async ({ page, browser }) => {
    const titulo = unico('Revisar contrato');
    await entrar(page, 'paulo');
    await irPara(page, 'Meus quadros');
    const origem = await criarTarefa(page, titulo);
    const filho = await delegar(page, origem, /Lucas/);
    const lucas = await outraPessoa(browser, 'lucas');
    try {
      await irPara(lucas.page, 'Avisos');
      await lucas.page.getByRole('button', { name: new RegExp(`delegou: ${titulo}`) }).click();
      await expect(lucas.page.getByRole('dialog', { name: `Tarefa ${filho}` })).toBeVisible();
    } finally {
      await lucas.fechar();
    }
  });

  test('painel e tarefas delegadas mostram a equipe do gestor', async ({ page }) => {
    await entrar(page, 'marina');
    await expect(page.locator('.topbar h1')).toHaveText('Painel');
    await expect(page.locator('section[aria-labelledby="h-load"]')).toBeVisible(); // quadro da equipe no Painel
    await irPara(page, 'Tarefas delegadas');
    await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
    for (const nome of ['João Alves', 'Beatriz Lima']) await expect(page.locator('.ghead', { hasText: nome })).toBeVisible();
    await expect(page.locator('.ghead', { hasText: 'Lucas Prado' })).toHaveCount(0); // não é da equipe dela
  });
});

