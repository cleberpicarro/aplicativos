import { test, expect, entrar, outraPessoa, criarTarefa, api, unico } from './apoio';

/** Item 94: o Admin liga o destaque em cor sólida das atrasadas e das que vencem hoje; vale para todos. */
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const ontem = () => { const d = new Date(`${hoje()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const fundo = (l: import('@playwright/test').Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe('destaque das atrasadas e de hoje (item 94)', () => {
  test('Admin liga e escolhe as cores; cartões e linhas ficam pintados; desligar volta ao normal @celular', async ({ page, browser }) => {
    await entrar(page, 'marina');
    const atrasada = unico('Atrasada destaque');
    const deHoje = unico('Hoje destaque');
    const idA = await criarTarefa(page, atrasada);
    const idH = await criarTarefa(page, deHoje);
    await api(page, 'PATCH', `/cards/${idA}`, { dueDate: ontem() });
    await api(page, 'PATCH', `/cards/${idH}`, { dueDate: hoje() });

    const admin = await outraPessoa(browser, 'renata', { viewport: { width: 1366, height: 800 } });
    try {
      // Item 96: Configurações tem item próprio no menu, com engrenagem.
      await admin.page.getByRole('link', { name: 'Configurações' }).click();
      await expect(admin.page.locator('.topbar h1')).toHaveText('Configurações');
      const d = admin.page.locator('.settings-block', { hasText: 'Destaque de prazos' });
      await d.getByRole('checkbox', { name: 'Destacar tarefas atrasadas' }).check();
      await d.getByRole('checkbox', { name: 'Destacar tarefas que vencem hoje' }).check();
      await d.getByRole('radio', { name: 'Verde' }).click();
      await expect(d.locator('.hl-sample')).toHaveCount(2);
      await d.getByRole('button', { name: 'Salvar' }).click();
      await expect(admin.page.getByText('Configurações salvas. Valem para todos.')).toBeVisible();
      await expect(d.getByRole('button', { name: 'Salvar' })).toBeDisabled();

      await page.reload();
      const cA = page.locator('article.kc', { hasText: atrasada });
      const cH = page.locator('article.kc', { hasText: deHoje });
      await expect(cA).toHaveClass(/hl-late/);
      await expect(cH).toHaveClass(/hl-today/);
      expect(await fundo(cA)).toBe('rgb(198, 40, 40)');
      expect(await fundo(cH)).toBe('rgb(46, 125, 50)');
      expect(await cA.locator('.t').evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).fontWeight])).toEqual(['rgb(255, 255, 255)', '700']);

      // Tabela: a linha inteira
      await page.getByRole('button', { name: 'Tabela' }).first().click();
      await expect(page.locator('tr', { hasText: atrasada })).toHaveClass(/hl-late/);

      // Desligado: volta ao normal (só a data em vermelho)
      await d.getByRole('checkbox', { name: 'Destacar tarefas atrasadas' }).uncheck();
      await d.getByRole('checkbox', { name: 'Destacar tarefas que vencem hoje' }).uncheck();
      await d.getByRole('button', { name: 'Salvar' }).click();
      await expect(d.getByRole('button', { name: 'Salvar' })).toBeDisabled();
      await page.reload();
      await expect(page.locator('tr', { hasText: atrasada })).toBeVisible();
      expect(await fundo(page.locator('tr', { hasText: atrasada }).locator('td').first())).not.toBe('rgb(198, 40, 40)');
    } finally {
      await api(admin.page, 'PATCH', '/admin/settings', { lateOn: false, todayOn: false, lateColor: 'vermelho', todayColor: 'amarelo' });
      await admin.fechar();
    }
  });

  test('quem não é Admin não vê Configurações no menu nem abre a tela pelo endereço', async ({ page }) => {
    await entrar(page, 'marina');
    await expect(page.getByRole('link', { name: 'Configurações' })).toHaveCount(0);
    await page.goto('/#/configuracoes');
    await expect(page.getByText('Destaque de prazos')).toHaveCount(0);
  });

  test('Pessoas não tem mais o botão Configurações (item 96)', async ({ page }) => {
    await entrar(page, 'renata');
    await page.goto('/#/pessoas');
    await expect(page.getByRole('button', { name: 'Nova pessoa' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Configurações' })).toHaveCount(0);
  });
});
