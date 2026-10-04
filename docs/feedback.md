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

## Terceira rodada (anotado, ainda não implementado)

| # | Ponto | Tela | Status |
|---|---|---|---|
| 7 | **Colunas fixas em Tarefas delegadas.** Hoje as colunas mudam de posição conforme o tamanho do texto: (a) os contadores no cabeçalho de cada pessoa se deslocam (“1 aberta” × “3 abertas”, “0 atrasadas” × “1 atrasada”, e “devolvida” só aparece em alguns), então os números não ficam um embaixo do outro; (b) código e prazo ficam em posições diferentes entre “Precisam da sua ação” (que tem a coluna da pessoa) e “Equipe”; (c) os botões de ação têm larguras diferentes (“Dar ciente / Reabrir” × “Redelegar / Cancelar”) e começam em lugares diferentes. Proposta: largura fixa para cada contador (sempre os mesmos, inclusive “devolvidas” com 0), mesma grade de colunas nas duas seções e botões com largura fixa. | Tarefas delegadas | Anotado |
| 8 | **Difícil identificar de quem são as tarefas em “Equipe”.** O nome da pessoa tem o mesmo peso visual das tarefas e não se destaca. Proposta: (a) cabeçalho de cada pessoa como uma **faixa** com fundo levemente diferente, nome maior e em negrito e avatar maior; (b) uma **linha-guia vertical** ligando o cabeçalho às tarefas daquela pessoa; (c) cabeçalho **fixo no topo ao rolar** (a faixa da pessoa acompanha enquanto se rola pelas tarefas dela). **Decidido: as três juntas (a, b e c).** | Tarefas delegadas | Anotado |
| 9 | Botão no topo para **expandir e recolher todos** os grupos de pessoas de uma vez (“Expandir tudo” / “Recolher tudo”). A escolha fica lembrada. | Tarefas delegadas | Anotado |
| 10 | **Reordenar tarefas dentro da mesma fase arrastando**, para organizar prioridades. Hoje o arrastar só funciona bem entre fases: ao soltar sobre um cartão, a tarefa entra *antes* dele, então descer uma posição parece não fazer nada, e não há indicação de onde ela vai cair. Proposta: linha indicando a posição de destino (acima ou abaixo do cartão, conforme a metade em que o mouse está), soltar no fim da fase funcionando sempre, e no cartão aberto as opções “Mover para o topo / para o fim” (útil no celular). | Meus quadros | Anotado |
| 11 | **Ordenar as tarefas** por nome, data de criação ou prazo (data de conclusão esperada). Proposta (a confirmar): no menu “…” de cada fase, “Ordenar por…”, que reorganiza a fase de uma vez (como no Trello); depois disso, ainda dá para arrastar à mão. | Meus quadros | Anotado — detalhes a confirmar |
| 12 | **Cor de fundo por quadro.** Proposta: no menu “…” do quadro, “Cor do quadro”, com uma paleta de cores suaves que funcionam nos temas claro e escuro. A cor é do quadro (vale em qualquer computador), não do navegador. | Meus quadros | Anotado |
| 13 | **Mudar o nome do aplicativo para SyncTask**, com o logo de referência (`docs/synctask-logo-referencia.png`): símbolo de infinito com um “check”, em degradê azul → verde-água. Abrange: nome em todas as telas, título da aba, ícones do PWA e favicon (redesenhar o símbolo em vetor, sem o texto, para ficar nítido em qualquer tamanho), e-mails, Ajuda, README e especificação. A decidir: prefixo do código das tarefas (manter `NT-` ou mudar para `ST-`), endereço no Render (hoje `nerus-tasks.onrender.com`) e se a cor de destaque do app passa a seguir o azul/verde do logo. | Todas | Anotado — detalhes a confirmar |

**Padrões a usar no build, salvo indicação em contrário:** item 11 — ordenação por fase, reorganizando de uma vez (o arrastar continua valendo depois); item 13 — prefixo `ST-`, endereço do Render mantido por enquanto, cor de destaque adaptada ao azul/verde-água do logo.
