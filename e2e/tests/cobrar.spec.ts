/** Item 90 (Cobrar), item 93 (Retomar e Cancelar na delegada em aberto). */
import { test, expect, entrar, outraPessoa, irPara, criarTarefa, abrirTarefa, dialogo, aviso, unico, api } from './apoio';
import type { Page } from '@playwright/test';

/** Prints para o Cleber: só quando PRINTS aponta para uma pasta. */
const print = async (page: Page, nome: string) => {
  if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/${nome}.png` });
};

async function delegarPelaApi(page: Page, id: string, para: string, prazo?: string) {
  const me = await api(page, 'GET', '/me');
  const to = me.directReports.find((r: { name: string }) => r.name.startsWith(para)).id;
  if (prazo) await api(page, 'PATCH', `/cards/${id}`, { dueDate: prazo });
  return (await api(page, 'POST', `/cards/${id}/delegate`, { toUserId: to })).cardId as string;
}

test.describe('cobrar a tarefa delegada', () => {
  test('Cobrar com recado: quem recebeu vê o balão e a cobrança na tarefa @celular', async ({ page, browser }) => {
    const titulo = unico('Enviar proposta revisada');
    await entrar(page, 'paulo');
    await irPara(page, 'Tarefas');
    const origem = await criarTarefa(page, titulo);
    const filho = await delegarPelaApi(page, origem, 'Lucas', '2026-01-05');
    // Lucas já viu o balão da tarefa que chegou (senão os dois avisos aparecem juntos num balão só).
    const antes = await outraPessoa(browser, 'lucas');
    await expect(antes.page.locator('.arrival')).toBeVisible();
    await antes.fechar();

    await irPara(page, 'Tarefas delegadas');
    const linha = page.locator('section[aria-labelledby="h-team"] .row', { hasText: titulo });
    for (const b of ['Cobrar', 'Retomar', 'Cancelar']) await expect(linha.getByRole('button', { name: b, exact: true })).toBeVisible();
    await print(page, `1-delegadas-com-cobrar${test.info().project.name === 'celular' ? '-celular' : ''}`);
    await linha.getByRole('button', { name: 'Cobrar', exact: true }).click();
    const d = dialogo(page, 'Cobrar tarefa');
    await d.getByLabel('Recado (opcional)').fill('Preciso disso até amanhã às 10h, por favor.');
    await print(page, `2-cobrar-com-recado${test.info().project.name === 'celular' ? '-celular' : ''}`);
    await d.getByRole('button', { name: 'Cobrar', exact: true }).click();
    await aviso(page, 'Cobrança enviada. Lucas recebeu um aviso e um e-mail.');
    await expect(linha.locator('.nudged')).toBeVisible();

    // Cobrar de novo logo em seguida não pode.
    await linha.getByRole('button', { name: 'Cobrar', exact: true }).click();
    await expect(dialogo(page, 'Cobrar tarefa').getByText(/^Cobrada em/)).toHaveCount(0);
    await dialogo(page, 'Cobrar tarefa').getByRole('button', { name: 'Cobrar', exact: true }).click();
    await expect(dialogo(page, 'Cobrar tarefa').getByText('Espere pelo menos 1 hora')).toBeVisible();
    await dialogo(page, 'Cobrar tarefa').getByRole('button', { name: 'Cancelar' }).click();

    // Na tarefa de origem, a caixa "Repassada para" mostra a cobrança e os botões.
    const dlg = await abrirTarefa(page, origem);
    const box = dlg.locator('.box', { hasText: 'Repassada para' });
    await expect(box.getByText(/^Cobrada em \d\d\/\d\d às \d\d:\d\d\.$/)).toBeVisible();
    await expect(box.getByRole('button', { name: 'Cobrar' })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Retomar' })).toBeVisible();
    await print(page, `3-tarefa-de-origem${test.info().project.name === 'celular' ? '-celular' : ''}`);
    await dlg.getByRole('button', { name: 'Fechar' }).click();

    const lucas = await outraPessoa(browser, 'lucas', test.info().project.name === 'celular' ? { viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true } : {});
    try {
      const balao = lucas.page.locator('.arrival');
      await expect(balao).toContainText(`Paulo cobrou (prazo vencido): ${titulo}`);
      await expect(balao).toContainText('Preciso disso até amanhã');
      await print(lucas.page, `4-balao-de-cobranca${test.info().project.name === 'celular' ? '-celular' : ''}`);
      await balao.getByRole('button', { name: /cobrou/ }).click();
      const t = lucas.page.getByRole('dialog', { name: /^Tarefa #\d+$/ });
      await expect(t.locator('.nudge-box')).toContainText('Paulo cobrou esta tarefa.');
      await expect(t.locator('.nudge-box')).toContainText('“Preciso disso até amanhã às 10h, por favor.”');
      await print(lucas.page, `5-tarefa-cobrada${test.info().project.name === 'celular' ? '-celular' : ''}`);
      expect(await lucas.page.evaluate(() => location.hash)).toBe(`#/tarefa/${filho}`);
    } finally {
      await lucas.fechar();
    }
  });

  test('Retomar e Cancelar na delegação em aberto (item 93)', async ({ page }) => {
    const retomar = unico('Proposta que volta');
    const desistir = unico('Proposta encerrada');
    await entrar(page, 'paulo');
    await irPara(page, 'Tarefas');
    const r = await criarTarefa(page, retomar);
    const c = await criarTarefa(page, desistir);
    await delegarPelaApi(page, r, 'Lucas');
    await delegarPelaApi(page, c, 'Lucas');
    await irPara(page, 'Tarefas delegadas');
    const equipe = page.locator('section[aria-labelledby="h-team"]');

    await equipe.locator('.row', { hasText: retomar }).getByRole('button', { name: 'Retomar' }).click();
    await aviso(page, 'Tarefa retomada: ela continua no seu quadro.');
    await expect(equipe.locator('.row', { hasText: retomar })).toHaveCount(0);

    await equipe.locator('.row', { hasText: desistir }).getByRole('button', { name: 'Cancelar', exact: true }).click();
    const cd = dialogo(page, 'Cancelar delegação');
    await expect(cd).toContainText('Para ficar com ela, use Retomar.');
    await cd.getByRole('button', { name: 'Cancelar delegação' }).click();
    await aviso(page, 'Delegação cancelada. Lucas foi avisado(a). A sua tarefa foi para Arquivadas.');

    await irPara(page, 'Tarefas');
    await expect(page.locator('article.kc', { hasText: retomar })).toBeVisible();
    await expect(page.locator('article.kc', { hasText: desistir })).toHaveCount(0);
  });
});
