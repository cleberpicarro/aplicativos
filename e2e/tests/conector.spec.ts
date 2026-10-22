import { createHash, randomBytes } from 'node:crypto';
import { test, expect, entrar, irPara, dialogo, unico } from './apoio';

/** Item 65: o Claude (ou outro assistente) liga-se ao SyncTasks pelo "Permitir" e cria tarefas. */
test.describe('conector para assistentes de IA', () => {
  test('Permitir, criar tarefa pelo assistente e Desligar em Meus dados @celular', async ({ page }) => {
    await entrar(page, 'joao');
    // O assistente se cadastra (como o Claude faz sozinho ao adicionar o conector).
    const volta = 'http://127.0.0.1:9/retorno-assistente';
    const reg = await page.request.post('/oauth/register', { data: { client_name: 'Claude', redirect_uris: [volta] } });
    expect(reg.status()).toBe(201);
    const clientId = (await reg.json()).client_id as string;
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    // O endereço de volta não existe: o roteiro só lê o código que chegaria ao assistente.
    let retorno = '';
    await page.route(`${volta}**`, async (route) => {
      retorno = route.request().url();
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' });
    });
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: volta, code_challenge: challenge, code_challenge_method: 'S256', state: 'abc' });
    await page.goto(`/oauth/authorize?${q}`);
    await expect(page.getByRole('heading', { name: 'Ligar assistente ao SyncTasks' })).toBeVisible();
    await expect(page.locator('.connect')).toContainText('Claude');
    await expect(page.locator('.connect')).toContainText('não vai poder apagar');
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect.poll(() => retorno).toContain('code=');
    const code = new URL(retorno).searchParams.get('code')!;
    expect(new URL(retorno).searchParams.get('state')).toBe('abc');

    const tok = await page.request.post('/oauth/token', {
      form: { grant_type: 'authorization_code', code, redirect_uri: volta, client_id: clientId, code_verifier: verifier },
    });
    expect(tok.status()).toBe(200);
    const access = (await tok.json()).access_token as string;
    const titulo = unico('Ligar para o fornecedor');
    const r = await page.request.post('/mcp', {
      headers: { authorization: `Bearer ${access}` },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'criar_tarefas', arguments: { tarefas: [{ titulo }] } } },
    });
    expect((await r.json()).result.content[0].text).toContain('Criada 1 tarefa');

    // A tarefa espera na caixa de entrada, marcada como criada pelo assistente.
    await page.goto('/');
    await irPara(page, 'Caixa de entrada');
    await expect(page.locator('.row.inbox', { hasText: titulo })).toContainText('Criada pelo assistente');

    // Meus dados: o endereço para colar no Claude e o assistente ligado, com Desligar.
    await page.getByRole('button', { name: 'Meus dados' }).last().click();
    const dlg = dialogo(page, 'Meus dados');
    await expect(dlg.locator('.copy-line code')).toHaveText(/\/mcp$/);
    const item = dlg.locator('.ai-list li', { hasText: 'Claude' });
    await expect(item).toHaveCount(1);
    await item.getByRole('button', { name: 'Desligar' }).click();
    await expect(dlg.getByText('Nenhum assistente ligado à sua conta.')).toBeVisible();
    const depois = await page.request.post('/mcp', { headers: { authorization: `Bearer ${access}` }, data: { jsonrpc: '2.0', id: 2, method: 'ping' } });
    expect(depois.status()).toBe(401);
  });

  test('sem login, a tela de entrada explica o pedido e depois mostra o Permitir', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'pt-BR' });
    const page = await ctx.newPage();
    const reg = await page.request.post('/oauth/register', { data: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] } });
    const clientId = (await reg.json()).client_id as string;
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    await page.goto(`/oauth/authorize?${q}`);
    await expect(page.getByText('Entre no SyncTasks para ligar o assistente à sua conta.')).toBeVisible();
    await page.getByLabel('E-mail').fill('beatriz@nerus.com.br');
    await page.getByLabel('Senha', { exact: true }).fill('nerus2026');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: 'Ligar assistente ao SyncTasks' })).toBeVisible();
    await expect(page.locator('.connect')).toContainText('claude.ai');
    await ctx.close();
  });
});
