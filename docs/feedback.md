# Feedback do teste no Render

Pontos levantados no teste da primeira versão (https://nerus-tasks.onrender.com). Os itens 1 a 6 foram implementados na segunda rodada.

| # | Ponto | Tela | Status |
|---|---|---|---|
| 1 | A barra lateral precisa ser retrátil (recolher e expandir). | Todas | Implementado |
| 2 | A borda dos cartões de tarefa precisa ser mais grossa, para destacar melhor cada tarefa. | Meus quadros | Implementado |
| 3 | A tela está muito escura. Incluir opção para escolher a cor de fundo (tema): claro, escuro ou automático. Hoje o app segue o tema do Windows. | Todas | Implementado |
| 4 | O site precisa ser bem documentado: (a) **ajuda dentro do app** para quem usa — cada tela, os conceitos (delegar, ciente, devolver, transferir) e passo a passo por papel (funcionário, gestor, diretor), com dicas nos botões; (b) **manual do administrador** — cadastrar pessoas, transferir gestão, desativar. Documentação técnica fica para depois. | Todas | Implementado |
| 5 | Sobra espaço útil no topo da tela: a busca e o A−/A+ ficam numa linha própria, acima do título, e o subtítulo ocupa mais uma linha. Compactar o cabeçalho (título, busca e A−/A+ na mesma linha) para dar mais altura às tarefas. | Todas | Implementado |
| 6 | **Bug (visto no print do item 5):** cada coluna do quadro mostra uma barra de rolagem horizontal desnecessária, e a rolagem vertical da coluna aparece mesmo com espaço livre abaixo. No Windows, essas barras ficam sempre visíveis. | Meus quadros | Implementado |

## Como ficou

1. **Barra lateral retrátil:** botão **Recolher menu** no rodapé dela. Recolhida, mostra só os ícones (com os contadores) e o nome aparece ao passar o mouse. A escolha fica lembrada no navegador.
2. **Borda mais grossa:** os cartões de tarefa têm borda de 2 px, com cor mais visível nos dois temas.
3. **Tema:** botão no topo, à direita, alterna entre automático (segue o Windows), claro e escuro. A escolha fica lembrada.
4. **Documentação:** nova página **Ajuda** (rodapé da barra lateral), com atalhos por papel, explicação de cada tela e conceito, ícones, glossário, perguntas frequentes e o **manual do administrador**. Os botões de ação mostram uma dica ao passar o mouse.
5. **Cabeçalho compacto:** título, busca, A−/A+ e tema na mesma linha; subtítulos removidos.
6. **Barras de rolagem nas colunas:** a causa eram as dicas dos ícones, que mesmo invisíveis ocupavam espaço. Agora a dica só existe enquanto aparece, e as barras de rolagem que sobram são finas.
