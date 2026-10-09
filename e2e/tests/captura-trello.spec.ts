import path from 'node:path';
import { test, expect, entrar, irPara, dialogo, unico, criarTarefa } from './apoio';

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
    await irPara(page, 'Tarefas');
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
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Importar do Trello' }).click();
    const d = dialogo(page, 'Importar do Trello');
    await d.getByLabel('Arquivo exportado do Trello (.json)').setInputFiles(path.resolve(__dirname, '../../apps/web/src/lib/__fixtures__/trello-board.json'));
    const nome = unico('Do Trello');
    await d.getByLabel('Nome do novo quadro').fill(nome);
    await d.getByRole('button', { name: /Importar/ }).click();
    await expect(page.locator('.toast', { hasText: 'Quadro importado do Trello.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: nome })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('article.kc').first()).toBeVisible();
  });

  test('exportar o quadro aberto para o Trello', async ({ page }) => {
    // O Trello é simulado: guarda o que o SyncTasks pediu e responde como ele.
    const pedidos: { caminho: string; dados: URLSearchParams }[] = [];
    let n = 0;
    await page.route('https://api.trello.com/**', async (route) => {
      const caminho = new URL(route.request().url()).pathname.replace('/1', '');
      pedidos.push({ caminho, dados: new URLSearchParams(route.request().postData() ?? '') });
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ id: `t${++n}`, url: 'https://trello.com/b/teste/quadro' }) });
    });
    await entrar(page, 'lucas');
    const titulo = unico('Para o Trello');
    await criarTarefa(page, titulo);
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Exportar para o Trello' }).click();
    const d = dialogo(page, 'Exportar para o Trello');
    await expect(d.getByRole('button', { name: 'Conectar ao Trello' })).toBeVisible();
    await d.getByText('A janela não voltou sozinha? Cole o código').click();
    await d.getByLabel('Código do Trello').fill('a'.repeat(64));
    await d.getByRole('button', { name: 'Usar código' }).click();
    await d.getByRole('button', { name: /^Exportar \d+ tarefas?$/ }).click();
    await expect(d.getByRole('link', { name: 'Abrir o quadro no Trello' })).toHaveAttribute('href', 'https://trello.com/b/teste/quadro');
    expect(pedidos[0].caminho).toBe('/boards');
    expect(pedidos.filter((p) => p.caminho === '/lists').length).toBeGreaterThanOrEqual(1);
    const cartao = pedidos.find((p) => p.caminho === '/cards' && p.dados.get('name') === titulo);
    expect(cartao?.dados.get('desc')).toContain('Código no SyncTasks: ST-');
    await d.locator('.dialog-f').getByRole('button', { name: 'Fechar' }).click();
    await expect(d).toHaveCount(0);
  });
});
