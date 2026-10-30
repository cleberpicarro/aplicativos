import { test, expect, entrar, outraPessoa, irPara, criarTarefa, abrirTarefa, dialogo, aviso, unico, api } from './apoio';
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
  await expect(dlg.locator('.box .code')).toHaveText(/^#\d+$/); // número do cartão ligado, no lugar de quem recebeu
  const filho = (await api(page, 'GET', `/cards/${codigo}`)).card.child.cardId as string;
  await dlg.getByRole('button', { name: 'Fechar' }).click();
  return filho;
}

async function aceitarDaCaixa(page: Page, titulo: string) {
  await irPara(page, 'Caixa de entrada');
  const row = page.locator('.row.inbox', { hasText: titulo });
  // A setinha “Aceitar em…” sempre pergunta o lugar (o Aceitar sozinho repete o último, item 57).
  await row.getByRole('button', { name: /^Aceitar em…/ }).click();
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
    await irPara(page, 'Tarefas');
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
      await expect(dlgM.getByText(/Desdobramento da tarefa #\d+ de Carlos/)).toBeVisible();
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
    await irPara(page, 'Tarefas');
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
    await rd.getByLabel('Para', { exact: true }).selectOption({ label: 'Beatriz Lima' });
    await rd.getByRole('button', { name: 'Redelegar' }).click();
    await expect(precisa.getByText(titulo)).toHaveCount(0);

    const beatriz = await outraPessoa(browser, 'beatriz');
    try {
      await irPara(beatriz.page, 'Caixa de entrada');
      await expect(beatriz.page.locator('.row.inbox', { hasText: titulo }).locator('.code')).toHaveText(/^#\d+$/); // mesmo cartão, com o número da caixa de entrada dela
    } finally {
      await beatriz.fechar();
    }

    const dlg = await abrirTarefa(page, filho);
    await dlg.getByRole('button', { name: 'Cancelar delegação' }).click();
    await dialogo(page, 'Cancelar delegação').getByRole('button', { name: 'Cancelar delegação' }).click();
    await aviso(page, 'Delegação cancelada.');
  });

  test('tarefa devolvida: Retomar traz para a caixa de entrada e Cancelar manda para Arquivadas (item 75)', async ({ page, browser }) => {
    const retomar = unico('Orçamento retomado');
    const cancelar = unico('Orçamento encerrado');
    await entrar(page, 'marina');
    await irPara(page, 'Tarefas');
    for (const t of [retomar, cancelar]) await delegar(page, await criarTarefa(page, t), /João/);

    const joao = await outraPessoa(browser, 'joao');
    try {
      await irPara(joao.page, 'Caixa de entrada');
      for (const t of [retomar, cancelar]) {
        const row = joao.page.locator('.row.inbox', { hasText: t });
        await row.getByRole('button', { name: 'Devolver' }).click();
        const dv = dialogo(joao.page, 'Devolver tarefa');
        await dv.getByLabel('Justificativa (obrigatória)').fill('Não é da minha área');
        await dv.getByRole('button', { name: 'Devolver' }).click();
        await expect(row).toHaveCount(0);
      }
    } finally {
      await joao.fechar();
    }

    await irPara(page, 'Tarefas delegadas');
    const precisa = page.locator('section[aria-labelledby="h-need"]');
    const linhaR = precisa.locator('.row', { hasText: retomar });
    for (const b of ['Redelegar', 'Retomar', 'Cancelar']) await expect(linhaR.getByRole('button', { name: b, exact: true })).toBeVisible();
    await linhaR.getByRole('button', { name: 'Retomar' }).click();
    await aviso(page, 'Tarefa retomada: ela está na sua caixa de entrada.');
    await expect(linhaR).toHaveCount(0);

    const linhaC = precisa.locator('.row', { hasText: cancelar });
    await linhaC.getByRole('button', { name: 'Cancelar', exact: true }).click();
    const cd = dialogo(page, 'Cancelar delegação');
    await expect(cd).toContainText('vai para Arquivadas');
    await cd.getByRole('button', { name: 'Cancelar delegação' }).click();
    await aviso(page, 'Delegação cancelada. A tarefa foi para Arquivadas.');
    await expect(linhaC).toHaveCount(0);

    // A retomada está na caixa de entrada, com a justificativa como comentário.
    await irPara(page, 'Caixa de entrada');
    const naCaixa = page.locator('.row.inbox', { hasText: retomar });
    await expect(naCaixa).toBeVisible();
    await naCaixa.locator('.title button').click();
    await expect(page.getByRole('dialog', { name: /^Tarefa #\d+$/ })).toContainText('Devolvida por João Alves: “Não é da minha área”');
    await page.getByRole('dialog', { name: /^Tarefa #\d+$/ }).getByRole('button', { name: 'Fechar' }).click();

    // A cancelada está em Arquivadas, marcada como Cancelada.
    await irPara(page, 'Arquivadas');
    await expect(page.locator('table.arch tr', { hasText: cancelar }).locator('.tag', { hasText: 'Cancelada' })).toBeVisible();
  });

  test('avisos: quem recebe uma delegação vê o aviso e abre a tarefa por ele', async ({ page, browser }) => {
    const titulo = unico('Revisar contrato');
    await entrar(page, 'paulo');
    await irPara(page, 'Tarefas');
    const origem = await criarTarefa(page, titulo);
    const filho = await delegar(page, origem, /Lucas/);
    const lucas = await outraPessoa(browser, 'lucas');
    try {
      await irPara(lucas.page, 'Avisos');
      // O balão do item 80 também tem esse texto: o aviso é o da tela Avisos.
      await lucas.page.getByRole('main').getByRole('button', { name: new RegExp(`delegou: ${titulo}`) }).click();
      await expect(lucas.page.getByRole('dialog', { name: /^Tarefa #\d+$/ })).toBeVisible();
    } finally {
      await lucas.fechar();
    }
  });

  test('painel e tarefas delegadas mostram a equipe do gestor', async ({ page }) => {
    await entrar(page, 'marina');
    await irPara(page, 'Painel');
    await expect(page.locator('section[aria-labelledby="h-load"]')).toBeVisible(); // quadro da equipe no Painel
    await irPara(page, 'Tarefas delegadas');
    await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
    for (const nome of ['João Alves', 'Beatriz Lima']) await expect(page.locator('.ghead', { hasText: nome })).toBeVisible();
    await expect(page.locator('.ghead', { hasText: 'Lucas Prado' })).toHaveCount(0); // não é da equipe dela
  });

  test('tarefa privada fica visível ao delegar; “não pode ser repassada” tira o Delegar de quem recebe (itens 41 e 43)', async ({ page, browser }) => {
    const titulo = unico('Fazer pessoalmente');
    await entrar(page, 'carlos');
    await irPara(page, 'Tarefas');
    const origem = await criarTarefa(page, titulo);
    const dlg = await abrirTarefa(page, origem);
    await dlg.getByRole('checkbox', { name: 'Privada' }).click();
    await aviso(page, 'Tarefa privada: nenhum superior vê.');
    await dlg.getByRole('button', { name: 'Delegar' }).click();
    const d = dialogo(page, 'Delegar tarefa');
    await expect(d.getByText('Esta tarefa é privada; ao delegar, ela deixa de ser privada.')).toBeVisible();
    await d.getByLabel('Para (subordinado direto)').selectOption({ label: (await d.locator('#d-to option').allInnerTexts()).find((t) => /Marina/.test(t))! });
    await d.getByRole('checkbox', { name: /Não pode ser repassada/ }).check();
    await d.getByRole('button', { name: 'Delegar' }).click();
    await expect(d).toHaveCount(0);
    // item 43: deixou de ser privada e a opção sumiu
    await expect(dlg.getByText('Privada', { exact: true })).toHaveCount(0);
    await expect(dlg.getByRole('checkbox', { name: 'Privada' })).toHaveCount(0);
    const repasse = dlg.getByRole('checkbox', { name: 'Não pode ser repassada' });
    await expect(repasse).toBeChecked();
    const filho = (await api(page, 'GET', `/cards/${origem}`)).card.child.cardId as string;

    const marina = await outraPessoa(browser, 'marina');
    try {
      await aceitarDaCaixa(marina.page, titulo);
      const dm = await abrirTarefa(marina.page, filho);
      await expect(dm.getByText(/pediu que você mesmo faça esta tarefa/)).toBeVisible();
      await expect(dm.getByRole('button', { name: 'Delegar' })).toHaveCount(0);
      await expect(dm.getByRole('checkbox', { name: 'Privada' })).toHaveCount(0);
      await dm.getByRole('button', { name: 'Transferir' }).click();
      const t = dialogo(marina.page, 'Transferir tarefa');
      await expect(t.getByText(/os subordinados não aparecem na lista/)).toBeVisible();
      await expect(t.locator('#t-to option', { hasText: 'subordinado' })).toHaveCount(0);
      await t.getByRole('button', { name: 'Cancelar' }).click(); // fecha também a tarefa
      await expect(dm).toHaveCount(0);

      // Carlos libera; Marina volta a ver o Delegar
      await repasse.click(); // a caixinha reflete o servidor: muda depois da resposta
      await aviso(page, /a tarefa pode ser repassada/);
      await expect(repasse).not.toBeChecked();
      await marina.page.reload(); // ao voltar para a janela, os dados se atualizam
      const dm2 = await abrirTarefa(marina.page, filho);
      await expect(dm2.getByRole('button', { name: 'Delegar' })).toBeVisible();
      await expect(dm2.getByText(/pediu que você mesmo faça esta tarefa/)).toHaveCount(0);
    } finally {
      await marina.fechar();
    }
  });
  test('cancelar a delegação de dentro da tarefa original, com Desfazer; aceite avisa quem delegou (itens 46 e 48)', async ({ page, browser }) => {
    const titulo = unico('Levantar custos');
    await entrar(page, 'paulo');
    await irPara(page, 'Tarefas');
    const origem = await criarTarefa(page, titulo);
    const filho = await delegar(page, origem, /Lucas/);
    // Opção A do ícone: a tarefa de quem delegou mostra a etiqueta com o nome de quem recebeu.
    await expect(page.locator('article.kc', { hasText: titulo }).locator('.dtag.to')).toHaveText('Para Lucas');

    const dlg = await abrirTarefa(page, origem);
    const box = dlg.locator('.box', { hasText: 'Repassada para' });
    await box.getByRole('button', { name: 'Cancelar delegação' }).click();
    await dialogo(page, 'Cancelar delegação').getByRole('button', { name: 'Cancelar delegação' }).click();
    await aviso(page, 'Delegação cancelada. Lucas foi avisado(a).');
    await expect(box).toHaveCount(0);
    await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click();
    await aviso(page, 'Cancelamento desfeito: a tarefa voltou para Lucas.');
    await expect(box).toBeVisible();
    await dlg.getByRole('button', { name: 'Fechar' }).click();

    const lucas = await outraPessoa(browser, 'lucas');
    try {
      await irPara(lucas.page, 'Caixa de entrada');
      await expect(lucas.page.locator('.row.inbox', { hasText: titulo })).toBeVisible();
      await aceitarDaCaixa(lucas.page, titulo);
      // Quem recebeu vê a etiqueta roxa com o nome de quem delegou.
      await irPara(lucas.page, 'Tarefas');
      await expect(lucas.page.locator('article.kc', { hasText: titulo }).locator('.dtag.from')).toHaveText('De Paulo');
    } finally {
      await lucas.fechar();
    }
    await irPara(page, 'Avisos');
    await expect(page.getByRole('button', { name: 'Lucas aceitou a tarefa' }).first()).toBeVisible();
    expect(filho).toBeTruthy();
  });
});

test.describe('quem criou, balão e seguidores (itens 79 a 81)', () => {
  test('quem recebe vê quem criou e quem delegou, recebe o balão e inclui um seguidor', async ({ page, browser }) => {
    const titulo = unico('Relatório de vendas');
    await entrar(page, 'marina');
    await irPara(page, 'Tarefas');
    const origem = await criarTarefa(page, titulo);
    await delegar(page, origem, /João/);

    const joao = await outraPessoa(browser, 'joao');
    try {
      // Item 80: o balão aparece ao entrar; clicar abre a tarefa.
      const balao = joao.page.locator('.arrival', { hasText: titulo });
      await expect(balao).toBeVisible();
      await expect(balao).toContainText('Clique para ver');
      await balao.getByRole('button', { name: /delegou/ }).click();
      const dlg = joao.page.getByRole('dialog', { name: /^Tarefa #\d+$/ });
      await expect(dlg).toBeVisible();
      await expect(balao).toHaveCount(0);
      // Item 79: quem criou e quem delegou por último, com as datas.
      await expect(dlg.getByText(/Criada por Marina .+ em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
      await expect(dlg.getByText(/Delegada por Marina .+ em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();

      // Item 81: só e-mails @nerus.com.br.
      await dlg.getByLabel('E-mail do seguidor').fill('alguem@gmail.com');
      await dlg.getByRole('button', { name: 'Incluir' }).click();
      await expect(dlg.getByText('Só e-mails @nerus.com.br podem seguir a tarefa.')).toBeVisible();
      await dlg.getByLabel('E-mail do seguidor').fill('ana.souza@nerus.com.br');
      await dlg.getByRole('button', { name: 'Incluir' }).click();
      await expect(dlg.locator('.followers .chip', { hasText: 'ana.souza@nerus.com.br' })).toBeVisible();
      await dlg.getByRole('button', { name: 'Tirar ana.souza@nerus.com.br' }).click();
      await expect(dlg.locator('.followers .chip')).toHaveCount(0);

      // O balão não volta ao recarregar.
      await dlg.getByRole('button', { name: 'Fechar' }).click();
      await joao.page.reload();
      await expect(joao.page.locator('.topbar h1')).toBeVisible();
      await expect(joao.page.locator('.arrival')).toHaveCount(0);
    } finally {
      await joao.fechar();
    }
  });
});
