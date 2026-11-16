import { test, expect, entrar, outraPessoa, abrirMenu, abrirTarefa, dialogo, aviso, unico, api } from './apoio';

/**
 * Item 72: substituição em férias. Marina (gestora) escolhe Paulo em Meus dados; Paulo troca para ela no
 * seletor do topo, vê as delegações dela e não vê as tarefas comuns (não compartilhadas) nem as privadas.
 */
test.describe('substituição em férias', () => {
  test('escolher substituto, trocar no seletor do topo e voltar @celular', async ({ page, browser }) => {
    await entrar(page, 'marina');
    // Cenário: uma tarefa comum, uma privada e uma delegada ao João.
    await api(page, 'POST', '/substitution/end', {});
    const me = await api(page, 'GET', '/me');
    const boards = await api(page, 'GET', '/boards');
    const lista = (await api(page, 'GET', `/boards/${boards[0].id}`)).lists[0].id;
    const comum = unico('Comum da Marina');
    const privada = unico('Exame da Marina');
    const delegada = unico('Relatório para o João');
    await api(page, 'POST', '/cards', { listId: lista, title: comum });
    const p = await api(page, 'POST', '/cards', { listId: lista, title: privada });
    await api(page, 'PATCH', `/cards/${p.id}`, { isPrivate: true });
    const d = await api(page, 'POST', '/cards', { listId: lista, title: delegada });
    const joao = me.directReports.find((r: { name: string }) => r.name.startsWith('João')).id;
    await api(page, 'POST', `/cards/${d.id}/delegate`, { toUserId: joao });

    // Meus dados › Férias e ausências.
    await abrirMenu(page);
    await page.getByRole('button', { name: 'Meus dados' }).last().click();
    const dlg = dialogo(page, 'Meus dados');
    await dlg.getByRole('button', { name: 'Escolher substituto' }).click();
    const quem = dlg.getByLabel('Quem substitui você');
    // Qualquer pessoa pode ser escolhida, inclusive da equipe da Marina (item 73).
    const opcoes = await quem.locator('option').allInnerTexts();
    expect(opcoes.some((o) => o.startsWith('João'))).toBe(true);
    await quem.selectOption({ label: opcoes.find((o) => o.startsWith('Paulo'))! });
    await expect(dlg.getByLabel(/Compartilhar as tarefas comuns/)).not.toBeChecked();
    await dlg.getByRole('button', { name: 'Ligar substituição' }).click();
    await aviso(page, /vai substituir você/);
    await expect(dlg.locator('.sub-now')).toContainText('substitui você até alguém encerrar');

    // Paulo troca para a Marina no seletor do topo.
    const paulo = await outraPessoa(browser, 'paulo', test.info().project.name === 'celular' ? { viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true } : {});
    try {
      const seletor = paulo.page.getByLabel('Tarefas de quem');
      await expect(seletor).toBeVisible();
      await seletor.selectOption({ label: 'Substituindo Marina Teixeira' });
      await expect(paulo.page.locator('.acting-bar')).toContainText('Você está substituindo Marina');
      await expect(paulo.page.locator('.topbar h1')).toHaveText('Tarefas');
      await expect(paulo.page.locator('article.kc', { hasText: delegada })).toBeVisible();
      await expect(paulo.page.locator('article.kc', { hasText: comum })).toHaveCount(0);
      await expect(paulo.page.locator('article.kc', { hasText: privada })).toHaveCount(0);
      // Sem Avisos nem Meus dados da Marina; a privacidade não aparece na tarefa.
      await abrirMenu(paulo.page);
      const nav = paulo.page.getByRole('navigation', { name: 'Principal' });
      await expect(nav.getByRole('link', { name: /^Avisos/ })).toHaveCount(0);
      await expect(paulo.page.getByRole('button', { name: 'Meus dados' })).toHaveCount(0);
      const tarefa = await abrirTarefa(paulo.page, d.id);
      await expect(tarefa.getByLabel('Privada')).toHaveCount(0);
      await tarefa.getByRole('button', { name: 'Fechar' }).click();
      // Voltar para as próprias tarefas.
      await paulo.page.getByRole('button', { name: 'Voltar para as minhas tarefas' }).click();
      await expect(paulo.page.locator('.acting-bar')).toHaveCount(0);
      await expect(paulo.page.getByLabel('Tarefas de quem')).toHaveValue('');
      await expect(paulo.page.locator('article.kc', { hasText: delegada })).toHaveCount(0);
    } finally {
      await paulo.fechar();
    }

    // Marina encerra.
    await dlg.getByRole('button', { name: 'Encerrar substituição' }).click();
    await aviso(page, 'Substituição encerrada.');
    await expect(dlg.getByRole('button', { name: 'Escolher substituto' })).toBeVisible();
  });

  test('administração: agendar pelo quadro Férias e ausências, ver na coluna Ausência e cancelar (item 76) @celular', async ({ page }) => {
    await entrar(page, 'renata');
    await expect(page.locator('.topbar h1')).toHaveText('Pessoas');
    const quadro = page.getByRole('region', { name: 'Férias e ausências' });
    await expect(quadro).toBeVisible();
    // Começa limpo: se o João ficou com substituição de uma rodada anterior, encerra pela API.
    const lista = await api(page, 'GET', '/admin/substitutions');
    for (const s of lista.open) await api(page, 'POST', '/substitution/end', { userId: s.absent.id });
    await page.reload();

    await quadro.getByRole('button', { name: 'Nova substituição' }).click();
    const d = dialogo(page, 'Nova substituição');
    const quem = d.getByLabel('Quem vai sair');
    await quem.selectOption({ label: (await quem.locator('option').allInnerTexts()).find((o) => o.startsWith('João'))! });
    const sub = d.getByLabel(/Quem substitui/);
    await expect(sub.locator('option', { hasText: 'Paulo' })).toHaveCount(1);
    await sub.selectOption({ label: (await sub.locator('option').allInnerTexts()).find((o) => o.startsWith('Paulo'))! });
    await expect(sub).not.toHaveValue('');
    const daqui = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await d.getByLabel('Primeiro dia fora (opcional)').fill(daqui);
    await d.getByRole('button', { name: 'Ligar substituição' }).click();
    await aviso(page, /Substituição agendada/);
    await expect(d.locator('.sub-now')).toContainText('Agendada');
    await d.getByRole('button', { name: 'Fechar' }).last().click();

    const linha = quadro.locator('li', { hasText: 'João' });
    await expect(linha).toContainText('Agendada');
    await expect(linha).toContainText('Paulo');
    await expect(linha).toContainText('escolhido por Renata');
    await expect(page.locator('tr', { hasText: 'João' }).locator('td.absence-c')).toContainText('Sai em');

    await linha.getByRole('button', { name: 'Cancelar' }).click();
    await aviso(page, 'Substituição agendada cancelada.');
    await expect(quadro.getByText('Ninguém fora agora')).toBeVisible();
    await quadro.getByRole('button', { name: 'Histórico' }).click();
    await expect(dialogo(page, 'Histórico de substituições').locator('tr', { hasText: 'João' }).first()).toBeVisible();
  });
});
