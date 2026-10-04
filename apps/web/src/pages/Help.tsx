import type { ReactNode } from 'react';
import { StatusIcon, TipIcon } from '../components/ui';

const SECTIONS: [string, string][] = [
  ['inicio', 'Primeiros passos'],
  ['quadros', 'Meus quadros'],
  ['trello', 'Importar do Trello'],
  ['entrada', 'Caixa de entrada'],
  ['delegar', 'Delegar'],
  ['acompanhar', 'Tarefas delegadas'],
  ['concluir', 'Concluir, ciente e reabrir'],
  ['devolver', 'Devolver e transferir'],
  ['codigo', 'Código, busca e avisos'],
  ['privacidade', 'Privacidade e log'],
  ['icones', 'Ícones'],
  ['glossario', 'Glossário'],
  ['admin', 'Manual do administrador'],
  ['faq', 'Perguntas frequentes'],
];

function go(id: string) {
  document.getElementById(`ajuda-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Sec({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`ajuda-${id}`} style={{ scrollMarginTop: 16 }}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function HelpPage({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="page help">
      <p style={{ marginTop: 0 }}>
        O Nerus Tasks junta duas coisas: <b>quadros pessoais</b>, onde cada um organiza o próprio trabalho como quiser, e{' '}
        <b>delegação</b>, para quem tem equipe saber o que entregou a cada pessoa e em que pé está.
      </p>

      <div className="roles">
        <button onClick={() => go('quadros')}><b>Sou funcionário</b><span>Organizar tarefas e responder delegações</span></button>
        <button onClick={() => go('delegar')}><b>Sou gestor</b><span>Delegar e acompanhar a equipe</span></button>
        <button onClick={() => go('acompanhar')}><b>Sou diretor ou CEO</b><span>Acompanhar e consultar o log</span></button>
        <button onClick={() => go('admin')}><b>Sou da administração</b><span>{isAdmin ? 'Cadastrar pessoas e gestão' : 'Manual do administrador'}</span></button>
      </div>
      <nav className="toc" aria-label="Seções da ajuda">
        {SECTIONS.map(([id, t]) => <button key={id} className="link" onClick={() => go(id)}>{t}</button>)}
      </nav>

      <Sec id="inicio" title="Primeiros passos">
        <ol>
          <li>Você recebe um e-mail com o link para <b>definir sua senha</b>. Depois, entre com seu e-mail e senha.</li>
          <li>No menu à esquerda ficam <b>Meus quadros</b>, a <b>Caixa de entrada</b>, <b>Tarefas delegadas</b> (só para quem tem equipe) e <b>Avisos</b>.</li>
          <li>O menu pode ser recolhido pelo botão <b>Recolher menu</b>, no rodapé dele. Recolhido, ele mostra só os ícones.</li>
          <li>No topo, à direita, ficam a <b>busca</b>, o tamanho do texto (<b>A−</b> / <b>A+</b>) e o botão de <b>tema</b>: automático (segue o Windows), claro ou escuro. Cada clique troca o tema.</li>
        </ol>
      </Sec>

      <Sec id="quadros" title="Meus quadros">
        <p>Cada pessoa tem seus quadros e organiza como quiser. Ninguém mais vê os seus quadros.</p>
        <ul>
          <li><b>Novo quadro:</b> clique em <b>+ Quadro</b>. Ele começa com as fases A fazer, Fazendo e Feito.</li>
          <li><b>Fases:</b> crie com <b>+ Nova fase</b>. No menu <b>…</b> de cada fase dá para renomear, mover para a esquerda ou direita e arquivar. Só é possível arquivar uma fase vazia.</li>
          <li><b>Nova tarefa:</b> clique em <b>+ Adicionar tarefa</b> no fim de uma fase, digite o título e tecle Enter.</li>
          <li><b>Mover:</b> arraste a tarefa para outra fase. No celular, abra a tarefa e escolha a fase no campo <b>Fase</b>.</li>
          <li><b>Abrir:</b> clique no título. Ali você edita título, descrição e prazo, monta o <b>checklist</b> e comenta.</li>
          <li><b>Concluir:</b> clique no círculo à esquerda do título, ou em <b>Concluir</b> dentro da tarefa. A fase não define se a tarefa está concluída: concluir é sempre um clique explícito.</li>
        </ul>
      </Sec>

      <Sec id="trello" title="Importar do Trello">
        <p>Dá para trazer um quadro do Trello para os seus quadros. Cada quadro do Trello vira um quadro novo seu.</p>
        <ol>
          <li>No Trello, abra o quadro, clique no menu <b>…</b> e escolha <b>Imprimir, exportar e compartilhar</b> → <b>Exportar como JSON</b>. Salve o arquivo.</li>
          <li>Aqui, em <b>Meus quadros</b>, clique em <b>Importar do Trello</b> e escolha o arquivo.</li>
          <li>Confira a pré-visualização, ajuste o nome do quadro se quiser e clique em <b>Importar</b>.</li>
        </ol>
        <ul>
          <li><b>Vêm:</b> listas (viram fases), cartões com título, descrição e prazo, cartões marcados como entregues (chegam concluídos), checklists e comentários.</li>
          <li><b>Comentários</b> entram em seu nome, com o autor e a data originais no texto.</li>
          <li><b>Membros</b> dos cartões ficam anotados na descrição. Todas as tarefas ficam com você; para entregar a alguém da equipe, use <b>Delegar</b>.</li>
          <li><b>Ficam de fora:</b> listas e cartões arquivados, etiquetas e anexos.</li>
          <li>Cada tarefa importada ganha um código novo, e o log registra que veio do Trello.</li>
        </ul>
      </Sec>

      <Sec id="entrada" title="Caixa de entrada">
        <p>Tarefas que alguém delegou ou transferiu para você chegam aqui primeiro. Para cada uma:</p>
        <ul>
          <li><b>Aceitar e organizar:</b> escolha o quadro e a fase. A tarefa vai para lá.</li>
          <li><b>Devolver:</b> só para tarefas delegadas. Escreva a justificativa (obrigatória). A tarefa volta para quem delegou.</li>
        </ul>
        <p>O prazo vem sugerido por quem delegou. Você pode ajustá-lo dentro da tarefa, e quem delegou recebe um aviso.</p>
      </Sec>

      <Sec id="delegar" title="Delegar uma tarefa">
        <p>Quem tem equipe pode delegar. A delegação vai sempre para um <b>subordinado direto</b>: o gestor delega aos funcionários dele, o diretor aos gestores dele.</p>
        <ol>
          <li>Crie a tarefa no seu quadro (ou use uma que você recebeu).</li>
          <li>Abra a tarefa e clique em <b>Delegar</b>.</li>
          <li>Escolha a pessoa, o prazo sugerido e, se quiser, uma observação.</li>
        </ol>
        <p>A pessoa recebe um <b>cartão ligado ao seu</b>, com código próprio, e é avisada no app e por e-mail. O seu cartão continua no seu quadro com o ícone de “repassada para”.</p>
        <p className="ex">Exemplo: o diretor delega “Orçamento 2027” ao gestor. O gestor abre essa tarefa e delega parte dela ao funcionário. Cada nível dá o ciente no nível de baixo antes de concluir o seu.</p>
      </Sec>

      <Sec id="acompanhar" title="Tarefas delegadas (para quem tem equipe)">
        <p>Esta é a tela para responder “o que eu deleguei e ainda não foi concluído?”.</p>
        <ul>
          <li><b>Precisam da sua ação:</b> tarefas concluídas aguardando o seu ciente e tarefas devolvidas.</li>
          <li><b>Equipe:</b> um grupo por pessoa, com os contadores <b>abertas · atrasadas · aguardando ciente · devolvidas · próprias</b>. “Próprias” é só a quantidade de tarefas que a pessoa criou para si (o conteúdo é dela).</li>
          <li>Clique no nome da pessoa para recolher ou expandir. Marque <b>Mostrar arquivadas e canceladas</b> para ver o histórico.</li>
        </ul>
        <p>Diretores e CEO também abrem a aba <b>Log</b> das tarefas da sua linha. Veja <button className="link" onClick={() => go('privacidade')}>Privacidade e log</button>.</p>
      </Sec>

      <Sec id="concluir" title="Concluir, ciente e reabrir">
        <ol>
          <li>Quem recebeu conclui a tarefa. Ela fica <b>aguardando ciente</b>.</li>
          <li>Quem delegou recebe o aviso e escolhe:
            <ul>
              <li><b>Dar ciente:</b> valida a entrega. A tarefa é <b>arquivada</b> e a pessoa é avisada.</li>
              <li><b>Reabrir:</b> não aceita a entrega. Escreva o motivo; a tarefa volta para a pessoa como “reaberta”.</li>
            </ul>
          </li>
        </ol>
        <p>Enquanto ninguém der o ciente, a tarefa continua em “Precisam da sua ação”.</p>
        <p>Para uma tarefa devolvida, quem delegou pode <b>Redelegar</b> (para a mesma ou outra pessoa, mantendo o código) ou <b>Cancelar</b>.</p>
      </Sec>

      <Sec id="devolver" title="Devolver e transferir">
        <dl>
          <dt>Devolver</dt>
          <dd>Recusar uma tarefa delegada a você, com justificativa. Ela volta para quem delegou.</dd>
          <dt>Transferir</dt>
          <dd>Passar uma tarefa para outra pessoa: um subordinado seu, um colega do mesmo nível ou o seu superior direto. Quem transfere deixa de acompanhar. Se a tarefa tinha sido delegada, quem delegou continua acompanhando e vê o novo responsável.</dd>
          <dt>Delegar</dt>
          <dd>Diferente de transferir: você continua acompanhando até dar o ciente.</dd>
        </dl>
      </Sec>

      <Sec id="codigo" title="Código, busca e avisos">
        <ul>
          <li>Toda tarefa tem um <b>código único</b>, como <code>NT-000123</code>. Ele nunca muda e nunca é reutilizado.</li>
          <li>Na <b>busca</b>, digite o código (também vale só o número, como <kbd>123</kbd>) ou uma palavra do título ou da descrição. Aparecem só tarefas que você pode ver.</li>
          <li><b>Avisos</b> chegam no app e por e-mail quando: uma tarefa é delegada a você, devolvida, concluída, reaberta, arquivada com ciente, cancelada, transferida para você, ou quando o prazo de uma tarefa que você delegou muda.</li>
        </ul>
      </Sec>

      <Sec id="privacidade" title="Privacidade e log">
        <ul>
          <li>Seus quadros são só seus. Quem está acima de você vê <b>apenas as tarefas que delegou a você</b> e quantas tarefas próprias você tem.</li>
          <li>Marque uma tarefa como <b>Privada</b> (dentro dela) para que nem esse número a conte. Tarefas recebidas por delegação não podem ser privadas.</li>
          <li>O <b>log</b> registra tudo o que acontece com cada tarefa: quem fez, quando e o que mudou. Ninguém consegue alterar ou apagar o log.</li>
          <li>O log é visível para a administração, o CEO e os diretores (das tarefas da própria diretoria). O log de tarefas privadas não é exibido.</li>
        </ul>
      </Sec>

      <Sec id="icones" title="Ícones">
        <dl>
          <dt><StatusIcon status="active" /> Relógio</dt><dd>Em andamento</dd>
          <dt><StatusIcon status="inbox" /> Caixa</dt><dd>Aguardando aceite na caixa de entrada</dd>
          <dt><StatusIcon status="awaiting" /> Ampulheta</dt><dd>Concluída, aguardando ciente (âmbar: pede ação)</dd>
          <dt><StatusIcon status="declined" /> Seta de volta</dt><dd>Devolvida com justificativa (âmbar: pede ação)</dd>
          <dt><StatusIcon status="reopened" /> Seta circular</dt><dd>Reaberta para ser refeita</dd>
          <dt><StatusIcon status="acked" /> Arquivo</dt><dd>Ciente dado, tarefa arquivada</dd>
          <dt><TipIcon name="into" tip="Delegada por" /> Seta entrando</dt><dd>Delegada a você por alguém acima</dd>
          <dt><TipIcon name="out" tip="Repassada para" /> Seta saindo</dt><dd>Você delegou para alguém da sua equipe</dd>
          <dt><TipIcon name="lock" tip="Privada" /> Cadeado</dt><dd>Tarefa privada</dd>
          <dt><span className="due late">3 out</span></dt><dd>Prazo em vermelho: atrasada</dd>
        </dl>
        <p>Passe o mouse (ou toque) em qualquer ícone ou botão para ver uma explicação.</p>
      </Sec>

      <Sec id="glossario" title="Glossário">
        <dl>
          <dt>Quadro</dt><dd>Seu espaço de organização. Você cria quantos quiser.</dd>
          <dt>Fase</dt><dd>Coluna do quadro, com o nome que você quiser.</dd>
          <dt>Detentor</dt><dd>Quem está com a tarefa agora.</dd>
          <dt>Delegador</dt><dd>Quem delegou e acompanha a tarefa.</dd>
          <dt>Ciente</dt><dd>A validação de quem delegou sobre uma entrega. Arquiva a tarefa.</dd>
          <dt>Cartão ligado</dt><dd>O cartão que o subordinado recebe ao ser delegado, ligado ao cartão de quem delegou.</dd>
        </dl>
      </Sec>

      <Sec id="admin" title="Manual do administrador">
        <p>A tela <b>Pessoas</b> aparece só para quem tem permissão de administração.</p>
        <h3>Cadastrar uma pessoa</h3>
        <ol>
          <li>Em <b>Pessoas</b>, clique em <b>Nova pessoa</b>.</li>
          <li>Preencha nome, e-mail e nível (CEO, Diretor, Gestor ou Funcionário). O cargo exibido é opcional.</li>
          <li>Escolha o <b>superior direto</b>. Ele precisa estar no nível imediatamente acima: o superior de um funcionário é um gestor, o de um gestor é um diretor, o de um diretor é o CEO.</li>
          <li>Marque <b>Também é administrador</b> se a pessoa for cuidar do cadastro.</li>
          <li>Clique em <b>Cadastrar</b>. A pessoa recebe um e-mail com o link para definir a senha (válido por 72 horas).</li>
        </ol>
        <p>Cadastre de cima para baixo: primeiro o CEO, depois os diretores, os gestores e os funcionários. Se o link expirar, use <b>Reenviar convite</b> no menu <b>…</b> da pessoa.</p>
        <h3>Transferir gestão (mudança de gestor)</h3>
        <ol>
          <li>No menu <b>…</b> da pessoa, escolha <b>Transferir gestão</b>.</li>
          <li>Escolha o novo superior direto e confirme.</li>
        </ol>
        <p>As tarefas que o superior antigo tinha delegado e ainda estão em aberto passam para o novo, que continua o acompanhamento. O histórico e as tarefas já arquivadas ficam com o antigo. Os três são avisados.</p>
        <h3>Desativar ou reativar</h3>
        <p>No menu <b>…</b>, escolha <b>Desativar</b>. A pessoa deixa de entrar no app, e os registros dela no log são mantidos.</p>
        <p>Não é possível desativar quem ainda tem subordinados ou tarefas delegadas em aberto. Antes, transfira a gestão dos subordinados e resolva ou transfira as tarefas. O app lista o que falta.</p>
        <h3>Senhas</h3>
        <p>Quem esquecer a senha usa <b>Esqueci minha senha</b> na tela de login e recebe um link por e-mail, válido por 2 horas. A administração não vê nem define senhas.</p>
      </Sec>

      <Sec id="faq" title="Perguntas frequentes">
        <h3>Não aparece o botão Delegar.</h3>
        <p>Ele só aparece para quem tem subordinados diretos, em tarefas não concluídas e que ainda não estão delegadas.</p>
        <h3>Meu superior vê o meu quadro?</h3>
        <p>Não. Ele vê só as tarefas que delegou a você e a quantidade das suas tarefas próprias (sem as privadas).</p>
        <h3>Posso mudar o prazo de uma tarefa que recebi?</h3>
        <p>Pode. Quem delegou recebe um aviso com o prazo antigo e o novo.</p>
        <h3>Concluí por engano.</h3>
        <p>Abra a tarefa e clique em <b>Desfazer conclusão</b>. Depois que quem delegou deu o ciente, não é mais possível.</p>
        <h3>O app demorou para abrir.</h3>
        <p>Na versão de teste, o servidor “dorme” depois de alguns minutos sem uso e leva cerca de um minuto para acordar.</p>
      </Sec>
    </div>
  );
}
