import { test, expect, entrar, outraPessoa, irPara, criarTarefa, abrirTarefa, dialogo, aviso, unico, api } from './apoio';

test.describe('meus quadros', () => {
  test('criar quadro, fase e tarefa; editar descrição, prazo e checklist; concluir, arquivar e desfazer', async ({ page }) => {
    await entrar(page, 'beatriz');
    const quadro = unico('Projeto');
    await page.getByRole('button', { name: 'Quadro', exact: true }).click();
    await dialogo(page, 'Novo quadro').getByLabel('Nome do quadro').fill(quadro);
    await dialogo(page, 'Novo quadro').getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('tab', { name: quadro })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.col-h b')).toHaveText(['A fazer', 'Fazendo', 'Feito']);

    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Nova fase' }).click();
    await dialogo(page, 'Nova fase').getByLabel('Nome da fase').fill('Revisão');
    await dialogo(page, 'Nova fase').getByRole('button', { name: 'Criar' }).click();
    await expect(page.locator('.col-h b')).toHaveText(['A fazer', 'Fazendo', 'Feito', 'Revisão']);

    const titulo = unico('Escrever relatório');
    const codigo = await criarTarefa(page, titulo);
    // Item 37: quadro novo começa do 1, sem “ST-”
    await expect(page.locator('article.kc', { hasText: titulo }).locator('.code')).toHaveText('#1');
    const segunda = unico('Segunda tarefa');
    await criarTarefa(page, segunda);
    await expect(page.locator('article.kc', { hasText: segunda }).locator('.code')).toHaveText('#2');

    const dlg = await abrirTarefa(page, codigo);
    await dlg.getByLabel('Descrição').fill('Dados do trimestre');
    await dlg.getByLabel('Novo item do checklist').click(); // sai da descrição: salva
    await aviso(page, 'Descrição salva.');
    for (const item of ['Coletar dados', 'Montar gráficos']) {
      await dlg.getByLabel('Novo item do checklist').fill(item);
      await dlg.getByRole('button', { name: 'Adicionar' }).click();
      await expect(dlg.getByText(item)).toBeVisible();
    }
    await dlg.getByRole('checkbox', { name: 'Coletar dados' }).click();
    await expect(dlg.getByRole('checkbox', { name: 'Coletar dados' })).toBeChecked();
    await expect(dlg.locator('.cl').first()).toHaveText('1/2');
    await dlg.getByLabel('Prazo').fill('2030-12-20');
    await aviso(page, 'Prazo atualizado.');
    await dlg.getByLabel('Novo comentário').fill('Começando hoje');
    await dlg.getByRole('button', { name: 'Comentar' }).click();
    await expect(dlg.locator('.cmt p')).toHaveText(['Começando hoje']);
    // Item 38: cor de um cartão só, escolhida na tarefa aberta
    await dlg.getByRole('button', { name: 'Cor', exact: true }).click();
    await dlg.getByRole('radio', { name: 'Verde' }).click();
    await aviso(page, 'Cor do cartão alterada.');
    await dlg.getByRole('button', { name: 'Fechar' }).click();

    const card = page.locator('article.kc', { hasText: titulo });
    await expect(card).toHaveClass(/painted bc-verde/);
    // Item 40: tom sólido médio, com título escuro para ler bem
    await expect(card).toHaveCSS('background-color', 'rgb(159, 216, 182)');
    await expect(card.locator('.t')).toHaveCSS('color', 'rgb(27, 29, 31)');
    await expect(page.locator('article.kc', { hasText: segunda })).not.toHaveClass(/painted/);
    await expect(card.locator('.cl')).toHaveText('1/2');
    await expect(card.locator('.due')).toContainText('20 dez');

    await card.getByRole('button', { name: `Concluir ${titulo}` }).click();
    await aviso(page, 'Tarefa concluída.');
    await card.getByRole('button', { name: `Arquivar ${titulo}` }).click();
    await expect(card).toHaveCount(0);
    await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click();
    await expect(page.locator('article.kc', { hasText: titulo })).toBeVisible();
  });

  test('cor mudada no celular aparece no computador sem recarregar a página (item 38)', async ({ page, browser }) => {
    await page.clock.install();
    await entrar(page, 'lucas');
    const titulo = unico('Pintar no celular');
    const id = await criarTarefa(page, titulo);
    const card = page.locator('article.kc', { hasText: titulo });
    await expect(card).not.toHaveClass(/painted/);
    // o "celular": outra sessão da mesma pessoa muda a cor
    const { page: celular, fechar } = await outraPessoa(browser, 'lucas');
    await api(celular, 'PATCH', `/cards/${id}`, { color: 'rosa' });
    await fechar();
    // o computador continua com a página aberta: em até 30 segundos o quadro se atualiza sozinho
    await page.clock.fastForward(31_000);
    await expect(card).toHaveClass(/painted bc-rosa/);
  });

  test('arrastar tarefa entre fases e reordenar a fase', async ({ page }) => {
    await entrar(page, 'lucas');
    const a = unico('Alfa'), b = unico('Bravo');
    await criarTarefa(page, b);
    await criarTarefa(page, a);
    const fazendo = page.getByRole('region', { name: 'Fazendo', exact: true });
    await page.locator('article.kc', { hasText: a }).dragTo(fazendo.locator('.col-list'));
    await expect(fazendo.locator('article.kc', { hasText: a })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Fazendo', exact: true }).locator('article.kc', { hasText: a })).toBeVisible();

    // ordenar a fase "A fazer" por nome
    const aFazer = page.getByRole('region', { name: 'A fazer', exact: true });
    await criarTarefa(page, `Zeta ${a}`);
    await criarTarefa(page, `Aaa ${a}`);
    await aFazer.getByRole('button', { name: 'Opções da fase A fazer' }).click();
    await page.getByRole('menuitem', { name: 'Ordenar por nome (A–Z)' }).click();
    await aviso(page, /ordenada por nome/);
    const titulos = await aFazer.locator('article.kc .t').allInnerTexts();
    expect(titulos).toEqual([...titulos].sort((x, y) => x.localeCompare(y, 'pt-BR', { sensitivity: 'base' })));
  });

  test('zoom do quadro: diminuir, lembrar, arrastar com zoom e voltar a 100%', async ({ page }) => {
    await entrar(page, 'lucas');
    const largura = () => page.locator('.col').first().evaluate((el) => el.getBoundingClientRect().width);
    const normal = await largura();
    const menos = page.getByRole('button', { name: 'Diminuir o zoom' });
    for (let i = 0; i < 3; i++) await menos.click();
    await expect(menos).toBeDisabled(); // 70% é o mínimo
    await expect(page.locator('.zoom-val')).toHaveText('70%');
    expect(await largura()).toBeLessThan(normal * 0.75);

    await page.reload();
    await expect(page.locator('.zoom-val')).toHaveText('70%');
    const a = unico('Zoom');
    await criarTarefa(page, a);
    const fazendo = page.getByRole('region', { name: 'Fazendo', exact: true });
    await page.locator('article.kc', { hasText: a }).dragTo(fazendo.locator('.col-list'));
    await expect(fazendo.locator('article.kc', { hasText: a })).toBeVisible();

    await page.locator('.zoom-val').click();
    await expect(page.locator('.zoom-val')).toHaveText('100%');
    expect(Math.abs((await largura()) - normal)).toBeLessThan(1);
    const mais = page.getByRole('button', { name: 'Aumentar o zoom' });
    for (let i = 0; i < 3; i++) await mais.click();
    await expect(mais).toBeDisabled(); // 130% é o máximo
  });

  test('fase com tarefas não pode ser arquivada; vazia pode', async ({ page }) => {
    await entrar(page, 'lucas');
    const feito = page.getByRole('region', { name: 'Feito', exact: true });
    await criarTarefa(page, unico('Na fase Feito'), 'Feito');
    await feito.getByRole('button', { name: 'Opções da fase Feito' }).click();
    await page.getByRole('menuitem', { name: 'Arquivar fase (mova as tarefas antes)' }).click();
    await aviso(page, 'Mova as tarefas desta fase antes de arquivá-la.');

    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Nova fase' }).click();
    const nome = unico('Temporária');
    await dialogo(page, 'Nova fase').getByLabel('Nome da fase').fill(nome);
    await dialogo(page, 'Nova fase').getByRole('button', { name: 'Criar' }).click();
    const temp = page.getByRole('region', { name: nome, exact: true });
    await temp.getByRole('button', { name: `Opções da fase ${nome}` }).click();
    await page.getByRole('menuitem', { name: 'Arquivar fase', exact: true }).click();
    await dialogo(page, 'Arquivar fase').getByRole('button', { name: 'Arquivar' }).click();
    await expect(temp).toHaveCount(0);
  });

  test('texto com várias linhas: uma tarefa por linha (com desfazer) ou uma tarefa só (item 30)', async ({ page }) => {
    await entrar(page, 'beatriz');
    const quadro = unico('Lista');
    await page.getByRole('button', { name: 'Quadro', exact: true }).click();
    await dialogo(page, 'Novo quadro').getByLabel('Nome do quadro').fill(quadro);
    await dialogo(page, 'Novo quadro').getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('tab', { name: quadro })).toHaveAttribute('aria-selected', 'true');

    const col = page.getByRole('region', { name: 'A fazer', exact: true });
    const cards = col.locator('article.kc .t');
    await col.getByRole('button', { name: 'Adicionar tarefa' }).click();
    const campo = col.getByLabel('Título da nova tarefa');
    await campo.fill('- Ligar para o cliente\n\n2. Enviar proposta\n• Revisar contrato');
    await campo.press('Enter');
    const pergunta = dialogo(page, 'O texto tem 3 linhas');
    await expect(pergunta.locator('.lines-preview li')).toHaveText(['Ligar para o cliente', 'Enviar proposta', 'Revisar contrato']);
    await pergunta.getByRole('button', { name: 'Criar 3 tarefas' }).click();
    await expect(cards).toHaveText(['Ligar para o cliente', 'Enviar proposta', 'Revisar contrato']);
    await expect(campo).toHaveValue('');
    await page.locator('.toast', { hasText: '3 tarefas criadas.' }).getByRole('button', { name: 'Desfazer' }).click();
    await aviso(page, 'Criação desfeita.');
    await expect(cards).toHaveCount(0);

    // Shift+Enter pula linha; “Criar 1 tarefa” usa a primeira linha como título e o resto como descrição
    await campo.click();
    await page.keyboard.type('Reunião de equipe');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('pauta: metas');
    await expect(campo).toHaveValue('Reunião de equipe\npauta: metas');
    await page.keyboard.press('Enter');
    await dialogo(page, 'O texto tem 2 linhas').getByRole('button', { name: 'Criar 1 tarefa' }).click();
    await expect(cards).toHaveText(['Reunião de equipe']);
    const codigo = (await col.locator('article.kc').getAttribute('data-id'))!;
    const dlg = await abrirTarefa(page, codigo);
    await expect(dlg.getByLabel('Descrição')).toHaveValue('pauta: metas');
  });

  test('tarefa privada não aparece para a gestora', async ({ page, browser }) => {
    await entrar(page, 'beatriz');
    const titulo = unico('Assunto pessoal');
    const codigo = await criarTarefa(page, titulo);
    const dlg = await abrirTarefa(page, codigo);
    await dlg.getByRole('checkbox', { name: 'Privada' }).click();
    await aviso(page, 'Tarefa privada: nenhum superior vê.');

    const { page: gestora, fechar } = await outraPessoa(browser, 'marina');
    await gestora.goto(`/#/tarefa/${codigo}`);
    await expect(gestora.getByRole('dialog', { name: 'Tarefa não encontrada' })).toBeVisible();
    await gestora.keyboard.press('Escape');
    await gestora.getByLabel('Buscar tarefa ou número').fill(titulo);
    await expect(gestora.getByText('Nada encontrado entre as tarefas que você pode ver.')).toBeVisible();
    await fechar();
  });

  test('arquivar quadro vazio, com Desfazer; desarquivar pela tela Arquivadas (item 42)', async ({ page }) => {
    await entrar(page, 'joao');
    await irPara(page, 'Tarefas');
    const nome = unico('Projeto curto');
    await page.getByRole('button', { name: 'Quadro', exact: true }).click();
    await dialogo(page, 'Novo quadro').getByLabel('Nome do quadro').fill(nome);
    await dialogo(page, 'Novo quadro').getByRole('button', { name: 'Criar' }).click();
    const aba = page.getByRole('tab', { name: nome });
    await expect(aba).toHaveAttribute('aria-selected', 'true');
    const titulo = unico('Única tarefa');
    await criarTarefa(page, titulo);
    // com tarefa, não arquiva
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Arquivar quadro' }).click();
    await aviso(page, /Este quadro ainda tem 1 tarefa/);
    const card = page.locator('article.kc', { hasText: titulo });
    await card.getByRole('button', { name: `Concluir ${titulo}` }).click();
    await card.getByRole('button', { name: `Arquivar ${titulo}` }).click();
    await expect(card).toHaveCount(0);
    // vazio: arquiva, e o Desfazer traz de volta
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Arquivar quadro' }).click();
    await dialogo(page, 'Arquivar quadro').getByRole('button', { name: 'Arquivar quadro' }).click();
    await expect(aba).toHaveCount(0);
    await page.locator('.toast', { hasText: 'arquivado' }).getByRole('button', { name: 'Desfazer' }).click();
    await expect(aba).toBeVisible();
    // arquiva de novo e desarquiva pela tela Arquivadas
    await aba.click();
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Arquivar quadro' }).click();
    await dialogo(page, 'Arquivar quadro').getByRole('button', { name: 'Arquivar quadro' }).click();
    await expect(aba).toHaveCount(0);
    await irPara(page, 'Arquivadas');
    const bloco = page.getByRole('region', { name: 'Quadros arquivados' });
    const linha = bloco.locator('li', { hasText: nome });
    await expect(linha).toContainText('1 tarefa(s) arquivada(s)');
    await expect(page.locator('tr', { hasText: titulo })).toContainText('(quadro arquivado)');
    await linha.getByRole('button', { name: 'Desarquivar' }).click();
    await aviso(page, /voltou como a última aba/);
    await expect(linha).toHaveCount(0);
    await irPara(page, 'Tarefas');
    await expect(page.getByRole('tab').last()).toHaveText(nome);
  });
  test('o mesmo filtro da tabela no quadro, com os atalhos de delegadas (item 47) @celular', async ({ page, isMobile }) => {
    await entrar(page, 'marina');
    await irPara(page, 'Tarefas');
    // Item 59: no computador, Filtro, atalhos e Condição ficam na barra do topo; no celular, acima das fases.
    const topo = page.locator('.topbar');
    for (const nome of [/^Filtro:/, /^Delegadas por mim$/, /^Condição$/]) {
      await expect(topo.getByRole('button', { name: nome })).toHaveCount(isMobile ? 0 : 1);
      await expect(page.getByRole('button', { name: nome })).toBeVisible();
    }
    if (!isMobile) await expect(page.locator('.tbl-bar')).toHaveCount(0);
    const alfa = unico('Filtro alfa');
    const beta = unico('Filtro beta');
    await criarTarefa(page, alfa);
    const idBeta = await criarTarefa(page, beta);
    const cartao = (t: string) => page.locator('article.kc', { hasText: t });

    // Filtro novo, só aplicado: “Título contém alfa”.
    await page.getByRole('button', { name: /^Filtro:/ }).click();
    await page.getByRole('menuitem', { name: 'Novo filtro' }).click();
    const dlg = dialogo(page, 'Filtro');
    await dlg.getByLabel('Valor').first().fill(alfa);
    await dlg.getByRole('button', { name: 'Só aplicar' }).click();
    await expect(cartao(alfa)).toBeVisible();
    await expect(cartao(beta)).toHaveCount(0);
    await expect(page.locator('.filter-band')).toContainText(/Filtro ligado: mostrando 1 de \d+ tarefas/);
    await expect(page.locator('.col-h .n').first()).toHaveText(/^1 de \d+$/);

    // Um filtro só: na Tabela ele continua ligado, e volta ao Quadro do mesmo jeito.
    await page.getByRole('button', { name: 'Ver em tabela' }).click();
    await expect(page.getByRole('button', { name: 'Filtro: Filtro avulso' })).toBeVisible();
    await expect(page.locator('table.tasks tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'Ver em quadros' }).click();
    await expect(cartao(beta)).toHaveCount(0);
    await page.getByRole('button', { name: 'Limpar filtro' }).click();
    await expect(cartao(beta)).toBeVisible();
    await expect(page.locator('.filter-band')).toHaveCount(0);

    // Atalho “Delegadas por mim”: só as que ela repassou e estão em aberto, com a etiqueta “Para João”.
    const me = await api(page, 'GET', '/me');
    const joao = me.directReports.find((r: { name: string }) => /João/.test(r.name)).id;
    await api(page, 'POST', `/cards/${idBeta}/delegate`, { toUserId: joao });
    await page.reload();
    await page.getByRole('button', { name: 'Delegadas por mim', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delegadas por mim', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(cartao(beta)).toBeVisible();
    await expect(cartao(beta).locator('.dtag.to')).toHaveText('Para João');
    await expect(cartao(alfa)).toHaveCount(0);
    // A etiqueta com × desliga o atalho.
    await page.getByRole('button', { name: 'Desligar Delegadas por mim' }).click();
    await expect(cartao(alfa)).toBeVisible();
  });

  test('atalhos de teclado: N cria, C conclui, Ctrl+Enter comenta, / busca e ? mostra a lista', async ({ page }) => {
    await entrar(page, 'beatriz');
    await expect(page.locator('.kanban')).toBeVisible();
    const titulo = unico('Pelo teclado');
    await page.keyboard.press('n');
    const campo = page.getByRole('region', { name: 'A fazer', exact: true }).getByLabel('Título da nova tarefa');
    await expect(campo).toBeFocused();
    await campo.fill(titulo);
    await campo.press('Enter');
    await expect(campo).toHaveValue(''); // o campo já fica livre para a próxima
    const card = page.locator('article.kc[data-id]', { hasText: titulo });
    await expect(card).toBeVisible();
    await campo.press('Escape');

    await card.locator('button.t').click();
    const dlg = page.getByRole('dialog', { name: /^Tarefa #\d+$/ });
    await expect(dlg.getByLabel('Título', { exact: true })).toHaveValue(titulo);
    await dlg.getByLabel('Novo comentário').fill('Feito pelo teclado');
    await dlg.getByLabel('Novo comentário').press('Control+Enter');
    await expect(dlg.locator('.cmt', { hasText: 'Feito pelo teclado' })).toBeVisible();
    await dlg.getByRole('heading').click(); // sai do campo
    await page.keyboard.press('c');
    await aviso(page, 'Tarefa concluída.');
    await expect(dlg.getByRole('button', { name: 'Desfazer conclusão' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card.locator('button.ck.on')).toBeVisible();

    await page.keyboard.press('/');
    await expect(page.getByLabel('Buscar tarefa ou número')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.locator('.topbar h1').click();
    await page.keyboard.press('?');
    await expect(dialogo(page, 'Atalhos de teclado')).toContainText('Nova tarefa na primeira fase do quadro');
  });

  test('arrastar e concluir mudam a tela antes da resposta do servidor', async ({ page }) => {
    await entrar(page, 'beatriz');
    const titulo = unico('Sem esperar');
    await criarTarefa(page, titulo);
    // O servidor passa a demorar 1,5 s para gravar: a tela tem de mudar antes disso.
    await page.route('**/api/cards/*/move', async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
    await page.route('**/api/cards/*/complete', async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
    const fazendo = page.getByRole('region', { name: 'Fazendo', exact: true });
    await page.locator('article.kc', { hasText: titulo }).dragTo(fazendo.locator('.col-list'));
    await expect(fazendo.locator('article.kc', { hasText: titulo })).toBeVisible({ timeout: 700 });
    await fazendo.locator('article.kc', { hasText: titulo }).locator('button.ck').click();
    await expect(fazendo.locator('article.kc', { hasText: titulo }).locator('button.ck.on')).toBeVisible({ timeout: 700 });
    await aviso(page, 'Tarefa concluída.');
  });

  test('cartões do mesmo tamanho e balão com a tarefa completa ao parar o mouse (itens 60 e 61)', async ({ page }) => {
    await entrar(page, 'lucas');
    const curto = unico('Ligar');
    const longo = unico('Preparar a apresentação de resultados do trimestre para a reunião com a diretoria e todos os gestores da área');
    const idCurto = await criarTarefa(page, curto);
    const idLongo = await criarTarefa(page, longo);
    await api(page, 'PATCH', `/cards/${idLongo}`, { description: 'Juntar números de vendas e custos.\nPedir a planilha ao financeiro.', isPrivate: true, dueDate: '2030-01-10' });
    for (const t of ['Vendas', 'Custos']) await api(page, 'POST', `/cards/${idLongo}/checklist`, { text: t });
    await page.reload();
    const cardCurto = page.locator(`article.kc[data-id="${idCurto}"]`);
    const cardLongo = page.locator(`article.kc[data-id="${idLongo}"]`);
    await expect(cardLongo.locator('.cl')).toBeVisible();
    const altura = async (l: typeof cardCurto) => Math.round((await l.boundingBox())!.height);
    expect(await altura(cardCurto)).toBe(await altura(cardLongo));
    // O título não tem mais a dica comum do navegador: quem mostra o texto inteiro é o balão.
    await expect(cardLongo.locator('.t')).not.toHaveAttribute('title');

    await cardLongo.scrollIntoViewIfNeeded();
    const box = (await cardLongo.boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 12);
    const balao = page.getByRole('tooltip');
    await expect(balao).toBeVisible();
    await expect(balao).toContainText(longo);
    await expect(balao).toContainText('Pedir a planilha ao financeiro.');
    await expect(balao).toContainText('Checklist: 0 de 2 feitos');
    await expect(balao).toContainText('Prazo: 10/01/2030');
    await expect(balao).toContainText('Privada');
    // Sai do cartão: o balão some. Clicar no cartão também fecha.
    await page.mouse.move(box.x + box.width + 300, box.y + box.height + 300);
    await expect(balao).toHaveCount(0);
  });
});
