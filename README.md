# Nerus Tasks

Quadros pessoais no estilo Trello, com **delegação hierárquica** (CEO → Diretores → Gestores → Funcionários), ciente do superior, log imutável e avisos por e-mail.

A especificação completa está em [`docs/especificacao.md`](docs/especificacao.md).

## O que tem nesta versão

- **Meus quadros:** quadros e fases livres (criar, renomear, reordenar, arquivar fase vazia), tarefas com código `NT-000001`, prazo, descrição, checklist, comentários e privacidade. As tarefas se arrastam entre as fases.
- **Delegação:** o botão **Delegar** fica dentro da tarefa e só aceita um subordinado direto. A delegação cria um cartão ligado, com código próprio. A pessoa recebe na **Caixa de entrada**, onde aceita ou devolve com justificativa. Depois de concluída, a tarefa fica aguardando o ciente. Quem delegou pode dar o ciente (arquiva), reabrir com comentário, redelegar ou cancelar.
- **Tarefas delegadas:** tela principal de quem tem subordinados. Mostra o que precisa da sua ação e um grupo por pessoa, com os contadores abertas · atrasadas · aguardando ciente · devolvidas · próprias.
- **Transferir:** para um subordinado, um colega do mesmo nível ou o superior direto. Numa tarefa delegada, quem delegou continua acompanhando.
- **Log:** registro imutável de tudo o que acontece com cada tarefa, garantido por trigger no banco. É visível para a administração, o CEO e a diretoria.
- **Busca** por texto ou código. **Avisos** no app e por e-mail, com o código no assunto.
- **Pessoas (administração):** cadastro com convite por e-mail, transferência de gestão (as delegações em aberto passam ao novo superior) e ativação ou desativação.
- **Interface:** segue o visual aprovado na amostra. Tem controle de tamanho do texto (A− / A+), temas claro e escuro, funciona no celular e pode ser instalada como PWA.

## Rodar localmente

Requisitos: Node 20+ e PostgreSQL 16. O banco pode vir do `docker compose up -d db mail` ou de uma instalação local.

```bash
npm install
cp .env.example .env            # ajuste DATABASE_URL; sem SMTP_HOST os e-mails só aparecem no log
npm run db:seed:demo            # cria o banco e a equipe de exemplo (senha de todos: nerus2026)
npm run dev:api                 # API em http://localhost:3000
npm run dev:web                 # app em http://localhost:5173
```

Na equipe de exemplo, entre como `marina@nerus.com.br` (gestora), `joao@nerus.com.br` (funcionário), `carlos@nerus.com.br` (diretor), `helena@nerus.com.br` (CEO) ou `renata@nerus.com.br` (administração).

Para começar com um banco vazio, sem a equipe de exemplo, crie o primeiro administrador:

```bash
npm run admin:create -- "Nome Completo" email@suaempresa.com.br
```

O comando imprime o link para definir a senha. Depois disso, o restante das pessoas é cadastrado pela tela **Pessoas**.

## Testes

```bash
npm test          # 28 testes da API contra um PostgreSQL real (banco nerus_test)
npm run typecheck
```

O banco de teste é definido por `TEST_DATABASE_URL` (padrão: `postgres://nerus:nerus@localhost:5432/nerus_test`) e é **apagado** a cada execução.

## Produção

O app vira **um único contêiner**: a API serve o front-end compilado e aplica as migrações ao iniciar.

```bash
docker build -t nerus-tasks .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  -e APP_URL=https://tarefas.suaempresa.com.br \
  -e SMTP_HOST=smtp.gmail.com -e SMTP_PORT=587 \
  -e SMTP_USER=tarefas@suaempresa.com.br -e SMTP_PASS=senha-de-app \
  -e MAIL_FROM="Nerus Tasks <tarefas@suaempresa.com.br>" \
  nerus-tasks
```

No **Render** ou no **Railway**, crie um serviço a partir deste repositório usando o `Dockerfile`, adicione um PostgreSQL gerenciado e configure as variáveis acima. O e-mail sai pelo Google Workspace, com uma conta dedicada e uma senha de app. Se o provedor bloquear SMTP no plano escolhido, troque o envio em `apps/api/src/lib/mailer.ts` pela API do Gmail.

Sem compilar, também dá para rodar com `npm run build && npm start`.

## Estrutura

```
apps/api     Fastify + PostgreSQL (regras de negócio, autorização, log, e-mails)
  migrations/  esquema do banco (SQL)
  src/services/ delegação, quadros, tarefas, administração, busca
  test/        testes de API
apps/web     React + Vite (interface e PWA)
docs/        especificação
```

## Decisões provisórias (questões em aberto da especificação)

Para não travar a primeira versão, assumi as respostas abaixo. Todas são fáceis de mudar.

| Questão | Decisão nesta versão |
|---|---|
| Q1: abrangência do log do diretor | Administração e CEO veem todas as tarefas. O diretor vê as da própria diretoria (detentor ou delegador abaixo dele). |
| Q2: como chegar ao log | Abrindo a tarefa, inclusive pela busca por código. A aba **Log** aparece para quem tem acesso. |
| Q3: log de tarefa privada | Fica oculto para todos, menos o dono. |
| Q4: log na cadeia | Cada cartão tem o seu. O cartão de cima registra a delegação para baixo e o cancelamento dela. |
| Q5: edições no log | Guardam o texto antigo e o novo. |
| Q6: tela inicial | Quem tem subordinados abre em **Tarefas delegadas**. Os demais abrem em **Meus quadros**. A administração abre em **Pessoas**. |
| Q7: quem edita o checklist | Só quem tem a tarefa. |
| Q8: contador "próprias" | Só tarefas abertas e não privadas. |
