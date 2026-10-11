# Relatório 406 · Posição Diária Suporte

Este arquivo é a **receita** da rotina agendada "Relatório 406 Suporte". A rotina roda de segunda a sexta às 6h58 (Brasília), baixa este arquivo do GitHub e segue o que está escrito aqui.

**Para mudar o relatório, edite este arquivo.** A próxima execução já usa a versão nova, sem mexer na rotina.

- Planilha com os dados e o gráfico completo: https://docs.google.com/spreadsheets/d/1GVBuzPoG_auaS3SSyonlfFZ9wH_o-kykPqEZfSOzEdM/edit
- A senha do WebDesktop e o e-mail de destino **não ficam aqui** (este repositório é público). Eles estão no texto da rotina, que os entrega como `NERUS_USER`, `NERUS_PASS` e `DESTINO`.

---

## Instruções para o Claude

Execução automática: ninguém está acompanhando. Não faça perguntas, não crie lista de tarefas e não carregue skills.

1. **Gerar o relatório.** Extraia o script do bloco `python` no fim deste arquivo e rode:

   ```bash
   cd /tmp/rel406
   awk '/^```python/{f=1;next} /^```/{f=0} f' instrucoes.md > relatorio406.py
   NERUS_USER="..." NERUS_PASS="..." python3 relatorio406.py out
   ```

   Use os valores de usuário e senha que vieram na rotina e um timeout de 5 minutos. Se der erro por falta de biblioteca, instale com `pip install playwright matplotlib pillow` e tente de novo. Se der erro, rode mais uma vez. Se falhar de novo, pule para o passo 5.

2. **Atualizar a planilha** (ID `1GVBuzPoG_auaS3SSyonlfFZ9wH_o-kykPqEZfSOzEdM`):
   - Limpe a faixa `Dados!A1:F400` com `batch_clear_values` do conector Google Sheets.
   - Escreva o conteúdo de `out/dados.csv` com `update_values`, na faixa do campo `intervalo_planilha` de `out/resumo.json`. A primeira coluna (Data) vai como texto e as demais como números.
   - Se a planilha der erro, anote o motivo e siga para o passo 3 mesmo assim.

3. **Enviar o e-mail** com `send_message` do conector Gmail (se estiver adiada, carregue com ToolSearch `select:mcp__Gmail__send_message`):
   - `to`: o endereço `DESTINO` da rotina
   - `subject`: o campo `assunto` de `out/resumo.json`
   - `htmlBody`: o conteúdo exato de `out/email.html`
   - `body`: o conteúdo exato de `out/email.txt`
   - `attachments`: um item com `content` = o conteúdo exato de `out/grafico.b64`, `filename` = o campo `anexo` de `out/resumo.json` e `mimeType` = `image/png`

   Leia os arquivos com `cat` e não altere nada. Se o envio com anexo falhar, tente uma vez sem o anexo. O link da planilha já está no e-mail.

4. Pule para o passo 6.

5. **(Só se o script falhou duas vezes.)** Envie um e-mail para `DESTINO` com o assunto `Relatório 406 · falha na geração · <data de hoje dd/mm/aaaa>` e, no corpo, o erro em uma frase. Se o erro citar bloqueio de rede ou 403, diga que o domínio webdesktop.nerus.com.br precisa estar liberado nas configurações de rede.

6. **Notificação.** Se o e-mail saiu, não chame PushNotification. Se o e-mail falhou, chame PushNotification com o resumo (ou o erro) e o motivo da falha.

7. **Mensagem final**, curta, em português:

   ```
   Relatório 406 · dados até <ultimo_dia> · <total> tickets
   Suporte <n> · Validação <n> · Informação <n> · Atualização <n>
   Planilha atualizada: <sim/não (motivo)>
   E-mail enviado: <sim/não> · anexo: <sim/não>
   ```

---

## O que o script faz

1. Abre o WebDesktop num navegador invisível e faz login. Depois vai em WebControl > Gráficos Google > relatório 406.
2. Pede o período de 01/01/2026 até ontem e lê os números de cada dia (Suporte, Validação, Informação, Atualização).
3. Gera, na pasta `out/`:
   - `dados.csv`: todos os dias, para a planilha;
   - `grafico.png` (e `grafico.b64`, a mesma imagem em texto para anexar): gráfico dos últimos 60 dias;
   - `email.html` e `email.txt`: o e-mail, com os números de ontem, a comparação com o dia anterior, a tabela dos últimos 7 dias e o botão da planilha;
   - `resumo.json`: assunto, totais e nome do anexo.

Ajustes simples ficam nas primeiras linhas do script: `DATA_INICIAL`, `DIAS_NO_GRAFICO`, `CORES` e `PLANILHA`.

## Script

```python
# Relatório 406 - Posição Diária Suporte (WebDesktop Nerus)
# Uso: NERUS_USER=... NERUS_PASS=... python3 relatorio406.py <pasta_saida>
# Teste sem acessar o site: TESTE_HTML=arquivo.html python3 relatorio406.py <pasta_saida>
import asyncio, base64, csv, datetime as dt, json, os, re, sys, zoneinfo

SITE = 'https://webdesktop.nerus.com.br/php/desktop/index.php?.'
PLANILHA = 'https://docs.google.com/spreadsheets/d/1GVBuzPoG_auaS3SSyonlfFZ9wH_o-kykPqEZfSOzEdM/edit'
DATA_INICIAL = '01/01/2026'
DIAS_NO_GRAFICO = 60
CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)
FUSO = zoneinfo.ZoneInfo('America/Sao_Paulo')
AGORA = dt.datetime.now(FUSO)
ONTEM = AGORA.date() - dt.timedelta(days=1)


# 1) Entra no WebDesktop e devolve o HTML da tela do gráfico 406
async def baixar_html():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        navegador = await p.chromium.launch()
        pagina = await navegador.new_page(locale='pt-BR', timezone_id='America/Sao_Paulo',
                                          viewport={'width': 1440, 'height': 900})
        pagina.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pagina.goto(SITE, wait_until='networkidle', timeout=90000)
        tela = pagina.frame(name='principal')

        async def clicar(seletor):
            await tela.locator(seletor).wait_for(timeout=60000)
            await tela.locator(seletor).click()

        await tela.locator('#nome').wait_for(timeout=60000)
        await tela.locator('#nome').fill(os.environ['NERUS_USER'])
        await tela.locator('input[type=password]').fill(os.environ['NERUS_PASS'])
        await tela.locator('input[type=password]').press('Enter')
        tela = pagina.frame(name='principal')
        await clicar('a[title=WebControl]')
        await clicar('a[title="Graficos Google"]')
        await clicar('a[href="graphGoogle.php?action=verGrafico&no=406&effect="]')
        await tela.locator('input[name="var[0]"]').wait_for(timeout=60000)
        await tela.locator('input[name="var[0]"]').fill(DATA_INICIAL)
        await tela.locator('input[name="var[1]"]').fill(ONTEM.strftime('%d/%m/%Y'))
        await tela.locator('a', has_text='Avançar').click()

        html = ''
        for _ in range(90):  # espera até 90 segundos pelos dados
            await pagina.wait_for_timeout(1000)
            try:
                html = await pagina.frame(name='principal').content()
            except Exception:
                continue
            if 'arrayToDataTable' in html:
                break
        await navegador.close()
    if 'arrayToDataTable' not in html:
        raise RuntimeError('O relatório 406 não devolveu dados (a tela do gráfico não carregou).')
    return html


# 2) Lê os números de cada dia no HTML
def ler_dados(html):
    tabela = json.loads(re.search(r'arrayToDataTable\((\[.*?\])\)', html, re.S).group(1))
    acentos = {'Validacao': 'Validação', 'Informacao': 'Informação', 'Atualizacao': 'Atualização'}
    nomes = [acentos.get(n, n) for n in tabela[0][1:5]]
    dias = []
    for linha in tabela[1:]:
        dia, mes = int(linha[0][0:2]), int(linha[0][3:5])
        ano = ONTEM.year if mes <= ONTEM.month else ONTEM.year - 1
        dias.append((dt.date(ano, mes, dia), [int(v or 0) for v in linha[1:5]]))
    return nomes, dias


# 3) Desenha o gráfico dos últimos dias (imagem pequena, para ir anexada no e-mail)
def desenhar(nomes, dias, arquivo):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt, matplotlib.dates
    from PIL import Image
    trecho = dias[-DIAS_NO_GRAFICO:]
    datas = [d for d, _ in trecho]
    fig, ax = plt.subplots(figsize=(10, 4.5), dpi=100)
    base = [0] * len(trecho)
    for i, nome in enumerate(nomes):
        valores = [v[i] for _, v in trecho]
        ax.bar(datas, valores, bottom=base, width=0.8, color=CORES[i], label=nome, zorder=3)
        base = [a + b for a, b in zip(base, valores)]
    ax.set_title(f'Posição Diária Suporte · {datas[0]:%d/%m} a {datas[-1]:%d/%m/%Y}', loc='left', fontsize=13)
    ax.annotate(f'{sum(trecho[-1][1])}', xy=(datas[-1], base[-1]), xytext=(0, 4),
                textcoords='offset points', ha='center', fontsize=10, fontweight='bold')
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter('%d/%m'))
    ax.grid(axis='y', color='#e6e5e0', zorder=0)
    for lado in ['top', 'right', 'left']:
        ax.spines[lado].set_visible(False)
    ax.tick_params(length=0, labelsize=9)
    ax.legend(loc='upper left', ncol=4, frameon=False, fontsize=9, bbox_to_anchor=(0, -0.08))
    fig.tight_layout()
    fig.savefig(arquivo, facecolor='white')
    plt.close(fig)
    # Reduz para 64 cores: o arquivo fica bem menor sem perder qualidade
    Image.open(arquivo).convert('RGB').quantize(colors=64).save(arquivo, optimize=True)


# 4) Monta o e-mail (HTML simples, que funciona no Gmail e no Outlook)
def montar_email(nomes, dias):
    hoje_d, hoje_v = dias[-1]
    ant_d, ant_v = dias[-2] if len(dias) > 1 else (None, None)
    fonte = 'font-family:Arial,Helvetica,sans-serif;'

    def variacao(atual, anterior):
        if anterior is None:
            return ''
        x = atual - anterior
        texto = f'{"+" if x > 0 else ""}{x} vs {ant_d:%d/%m}' if x else f'igual a {ant_d:%d/%m}'
        return f'<div style="{fonte}font-size:12px;color:#5b636d">{texto}</div>'

    def quadro(rotulo, valor, anterior, cor=None):
        bolinha = f'<span style="display:inline-block;width:9px;height:9px;background:{cor};margin-right:6px"></span>' if cor else ''
        return (f'<td style="padding:10px 12px;border:1px solid #dfe3e8;vertical-align:top">'
                f'<div style="{fonte}font-size:12px;color:#5b636d">{bolinha}{rotulo}</div>'
                f'<div style="{fonte}font-size:24px;font-weight:bold;color:#15191e">{valor}</div>'
                f'{variacao(valor, anterior)}</td>')

    quadros = quadro('Total', sum(hoje_v), sum(ant_v) if ant_v else None) + ''.join(
        quadro(n, hoje_v[i], ant_v[i] if ant_v else None, CORES[i]) for i, n in enumerate(nomes))
    cel = f'{fonte}font-size:13px;padding:6px 10px;border-bottom:1px solid #eef0f3;text-align:right'
    cabecalho = ''.join(f'<th style="{cel};color:#5b636d">{t}</th>' for t in ['Data', *nomes, 'Total'])
    linhas = ''.join(
        '<tr>' + ''.join(f'<td style="{cel}">{x}</td>' for x in [f'{d:%d/%m/%Y}', *v, f'<b>{sum(v)}</b>']) + '</tr>'
        for d, v in reversed(dias[-7:]))
    return (f'<div style="max-width:640px">'
            f'<div style="{fonte}font-size:12px;color:#5b636d;text-transform:uppercase;letter-spacing:1px">WebDesktop Nerus · Relatório 406</div>'
            f'<div style="{fonte}font-size:20px;font-weight:bold;color:#15191e;margin:4px 0 2px">Posição Diária Suporte</div>'
            f'<div style="{fonte}font-size:13px;color:#5b636d;margin-bottom:14px">Último dia: {hoje_d:%d/%m/%Y}</div>'
            f'<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:18px"><tr>{quadros}</tr></table>'
            f'<div style="{fonte}font-size:13px;font-weight:bold;color:#5b636d;margin-bottom:6px">Últimos 7 dias</div>'
            f'<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:18px"><tr>{cabecalho}</tr>{linhas}</table>'
            f'<div style="{fonte}font-size:13px;color:#15191e;margin-bottom:12px">O gráfico dos últimos {DIAS_NO_GRAFICO} dias vai anexado a este e-mail.</div>'
            f'<a href="{PLANILHA}" style="{fonte}display:inline-block;background:#2a78d6;color:#ffffff;text-decoration:none;'
            f'font-size:14px;padding:10px 16px;border-radius:6px">Abrir planilha com o gráfico completo</a>'
            f'<div style="{fonte}font-size:11px;color:#8a929c;margin-top:16px">Enviado automaticamente em '
            f'{AGORA:%d/%m/%Y %H:%M} a partir do relatório 406 do WebDesktop Nerus.</div></div>')


def main():
    if os.environ.get('TESTE_HTML'):
        html = open(os.environ['TESTE_HTML'], encoding='utf-8').read()
    else:
        html = asyncio.run(baixar_html())
    nomes, dias = ler_dados(html)
    hoje_d, hoje_v = dias[-1]
    total = sum(hoje_v)

    def salvar(nome, texto):
        with open(os.path.join(OUT, nome), 'w', encoding='utf-8') as f:
            f.write(texto)

    # Planilha: uma linha por dia, com cabeçalho
    linhas = [['Data', *nomes, 'Total']] + [[f'{d:%d/%m/%Y}', *v, sum(v)] for d, v in dias]
    with open(os.path.join(OUT, 'dados.csv'), 'w', newline='', encoding='utf-8') as f:
        csv.writer(f).writerows(linhas)

    png = os.path.join(OUT, 'grafico.png')
    desenhar(nomes, dias, png)
    salvar('grafico.b64', base64.b64encode(open(png, 'rb').read()).decode())

    salvar('email.html', montar_email(nomes, dias))
    salvar('email.txt',
           f'Relatório 406 · Posição Diária Suporte · dados até {hoje_d:%d/%m/%Y}\n'
           f'Total: {total} tickets\n' + ' · '.join(f'{n} {v}' for n, v in zip(nomes, hoje_v)) +
           f'\nGráfico anexado. Planilha completa: {PLANILHA}\n')

    resumo = {
        'ultimo_dia': f'{hoje_d:%d/%m/%Y}',
        'total': total,
        'valores': dict(zip(nomes, hoje_v)),
        'assunto': f'Relatório 406 · Posição Diária Suporte · {hoje_d:%d/%m/%Y} · {total} tickets',
        'anexo': f'relatorio406_{hoje_d:%Y-%m-%d}.png',
        'intervalo_planilha': f'Dados!A1:F{len(linhas)}',
        'linhas_planilha': len(linhas),
    }
    salvar('resumo.json', json.dumps(resumo, ensure_ascii=False, indent=1))
    print(json.dumps(resumo, ensure_ascii=False, indent=1))
    print(f'Tamanho do anexo: {os.path.getsize(png) // 1024} KB')


if __name__ == '__main__':
    main()
```
