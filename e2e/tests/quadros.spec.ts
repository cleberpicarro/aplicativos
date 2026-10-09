import { test, expect, entrar, outraPessoa, criarTarefa, abrirTarefa, dialogo, aviso, unico } from './apoio';

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
});
