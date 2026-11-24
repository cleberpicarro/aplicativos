# SyncTasks e Trello: o que é igual, o que muda e como migrar

Texto curto para explicar o SyncTasks a quem já usa o Trello. Escrito em 24/11/2026, com base no que o app faz hoje.

## 1. O que é parecido com o Trello

- **Quadros, fases e tarefas.** Você monta quadros com fases (as “listas” do Trello) e tarefas (os “cartões”). Os nomes e a quantidade são livres.
- **Arrastar e soltar.** Tarefas e fases se movem arrastando com o mouse.
- **Dentro da tarefa:** título, descrição (links viram clicáveis), prazo, checklist, comentários e cor.
- **Filtro no quadro e arquivadas.** Dá para filtrar o que aparece e consultar o que já saiu do quadro.
- **Atalhos de teclado e uso no celular.**

Quem sabe usar o Trello começa a usar o SyncTasks sem treinamento.

## 2. O que o SyncTasks tem a mais para uma empresa

O Trello é um quadro compartilhado. O SyncTasks foi feito para **quem manda tarefa para quem** dentro de uma hierarquia (CEO, diretores, gestores e funcionários).

1. **Delegar com responsável certo.** De dentro de uma tarefa, você entrega para um subordinado direto. Ele recebe um cartão ligado ao seu, com código próprio (ST-000123), e aceita ou devolve explicando o motivo.
2. **Caixa de entrada.** Tudo o que chega para a pessoa cai num lugar só, para aceitar, organizar no quadro, delegar adiante ou descartar.
3. **Fechamento com ciente.** Quando o subordinado conclui, a tarefa fica “aguardando ciente”. Quem delegou dá o ciente (e ela é arquivada) ou reabre com um comentário. Nada some sem o chefe ver.
4. **Tarefas delegadas.** Uma tela mostra tudo o que você delegou, o que está atrasado e o que precisa da sua ação, além de quantas tarefas próprias cada subordinado direto tem.
5. **Cobrar.** Um botão manda na hora um balão, um aviso e um e-mail para quem está com a tarefa, com um recado opcional. Fica registrado.
6. **Transferir.** Passar a tarefa para um subordinado, um colega do mesmo nível ou o superior direto, deixando de acompanhar.
7. **Privacidade.** Cada pessoa vê só os próprios quadros. O chefe vê o que ele delegou, não o quadro inteiro do subordinado. Tarefas marcadas como privadas não aparecem para ninguém.
8. **Histórico que não se apaga.** Toda tarefa tem um log imutável (quem fez o quê e quando), que só administradores, CEO e diretores consultam. Tarefa não se apaga: no máximo é descartada e vai para as arquivadas.
9. **Substituto em férias.** Quem sai escolhe um substituto, que passa a ver e agir pela pessoa (a caixa de entrada, os quadros, as delegadas). Tarefas privadas continuam escondidas.
10. **Seguidores por e-mail.** Pessoas com e-mail @nerus.com.br podem acompanhar uma tarefa pelo e-mail, mesmo sem usar o app.
11. **Avisos e resumo diário.** E-mail com o resumo do dia, avisos de prazo e de delegação, e destaque em cor para tarefas atrasadas ou que vencem hoje (o administrador liga ou desliga).
12. **Tarefas que se repetem.** Todo dia útil, toda semana, todo mês ou a cada N dias: ao concluir, nasce a próxima.
13. **Visão do administrador.** Organograma da equipe, tela de Uso da plataforma (quem usou e quanto, por dia ou mês) e Configurações com avisos de problemas.
14. **Assistentes de IA.** O SyncTasks se liga ao Claude e a outros assistentes, que podem listar quadros, ver e criar tarefas por você (com a sua permissão).
15. **Capturar da web.** Um botão no navegador cria uma tarefa a partir da página que você está vendo.
16. **Cópia de segurança semanal** dos dados, guardada com senha.

## 3. Como trazer os quadros do Trello para o SyncTasks

A importação é feita **um quadro por vez**, e cada quadro do Trello vira um **quadro novo** seu no SyncTasks. Os quadros que você já tem não mudam.

### Passo a passo

1. **No Trello:** abra o quadro, clique no menu **…** (canto de cima, à direita) e escolha **Imprimir, exportar e compartilhar** e depois **Exportar como JSON**. Salve o arquivo no computador.
2. **No SyncTasks:** vá em **Tarefas**, abra o menu **…** do quadro e clique em **Importar arquivo JSON**.
3. Escolha o arquivo salvo. O app mostra um resumo do que vai entrar (fases, tarefas, itens de checklist, comentários) e do que vai ficar de fora.
4. Ajuste o nome do novo quadro, se quiser, e clique em **Importar**.
5. Repita para cada quadro do Trello.

### O que vem

- As listas viram fases, na mesma ordem. As tarefas vêm na mesma ordem dentro de cada fase.
- Título, descrição, prazo (só o dia; o horário do Trello não vem) e se estava concluída (marcado como “concluída” no prazo do Trello).
- Checklist com os itens marcados e desmarcados. Se o cartão tinha mais de um checklist, eles viram uma lista só, com o nome de cada um na frente do item.
- Comentários. Eles entram no seu nome, com o autor e a data originais escritos no texto.
- Os **membros** do cartão ficam anotados no fim da descrição (“Membros no Trello: …”).

### O que não vem

- Cartões, listas e quadros **arquivados** no Trello.
- **Etiquetas** e **anexos** (o resumo avisa quantos ficaram de fora).
- **Delegações:** todas as tarefas importadas ficam com quem importou. Para entregar a alguém da equipe, abra a tarefa e use **Delegar**.
- Quem estava como membro no Trello não ganha a tarefa automaticamente (fica só o nome na descrição).

### Limites e cuidados

- Até **5.000 tarefas** e **100 listas** por quadro importado, e arquivo de até cerca de **20 MB**.
- Por tarefa: título de até 200 letras, descrição de até 20.000, até 300 itens de checklist e os 500 comentários mais recentes. O que passa disso é cortado.
- O Trello pode não colocar no arquivo os comentários muito antigos de quadros com muito movimento; confira os cartões mais importantes depois de importar.
- Cartão que estava numa lista “Feito” mas sem o prazo marcado como concluído entra como **não concluído**.
- Administradores que estão fora da hierarquia não têm quadros, então não conseguem importar.
- Cada tarefa importada ganha um número novo, e o log registra que ela veio do Trello.
