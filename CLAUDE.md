# SyncTasks — contexto para o Claude

App de tarefas da **Nerus** (~90–99 pessoas): quadros pessoais no estilo Trello + **delegação hierárquica** (CEO > Diretores > Gestores > Funcionários). Antes se chamava “Nerus Tasks”.

- Especificação completa e regras de negócio (RN-01…): `docs/especificacao.md`
- Histórico de pedidos e o que foi feito, por rodada: `docs/feedback.md`
- Como rodar, testar e publicar: `README.md`

## Como o dono do projeto trabalha

- Fala em **português**, usa **Windows**, não é programador: explique em linguagem simples, com passo a passo clicável.
- Fluxo combinado: quando ele diz **“anote”**, só registre o ponto em `docs/feedback.md` (próximo número, status “Anotado”, com proposta e recomendação) — **não implemente**. Implemente só quando ele disser **“build”** / “pode fazer o build”; depois marque “Implementado” e escreva a seção “Como ficou”.
- Quando houver escolha, dê opções com uma recomendação; se ele não escolher, siga a recomendação e anote isso.
- Depois do build: rodar typecheck, testes e roteiros de tela (`npm run test:telas`), depois commit e push. O GitHub roda a verificação e o Render só publica se ela passar.

## Regras de negócio que mais pesam

- Quadros e fases livres e **pessoais** (ninguém vê o quadro de outro). Tarefa tem só dois estados: concluída ou não.
- **Delegar** só de dentro de uma tarefa, só para **subordinado direto**, uma pessoa. Cria um **cartão ligado** com código próprio na caixa de entrada do subordinado (aceitar ou devolver com justificativa).
- Concluir → “aguardando ciente” → o delegador dá **ciente** (arquiva) ou **reabre** com comentário. Redelegar mantém o código; cancelar existe.
- **Transferir** ≠ delegar: para subordinado, colega do mesmo nível ou superior direto; quem transfere deixa de acompanhar.
- Superior vê só **as próprias delegações** + contador de tarefas próprias dos subordinados diretos. Tarefas privadas nunca aparecem.
- **Log imutável** por tarefa, visível só para admin, CEO e diretores.
- Código único `ST-000001` (antes `NT-`, ainda aceito), nunca reutilizado.

## Técnica

- Monorepo npm workspaces: `apps/api` (Fastify 5, PostgreSQL via `pg`, zod, nodemailer, TypeScript ESM) e `apps/web` (React 18, Vite, TanStack Query, CSS puro em `src/styles.css`, roteamento por hash).
- Migrações SQL em `apps/api/migrations` (aplicadas ao iniciar; **nunca edite uma migração já publicada**, crie a próxima).
- Comandos: `npm run typecheck`, `npm test` (API usa Postgres real, banco `nerus_test`; se cair com ECONNREFUSED, `service postgresql start`), `npm run build`, `npm run test:telas` (roteiros Playwright em `e2e/`, depois do build), `npm run test:carga` (sob demanda).
- Testes intensivos (item 28): `permissions.test.ts` falha se surgir rota nova sem teste de permissão; `chaos.test.ts` sorteia ações e confere regras invariáveis. Ao mudar uma tela, ajuste o roteiro dela em `e2e/tests/`.
- Segurança: cookie `synctasks_sid` (httpOnly), cabeçalho obrigatório `X-SyncTasks: 1` em requisições que alteram dados.
- “Hoje” é sempre o dia em **America/Sao_Paulo**.

## Publicação

- Render, Blueprint em `render.yaml`: serviço **synctasks** → https://synctasks.onrender.com. Publica a partir da branch `claude/tender-volta-yd7999`.
- Site comercial: pasta `site/` (HTML e CSS estáticos), serviço estático **synctasks-site** no mesmo `render.yaml` → https://synctasks-site.onrender.com. Plano Equipe: R$ 20,00 por usuário/mês; limite do plano Grátis e contato ainda em `[colchetes]`; os botões “Começar” levam ao app por enquanto.
- Banco no Render: `nerus-db` (nome mantido de propósito). **O banco gratuito expira no início de novembro de 2026** — lembrar o dono de migrar para plano pago ou exportar antes.
- `SEED_DEMO=true` cria a equipe de exemplo (senha `nerus2026`: marina, joao, carlos, helena, renata `@nerus.com.br`). Para uso real: `SEED_DEMO=false` e criar o administrador.
- E-mail: SMTP do Google Workspace ainda não configurado (sem `SMTP_HOST` os e-mails só vão para o log).

## Pendências conhecidas

- Captura de e-mail por encaminhamento e complemento do Gmail: para depois, conforme o uso (item 21).
- Extensão do Chrome para captura: para depois (item 14).
- Fora por enquanto: anexos/Google Drive, indicador de entregas no prazo, visão da cadeia inteira para diretor/CEO.
