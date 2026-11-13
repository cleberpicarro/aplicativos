import { test, expect, entrar, dialogo, unico } from './apoio';

test.describe('administração de pessoas', () => {
  test('cadastrar, editar dados (com o superior direto) e desativar uma pessoa', async ({ page }) => {
    await entrar(page, 'renata');
    const nome = unico('Pessoa Nova');
    const email = `${nome.split(' ').pop()}@nerus.com.br`;
    await page.getByRole('button', { name: 'Nova pessoa' }).click();
    const d = dialogo(page, 'Nova pessoa');
    await d.getByLabel('Nome').fill(nome);
    await d.getByLabel('E-mail').fill(email);
    // gestor pode responder a um diretor ou direto ao CEO (item 29)
    await d.getByLabel('Nível').selectOption({ label: 'Gestor' });
    await expect(d.getByText('Superior direto (Diretor ou CEO)')).toBeVisible();
    await expect(d.getByLabel(/Superior direto/).locator('option', { hasText: '(CEO)' })).toHaveCount(1);
    await d.getByLabel('Nível').selectOption({ label: 'Funcionário' });
    // item 32: funcionário pode responder a um gestor, a um diretor ou direto ao CEO; o cargo vem entre parênteses
    await expect(d.getByText('Superior direto (Gestor, Diretor ou CEO)')).toBeVisible();
    await expect(d.getByLabel(/Superior direto/).locator('option', { hasText: 'Carlos Menezes (Diretor)' })).toHaveCount(1);
    await expect(d.getByLabel(/Superior direto/).locator('option', { hasText: 'Helena Duarte (CEO)' })).toHaveCount(1);
    const sup = d.getByLabel(/Superior direto/);
    await sup.selectOption({ label: (await sup.locator('option').allInnerTexts()).find((o) => o.includes('Marina'))! });
    await d.getByRole('button', { name: 'Cadastrar' }).click();
    const linha = page.locator('tr', { hasText: nome });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText('Marina');

    await linha.getByRole('button', { name: `Ações para ${nome}` }).click();
    await page.getByRole('menuitem', { name: 'Editar dados' }).click();
    const e = dialogo(page, 'Editar dados');
    await e.getByLabel('Cargo exibido').fill('Analista');
    // item 33: o superior direto também muda aqui, com aviso antes de salvar
    const sup2 = e.getByLabel('Superior direto (Gestor, Diretor ou CEO)');
    await expect(sup2.locator('option:checked')).toHaveText('Marina Teixeira (Gestor)');
    await sup2.selectOption({ label: 'Paulo Ribeiro (Gestor)' });
    await expect(e.getByText(/delegações em aberto de Marina Teixeira para esta pessoa passam ao novo superior/)).toBeVisible();
    await e.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText(/agora responde a Paulo Ribeiro/)).toBeVisible();
    await expect(linha).toContainText('Analista');
    await expect(linha).toContainText('Paulo Ribeiro');
    await linha.getByRole('button', { name: `Ações para ${nome}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Transferir gestão' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // sem pendências, desativa sem escolher sucessor (item 44)
    await linha.getByRole('button', { name: `Ações para ${nome}` }).click();
    await page.getByRole('menuitem', { name: 'Desativar' }).click();
    const dd = dialogo(page, 'Desativar pessoa');
    await expect(dd.getByText(/ficam com/)).toBeVisible();
    await expect(dd.getByLabel('Quem recebe as pendências')).toHaveCount(0);
    await dd.getByRole('button', { name: 'Desativar' }).click();
    await expect(linha).toContainText('Inativa');
  });

  test('desativar quem tem equipe passa as pendências ao sucessor; reativar devolve o acesso (item 44)', async ({ page }) => {
    await entrar(page, 'renata');
    const cadastrar = async (nome: string, nivel: string, superior: string) => {
      await page.getByRole('button', { name: 'Nova pessoa' }).click();
      const d = dialogo(page, 'Nova pessoa');
      await d.getByLabel('Nome').fill(nome);
      await d.getByLabel('E-mail').fill(`${nome.split(' ').pop()}@nerus.com.br`);
      await d.getByLabel('Nível').selectOption({ label: nivel });
      await d.getByLabel(/Superior direto/).selectOption({ label: superior });
      await d.getByRole('button', { name: 'Cadastrar' }).click();
      await expect(page.getByRole('button', { name: `Ações para ${nome}` })).toBeVisible();
    };
    const gestor = unico('Gestor Saindo');
    const func = unico('Func Ficando');
    await cadastrar(gestor, 'Gestor', 'Carlos Menezes (Diretor)');
    await cadastrar(func, 'Funcionário', `${gestor} (Gestor)`);
    // a linha do funcionário também mostra o nome do gestor (superior direto): acha a linha pelo botão de ações
    const lg = page.locator('tr').filter({ has: page.getByRole('button', { name: `Ações para ${gestor}` }) });
    await lg.getByRole('button', { name: `Ações para ${gestor}` }).click();
    await page.getByRole('menuitem', { name: 'Desativar' }).click();
    const dd = dialogo(page, 'Desativar pessoa');
    await expect(dd.getByText('1 subordinado direto')).toBeVisible();
    await dd.getByLabel('Quem recebe as pendências').selectOption({ label: 'Paulo Ribeiro (Gestor)' });
    await expect(dd.getByText(/passa a responder a Paulo Ribeiro/)).toBeVisible();
    await dd.getByRole('button', { name: 'Desativar' }).click();
    await expect(page.getByText(/As pendências foram para Paulo/)).toBeVisible();
    await expect(lg).toContainText('Inativa');
    await expect(page.locator('tr').filter({ has: page.getByRole('button', { name: `Ações para ${func}` }) })).toContainText('Paulo Ribeiro');
    // esconder inativas
    const gravou = () => page.waitForResponse((r) => r.url().includes('/api/me/prefs'));
    await Promise.all([gravou(), page.getByRole('checkbox', { name: /Esconder inativas/ }).check()]);
    await expect(lg).toHaveCount(0);
    // item 66: a escolha fica gravada e volta ao abrir a tela de novo
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /Esconder inativas/ })).toBeChecked();
    await expect(lg).toHaveCount(0);
    await Promise.all([gravou(), page.getByRole('checkbox', { name: /Esconder inativas/ }).uncheck()]);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /Esconder inativas/ })).not.toBeChecked();
    // reativar
    await lg.getByRole('button', { name: `Ações para ${gestor}` }).click();
    await page.getByRole('menuitem', { name: 'Reativar' }).click();
    await dialogo(page, 'Reativar pessoa').getByRole('button', { name: 'Reativar' }).click();
    await expect(lg).not.toContainText('Inativa');
  });

  test('quem não é administrador não vê a tela Pessoas', async ({ page }) => {
    await entrar(page, 'helena');
    await expect(page.getByRole('link', { name: /Pessoas/ })).toHaveCount(0);
    await page.goto('/#/pessoas');
    await expect(page.getByText('Somente a administração acessa esta tela.')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
  });
});

