import path from 'node:path';
import { test, expect, entrar, irPara, dialogo, unico } from './apoio';

test.describe('captura e importação', () => {
  test('colar um link cria a tarefa na caixa de entrada @celular', async ({ page }) => {
    await entrar(page, 'beatriz');
    const titulo = unico('Ler artigo');
    await page.goto(`/#/capturar?title=${encodeURIComponent(titulo)}&url=${encodeURIComponent('https://exemplo.com/artigo')}`);
    await page.getByRole('button', { name: 'Salvar na caixa de entrada' }).click();
    await expect(page.getByRole('heading', { name: 'Salvo na caixa de entrada' })).toBeVisible();
    await page.getByRole('button', { name: 'Abrir a caixa de entrada' }).click();
    const row = page.locator('.row.inbox', { hasText: titulo });
    await expect(row).toContainText('Capturada da web');
    await row.getByRole('button', { name: 'Aceitar e organizar' }).click();
    await dialogo(page, 'Aceitar e organizar').getByRole('button', { name: 'Aceitar' }).click();
    await expect(row).toHaveCount(0);
    await irPara(page, 'Meus quadros');
    await expect(page.locator('article.kc', { hasText: titulo })).toBeVisible();
  });

  test('compartilhar do celular leva à captura com o link separado do texto', async ({ page }) => {
    await entrar(page, 'beatriz');
    await page.goto(`/compartilhar?title=Notícia&text=${encodeURIComponent('Veja isto https://exemplo.com/n1')}`);
    await expect(page.getByLabel('Título')).toHaveValue('Notícia');
    await expect(page.getByText('https://exemplo.com/n1')).toBeVisible();
  });

  test('importar um quadro do Trello', async ({ page }) => {
    await entrar(page, 'lucas');
    await page.getByRole('button', { name: 'Importar do Trello' }).click();
    const d = dialogo(page, 'Importar do Trello');
    await d.getByLabel('Arquivo exportado do Trello (.json)').setInputFiles(path.resolve(__dirname, '../../apps/web/src/lib/__fixtures__/trello-board.json'));
    const nome = unico('Do Trello');
    await d.getByLabel('Nome do novo quadro').fill(nome);
    await d.getByRole('button', { name: /Importar/ }).click();
    await expect(page.locator('.toast', { hasText: 'Quadro importado do Trello.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: nome })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('article.kc').first()).toBeVisible();
  });
});
