import fs from 'node:fs';
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
    await row.getByRole('button', { name: 'Aceitar', exact: true }).click();
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
    await page.getByRole('menuitem', { name: 'Importar arquivo JSON' }).click();
    const d = dialogo(page, 'Importar arquivo JSON');
    await d.getByLabel('Arquivo JSON (do SyncTasks ou do Trello)').setInputFiles(path.resolve(__dirname, '../../apps/web/src/lib/__fixtures__/trello-board.json'));
    const nome = unico('Do Trello');
    await d.getByLabel('Nome do novo quadro').fill(nome);
    await d.getByRole('button', { name: /Importar/ }).click();
    await expect(page.locator('.toast', { hasText: 'Quadro importado.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: nome })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('article.kc').first()).toBeVisible();
  });

  test('exportar todas as tarefas em JSON e importar o arquivo de volta', async ({ page }) => {
    await entrar(page, 'lucas');
    const titulo = unico('Vai e volta');
    await criarTarefa(page, titulo);
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Exportar tarefas (JSON)' }).click();
    const d = dialogo(page, 'Exportar tarefas (JSON)');
    await expect(d.getByText(/vai ter todas as suas tarefas/)).toBeVisible();
    const baixando = page.waitForEvent('download');
    await d.getByRole('button', { name: 'Baixar arquivo' }).click();
    const arquivo = await baixando;
    expect(arquivo.suggestedFilename()).toMatch(/^synctasks-tarefas-\d{4}-\d{2}-\d{2}\.json$/);
    const caminho = test.info().outputPath('exportacao.json');
    await arquivo.saveAs(caminho);
    const json = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    expect(json.formato).toBe('synctasks-exportacao');
    expect(JSON.stringify(json)).toContain(titulo);
    await d.locator('.dialog-f').getByRole('button', { name: 'Fechar' }).click();

    // Importa só o quadro onde a tarefa foi criada
    await page.getByRole('button', { name: 'Opções do quadro' }).click();
    await page.getByRole('menuitem', { name: 'Importar arquivo JSON' }).click();
    const imp = dialogo(page, 'Importar arquivo JSON');
    await imp.getByLabel('Arquivo JSON (do SyncTasks ou do Trello)').setInputFiles(caminho);
    const quadro = json.quadros.find((q: any) => q.cards.some((c: any) => c.name === titulo)).name as string;
    const caixas = imp.getByRole('checkbox');
    for (let i = 0; i < await caixas.count(); i++) {
      const caixa = caixas.nth(i);
      const rotulo = (await caixa.locator('xpath=..').innerText()).trim();
      if (!rotulo.startsWith(`${quadro} ·`)) await caixa.uncheck();
    }
    await imp.getByRole('button', { name: 'Importar 1 quadro' }).click();
    await expect(page.locator('.toast', { hasText: 'Quadro importado.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: quadro, selected: true })).toBeVisible();
    await expect(page.locator('article.kc', { hasText: titulo })).toBeVisible();
  });
});
