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
    const sup2 = e.getByLabel('Superior direto (Gestor)');
    await expect(sup2.locator('option:checked')).toHaveText('Marina Teixeira');
    await sup2.selectOption({ label: 'Paulo Ribeiro' });
    await expect(e.getByText(/delegações em aberto de Marina Teixeira para esta pessoa passam ao novo superior/)).toBeVisible();
    await e.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText(/agora responde a Paulo Ribeiro/)).toBeVisible();
    await expect(linha).toContainText('Analista');
    await expect(linha).toContainText('Paulo Ribeiro');
    await linha.getByRole('button', { name: `Ações para ${nome}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Transferir gestão' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await linha.getByRole('button', { name: `Ações para ${nome}` }).click();
    await page.getByRole('menuitem', { name: 'Desativar' }).click();
    await dialogo(page, 'Desativar pessoa').getByRole('button', { name: 'Desativar' }).click();
    await expect(linha).toContainText('Inativa');
  });

  test('não deixa desativar quem tem equipe', async ({ page }) => {
    await entrar(page, 'renata');
    const linha = page.locator('tr', { hasText: 'Marina Teixeira' });
    await linha.getByRole('button', { name: 'Ações para Marina Teixeira' }).click();
    await page.getByRole('menuitem', { name: 'Desativar' }).click();
    await dialogo(page, 'Desativar pessoa').getByRole('button', { name: 'Desativar' }).click();
    await expect(page.getByText(/Antes de desativar, transfira/)).toBeVisible();
  });

  test('quem não é administrador não vê a tela Pessoas', async ({ page }) => {
    await entrar(page, 'helena');
    await expect(page.getByRole('link', { name: /Pessoas/ })).toHaveCount(0);
    await page.goto('/#/pessoas');
    await expect(page.getByText('Somente a administração acessa esta tela.')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
  });
});

