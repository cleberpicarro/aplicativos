import { test, expect, entrar, dialogo, unico } from './apoio';

test.describe('administração de pessoas', () => {
  test('cadastrar, editar dados e desativar uma pessoa', async ({ page }) => {
    await entrar(page, 'renata');
    const nome = unico('Pessoa Nova');
    const email = `${nome.split(' ').pop()}@nerus.com.br`;
    await page.getByRole('button', { name: 'Nova pessoa' }).click();
    const d = dialogo(page, 'Nova pessoa');
    await d.getByLabel('Nome').fill(nome);
    await d.getByLabel('E-mail').fill(email);
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
    await e.getByRole('button', { name: 'Salvar' }).click();
    await expect(linha).toContainText('Analista');

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

