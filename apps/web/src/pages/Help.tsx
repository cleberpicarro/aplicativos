import type { ReactNode } from 'react';
import { StatusIcon, TipIcon } from '../components/ui';
import { Icon } from '../components/Icons';
import { BookmarkletButton } from './Capture';

const SECTIONS: [string, string][] = [
  ['inicio', 'Primeiros passos'],
  ['quadros', 'Tarefas: quadros'],
  ['filtro-quadro', 'Filtro no quadro'],
  ['tabela', 'Tarefas: tabela e filtros'],
  ['arquivadas', 'Arquivadas'],
  ['trello', 'Exportar e importar (JSON)'],
  ['capturar', 'Capturar da web'],
  ['assistente', 'Claude e outros assistentes'],
  ['entrada', 'Caixa de entrada'],
  ['delegar', 'Delegar'],
  ['painel', 'Painel'],
  ['acompanhar', 'Tarefas delegadas'],
  ['concluir', 'Concluir, ciente e reabrir'],
  ['devolver', 'Devolver e transferir'],
  ['codigo', 'Código, busca e avisos'],
  ['atalhos', 'Atalhos de teclado'],
  ['ferias', 'Férias e ausências'],
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
        O SyncTasks junta duas coisas: <b>quadros pessoais</b>, onde cada um organiza o próprio trabalho como quiser, e{' '}
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
          <li>Você recebe um e-mail com o link para <b>definir sua senha</b>. Depois, entre com seu e-mail e senha. O <b>olho</b> no fim do campo de senha mostra o que você digitou; clique de novo para ocultar.</li>
          <li>No menu à esquerda ficam o <b>Painel</b> e as <b>Tarefas delegadas</b> (só para quem tem equipe), <b>Tarefas</b>, a <b>Caixa de entrada</b>, as <b>Arquivadas</b> e <b>Avisos</b>. Todo mundo começa pelas próprias <b>Tarefas</b>; o Painel fica a um clique, no menu.</li>
          <li>O menu pode ser recolhido pelo botão <b>Recolher menu</b>, no rodapé dele. Recolhido, ele mostra só os ícones.</li>
          <li>No celular, o menu fica no botão <b>☰</b> (3 barrinhas), no alto à esquerda. Um número laranja nele mostra quanta coisa espera por você. Toque para abrir; ele fecha no <b>X</b>, tocando fora dele, com o botão <b>Voltar</b> do celular ou ao escolher uma tela.</li>
          <li>No topo, à direita, ficam a <b>busca</b>, o tamanho do texto (<b>A−</b> / <b>A+</b>) e o botão de <b>tema</b>: automático (segue o Windows), claro ou escuro. Cada clique troca o tema.</li>
        </ol>
      </Sec>

      <Sec id="quadros" title="Tarefas: quadros">
        <p>Cada pessoa tem seus quadros e organiza como quiser. Ninguém mais vê os seus quadros. Em <b>Tarefas</b>, a chave <b>Quadro / Tabela</b>, no topo à direita, troca entre os quadros (kanban) e a <b>tabela</b> com todas as tarefas; a escolha fica lembrada neste computador.</p>
        <ul>
          <li><b>Novo quadro:</b> clique em <b>+ Quadro</b>, à direita das abas. Ele começa com as fases A fazer, Fazendo e Feito.</li>
          <li><b>Menu do quadro:</b> no botão <b>…</b> à direita das abas dá para renomear o quadro, escolher a <b>cor do quadro</b>, criar uma nova fase, mover o quadro para a esquerda ou a direita e escolher o <b>fundo da área de trabalho</b> (vale para todas as telas e fica guardado na sua conta).</li>
          <li><b>Arquivar quadro:</b> no fim do menu <b>…</b> do quadro. Só funciona com o quadro <b>vazio</b>: arquive as tarefas concluídas e mova as abertas para outro quadro antes. O seu último quadro não pode ser arquivado. O aviso traz <b>Desfazer</b>; depois, o quadro fica em <b>Arquivadas</b>, de onde volta com <b>Desarquivar</b> (como a última aba, com fases e cor).</li>
          <li><b>Zoom do quadro:</b> à direita das abas, <b>−</b> e <b>+</b> diminuem ou aumentam as fases e os cartões (de 70% a 130%) para ver mais fases de uma vez. Clique no número (por exemplo, <b>80%</b>) para voltar a 100%. O zoom fica guardado neste computador e vale para todos os quadros.</li>
          <li><b>Ordem dos quadros:</b> arraste a aba de um quadro para a esquerda ou a direita. Uma linha azul mostra onde ela vai entrar.</li>
          <li><b>Fases:</b> arraste a fase pelo <b>nome</b> para a esquerda ou a direita para mudar a ordem; uma linha azul mostra onde ela vai entrar, e as tarefas vão junto. No menu <b>…</b> de cada fase dá para renomear, mover para a esquerda ou direita (o jeito no celular), <b>ordenar por</b> nome, data de criação ou prazo, e arquivar. Ordenar reorganiza a fase uma vez; depois você continua arrastando à vontade. Só é possível arquivar uma fase vazia.</li>
          <li><b>Nova tarefa:</b> clique em <b>+ Adicionar tarefa</b> no fim de uma fase, digite o título e tecle Enter. Se clicar fora do campo com o título digitado, a tarefa também é criada; para desistir, tecle <b>Esc</b> ou clique em <b>Cancelar</b>. Na <b>Nova fase</b> e no <b>Novo quadro</b>, clicar fora da janela com o nome digitado também cria.</li>
          <li><b>Várias de uma vez:</b> cole ou escreva uma lista, uma tarefa por linha (<b>Shift+Enter</b> pula linha). Ao teclar Enter, o app pergunta se cria <b>uma tarefa por linha</b> ou <b>uma tarefa só</b>, com a primeira linha como título e o resto na descrição. Linhas em branco e marcadores como “-”, “•” e “1.” são ignorados; até 50 por vez, com <b>Desfazer</b> no aviso.</li>
          <li><b>Mover e priorizar:</b> arraste a tarefa para outra fase ou para cima e para baixo na mesma fase. Uma linha azul mostra onde ela vai cair.</li>
          <li><b>Mover para outro quadro:</b> abra a tarefa e use <b>Mover para</b>: escolha o quadro e a fase. Ali também há <b>Para o topo</b> e <b>Para o fim</b>, úteis no celular.</li>
          <li><b>Abrir:</b> clique no título. Ali você edita título, descrição e prazo, monta o <b>checklist</b> e comenta. No alto aparecem com quem a tarefa está, <b>quem a criou</b> e quando (numa tarefa que veio por delegação, quem criou a de origem) e, se ela foi delegada, <b>quem delegou por último</b> e quando.</li>
          <li><b>Seguidores:</b> dentro da tarefa, no campo <b>Seguidores</b>, inclua e-mails <b>@nerus.com.br</b> de quem precisa acompanhar (a pessoa não precisa usar o SyncTasks). Cada novidade da tarefa vai por e-mail para eles, com o que mudou e o histórico completo; novidades com menos de 5 minutos entre si vão num e-mail só. Quem está com a tarefa e quem a delegou incluem e tiram seguidores; o e-mail traz o link <b>Parar de seguir</b>. Ao delegar, os seguidores vão junto para a tarefa de quem recebe. Tarefa privada não tem seguidores.</li>
          <li><b>Concluir:</b> clique no círculo à esquerda do título, ou em <b>Concluir</b> dentro da tarefa. A fase não define se a tarefa está concluída: concluir é sempre um clique explícito.</li>
          <li><b>Arquivar:</b> na tarefa concluída aparece um pequeno ícone de arquivo, no canto do cartão. Um clique tira a tarefa do quadro, e o aviso embaixo traz <b>Desfazer</b> por alguns segundos. Também há <b>Arquivar</b> dentro da tarefa e <b>Arquivar as concluídas</b> no menu <b>…</b> da fase. A tarefa arquivada vai para <b>Arquivadas</b>, no menu à esquerda, e continua na <b>busca</b>; use <b>Desarquivar</b> para trazê-la de volta. Tarefa recebida por delegação é arquivada por quem delegou, ao dar o ciente.</li>
          <li><b>Descartar (tarefa criada por engano):</b> não existe apagar tarefa, porque o número nunca é reaproveitado e o histórico fica guardado. Para tirar do quadro uma tarefa sua que não vai ser feita, abra a tarefa e clique em <b>Descartar</b>. Ela vai para <b>Arquivadas</b> com a etiqueta “Descartada” (não como concluída), e o aviso traz <b>Desfazer</b>. Para trazer de volta depois, use <b>Desarquivar</b>: ela volta à mesma fase, com o mesmo número. Tarefa concluída se arquiva; tarefa recebida por delegação se devolve; com delegação em aberto, cancele a delegação antes.</li>
        </ul>
      </Sec>

            <Sec id="filtro-quadro" title="Filtro no quadro">
        <p>No quadro aberto, no alto da tela, à esquerda de <b>Quadro / Tabela</b>, ficam o mesmo <b>Filtro</b> da tabela (com os filtros prontos e os seus filtros salvos), os atalhos <b>Delegadas para mim</b> e <b>Delegadas por mim</b> (no notebook e no celular, <b>Para mim</b> e <b>Por mim</b>) e <b>Condição</b>. As etiquetas do filtro ligado aparecem acima das fases. No celular, esses botões ficam acima das fases.</p>
        <ul>
          <li>Com o filtro ligado, o quadro <b>esconde as tarefas que não atendem a ele</b>; as fases continuam no lugar, cada uma com a contagem, por exemplo “3 de 10”. A faixa azul mostra “Filtro ligado: mostrando 12 de 40 tarefas” e tem o botão <b>Limpar filtro</b>.</li>
          <li>Arrastar, criar e abrir tarefas continua igual. Se uma tarefa deixar de atender ao filtro (por exemplo, concluída num filtro de abertas) ou for criada sem atender a ele, ela some da vista e um aviso explica.</li>
          <li>O filtro vale para o quadro aberto. As condições <b>Quadro</b> e <b>Arquivada</b> não fazem sentido ali: num filtro que as tenha, elas aparecem riscadas e são ignoradas no quadro.</li>
        </ul>
      </Sec>

<Sec id="tabela" title="Tarefas: tabela e filtros">
        <p>Em <b>Tarefas</b>, clique em <b>Tabela</b> (no topo, à direita) para ver as tarefas de <b>todos os seus quadros</b> e da caixa de entrada numa lista só. Só aparecem as suas tarefas, como nos quadros.</p>
        <ul>
          <li><b>Colunas:</b> número (#12), tarefa (com uma bolinha da cor do cartão, se tiver), quadro e fase, prazo (vermelho quando atrasado), situação, delegação (“Delegada para…” ou “Recebida de…”), checklist e data de criação. No botão <b>Colunas</b> dá para mostrar também concluída em, arquivada em, privada, origem e descrição.</li>
          <li><b>Ordenar:</b> clique no título da coluna; outro clique inverte a ordem.</li>
          <li><b>Abrir:</b> clique na linha.</li>
          <li><b>Filtro:</b> cada condição tem <b>campo</b>, <b>operador</b> e <b>valor</b>, por exemplo “Prazo · nos próximos · 7 dias”. No bloco <b>Todas estas condições</b> a tarefa precisa atender a todas; no bloco <b>Qualquer uma destas condições</b>, a pelo menos uma. As condições em uso aparecem acima da tabela, e o <b>×</b> de cada uma a tira na hora.</li>
          <li><b>Filtros prontos e salvos:</b> clique no botão <b>Filtro</b> para escolher um pronto (Atrasadas, Vencem nos próximos 7 dias, Delegadas por mim em aberto…) ou um dos seus. Para guardar um filtro, dê um nome e clique em <b>Salvar filtro</b>. Só você vê os seus filtros. O último filtro usado fica lembrado.</li>
          <li><b>Atalhos de delegadas:</b> ao lado do botão Filtro, <b>Delegadas para mim</b> mostra só as tarefas que chegaram para você por delegação, e <b>Delegadas por mim</b>, só as que você delegou e ainda não receberam o seu ciente. Um clique liga, outro desliga (ou o <b>×</b> da etiqueta). Funcionam sozinhos ou somados ao filtro escolhido; com os dois ligados, aparecem as duas.</li>
          <li><b>O mesmo filtro no Quadro:</b> o filtro e os atalhos valem para a Tabela e para o Quadro. Ao trocar de visão, eles continuam ligados. No computador, os botões ficam no mesmo lugar nas duas visões, na barra do topo, à esquerda de Quadro / Tabela; na Tabela, <b>Colunas</b> e <b>Exportar planilha</b> vêm logo depois deles (no notebook, só com o ícone; passe o mouse para ver o nome).</li>
          <li><b>Arquivadas:</b> ficam fora da tabela; para vê-las, use a condição <b>Arquivada · é · Sim</b>.</li>
          <li><b>Exportar planilha:</b> baixa um arquivo que abre no Excel, com as colunas e o filtro que estão na tela (até 5.000 tarefas).</li>
        </ul>
      </Sec>

      <Sec id="arquivadas" title="Arquivadas">
        <p>No menu à esquerda, <b>Arquivadas</b> lista as tarefas que <b>você</b> arquivou, da mais recente para a mais antiga, com o quadro e a fase de onde saíram.</p>
        <ul>
          <li><b>Quadros arquivados:</b> aparecem no topo, com o botão <b>Desarquivar</b>. O quadro volta como a última aba. A tarefa de um quadro arquivado mostra “(quadro arquivado)” e, ao ser desarquivada, vai para a primeira fase do seu primeiro quadro.</li>
          <li><b>Pesquisar:</b> digite o número (12 ou #12) ou palavras do título e da descrição.</li>
          <li><b>Desarquivar:</b> o botão na linha devolve a tarefa à mesma fase e posição (ou à primeira fase do quadro, se a fase foi arquivada). O aviso traz <b>Desfazer</b>.</li>
          <li><b>Delegadas com ciente:</b> as tarefas que você delegou e em que deu o ciente também aparecem, marcadas <b>Delegada para…</b>. Elas são só para consulta: o ciente não se desfaz.</li>
          <li>Tarefa que você recebeu por delegação e que foi arquivada pelo seu superior não aparece aqui.</li>
        </ul>
      </Sec>

      <Sec id="trello" title="Exportar e importar (JSON)">
        <h3>Exportar tarefas (JSON)</h3>
        <p>Baixa um arquivo com <b>todas as suas tarefas</b>, de todos os seus quadros, para guardar uma cópia ou levar para outro lugar. Nada muda aqui no SyncTasks e nada é enviado ao Trello.</p>
        <ol>
          <li>Em <b>Tarefas</b>, abra o menu <b>…</b> do quadro (à direita das abas) e escolha <b>Exportar tarefas (JSON)</b>.</li>
          <li>Confira o resumo e clique em <b>Baixar arquivo</b>. O arquivo <b>synctasks-tarefas-AAAA-MM-DD.json</b> vai para a pasta de downloads.</li>
        </ol>
        <ul>
          <li><b>Vão:</b> todos os quadros (também os arquivados), a caixa de entrada, as fases e todas as tarefas, inclusive as arquivadas e as privadas, com número, título, descrição, prazo, se está concluída, cor, checklist, comentários (com autor e data) e a situação da delegação.</li>
          <li>O log não vai. O arquivo é seu: guarde-o com cuidado, porque tem também as tarefas privadas.</li>
          <li>Cada quadro vai no mesmo formato do arquivo do Trello, por isso o <b>Importar arquivo JSON</b> lê o arquivo de volta.</li>
        </ul>
        <h3>Importar arquivo JSON</h3>
        <p>Lê o arquivo baixado em <b>Exportar tarefas (JSON)</b> ou o arquivo de um quadro do Trello. Cada quadro do arquivo vira um <b>quadro novo</b> seu; os quadros que você já tem não mudam.</p>
        <ol>
          <li><b>Arquivo do Trello:</b> no Trello, abra o quadro, clique no menu <b>…</b> e escolha <b>Imprimir, exportar e compartilhar</b> → <b>Exportar como JSON</b>. Salve o arquivo.</li>
          <li>Aqui, em <b>Tarefas</b>, abra o menu <b>…</b> do quadro, clique em <b>Importar arquivo JSON</b> e escolha o arquivo.</li>
          <li>No arquivo do SyncTasks, marque os quadros que quer trazer (vêm todos marcados). No do Trello, ajuste o nome do quadro se quiser. Depois clique em <b>Importar</b>.</li>
        </ol>
        <ul>
          <li><b>Vêm:</b> fases (ou listas do Trello) na mesma ordem e tarefas com título, descrição, prazo, se está concluída, checklist e comentários. Do arquivo do SyncTasks vêm também a cor do quadro, a cor da tarefa e a marca de privada.</li>
          <li><b>Comentários</b> entram em seu nome, com o autor e a data originais no texto.</li>
          <li>Todas as tarefas ficam com você: delegações não voltam. Os <b>membros</b> dos cartões do Trello ficam anotados na descrição; para entregar a alguém da equipe, use <b>Delegar</b>.</li>
          <li><b>Ficam de fora:</b> tarefas, fases e quadros arquivados; do Trello, também etiquetas e anexos.</li>
          <li>Cada tarefa importada ganha um número novo no quadro novo (1, 2, 3…), e o log registra de onde veio.</li>
        </ul>
      </Sec>

      <Sec id="capturar" title="Capturar da web">
        <p>Viu uma página que vira tarefa (um e-mail no navegador, um chamado, um documento)? Guarde em dois cliques. A tarefa vai para a sua <b>Caixa de entrada</b>, marcada como “capturada da web”, com o link e o trecho selecionado na descrição.</p>
        <h3>No computador (Chrome, Edge)</h3>
        <ol>
          <li>Mostre a barra de favoritos (Ctrl+Shift+B).</li>
          <li>Arraste este botão para ela: <BookmarkletButton /></li>
          <li>Em qualquer página, selecione um trecho se quiser e clique em <b>+ SyncTasks</b> na barra. Confira o título e clique em <b>Salvar na caixa de entrada</b>.</li>
        </ol>
        <h3>E-mails do Gmail</h3>
        <p>Com o e-mail aberto no Gmail, clique em <b>+ SyncTasks</b>. A tarefa ganha o <b>assunto</b> do e-mail como título e guarda o <b>link da mensagem</b>: clicando nele, o Gmail abre o mesmo e-mail (para quem tem acesso a essa caixa). Ela aparece na caixa de entrada como “capturada do e-mail”.</p>
        <h3>No celular (Android)</h3>
        <ol>
          <li>Instale o SyncTasks: no Chrome, menu <b>⋮</b> → <b>Adicionar à tela inicial</b> (ou <b>Instalar app</b>).</li>
          <li>Em qualquer página ou app, toque em <b>Compartilhar</b> e escolha <b>SyncTasks</b>.</li>
        </ol>
        <p>Depois, na caixa de entrada, escolha o quadro e a fase para organizar a tarefa.</p>
      </Sec>

      <Sec id="assistente" title="Claude e outros assistentes">
        <p>Ligue o SyncTasks ao seu <b>Claude</b> e peça em português: “cria no SyncTasks uma tarefa para ligar ao Marcelo na sexta”, “o que está atrasado?”, “põe estas cinco coisas no quadro Comercial”. O assistente cria e consulta as <b>suas</b> tarefas, com as mesmas regras do app.</p>
        <h3>Ligar (uma vez só)</h3>
        <ol>
          <li>No SyncTasks, abra <b>Meus dados</b> e clique em <b>Copiar</b> ao lado do endereço do conector (termina em <code>/mcp</code>).</li>
          <li>No Claude (site, aplicativo do computador ou do celular), abra <b>Configurações › Conectores › Adicionar conector personalizado</b>, dê o nome <b>SyncTasks</b> e cole o endereço.</li>
          <li>Clique em <b>Conectar</b>. Abre a tela do SyncTasks (entre com seu e-mail e senha, se pedir). Confira o nome e clique em <b>Permitir</b>.</li>
        </ol>
        <p>Se a Nerus usar um plano do Claude para empresas, o administrador do Claude pode adicionar o conector uma vez para todos; cada pessoa só clica em <b>Conectar</b> e <b>Permitir</b>. Conectores personalizados dependem do plano do Claude de cada um.</p>
        <h3>O que ele pode fazer</h3>
        <ul>
          <li>Ver os seus quadros e fases e as suas tarefas abertas (atrasadas, de hoje, dos próximos 7 dias, da caixa de entrada).</li>
          <li>Criar tarefas, até 20 de uma vez, com descrição e prazo. Sem quadro, elas vão para a <b>Caixa de entrada</b>, marcadas como “criada pelo assistente”.</li>
        </ul>
        <p>Ele <b>não</b> apaga, não conclui, não delega e não vê tarefas de outras pessoas.</p>
        <h3>Desligar</h3>
        <p>Em <b>Meus dados</b>, na lista de assistentes ligados, clique em <b>Desligar</b>. O acesso para na hora. Pessoa desativada também perde o acesso.</p>
        <p>Outros assistentes que usam o mesmo padrão (MCP), como o Gemini CLI, podem se ligar do mesmo jeito; a tela <b>Permitir</b> mostra o nome e o endereço de quem está pedindo.</p>
      </Sec>

      <Sec id="entrada" title="Caixa de entrada">
        <p>Tarefas que alguém delegou ou transferiu para você, e páginas que você capturou da web, chegam aqui primeiro. Para cada uma:</p>
        <ul>
          <li><b>Aceitar:</b> na primeira vez, escolha o quadro e a fase. Depois disso, um clique em <b>Aceitar</b> coloca a tarefa no mesmo lugar da última vez (o aviso mostra onde e tem <b>Abrir</b>). Para escolher outro lugar, use a setinha ao lado do Aceitar (“Aceitar em…”).</li>
          <li><b>Delegar</b> (para quem tem equipe): numa janela só, escolha o quadro e a fase onde fica a sua tarefa, para acompanhar, e o subordinado direto que vai fazer. É o mesmo que aceitar e depois delegar.</li>
          <li><b>Descartar:</b> tira a tarefa da caixa sem concluir. Ela vai para <b>Arquivadas</b>, marcada como “Descartada”, e o aviso traz <b>Desfazer</b>. Ninguém é avisado. Para trazer de volta depois, clique em <b>Desarquivar</b> em Arquivadas: ela volta para a caixa de entrada, com o mesmo número.</li>
          <li><b>Devolver:</b> para tarefas que chegaram por delegação, no lugar de Descartar, porque quem delegou espera por elas. Escreva a justificativa (obrigatória). A tarefa volta para quem delegou.</li>
        </ul>
        <p><b>Várias de uma vez:</b> marque as caixinhas à esquerda (ou <b>Selecionar todas</b>, ou <b>Selecionar de…</b> para pegar todas que vieram da mesma pessoa) e clique em <b>Descartar selecionadas</b>. Não há janela de confirmação: o aviso traz <b>Desfazer</b>.</p>
        <p>O prazo vem sugerido por quem delegou. Você pode ajustá-lo dentro da tarefa, e quem delegou recebe um aviso.</p>
      </Sec>

      <Sec id="delegar" title="Delegar uma tarefa">
        <p>Quem tem equipe pode delegar. A delegação vai sempre para um <b>subordinado direto</b>: o gestor delega aos funcionários dele, o diretor aos gestores (e aos funcionários) ligados direto a ele.</p>
        <ol>
          <li>Crie a tarefa no seu quadro (ou use uma que você recebeu).</li>
          <li>Abra a tarefa e clique em <b>Delegar</b>.</li>
          <li>Escolha a pessoa, o prazo sugerido e, se quiser, uma observação.</li>
          <li>Se a própria pessoa precisa fazer, marque <b>Não pode ser repassada</b>: ela não consegue delegar a tarefa nem transferi-la para um subordinado (para um colega ou para o superior dela, pode).</li>
        </ol>
        <p>Você liga ou desliga <b>Não pode ser repassada</b> depois, dentro da sua tarefa, no bloco “Repassada para”. A pessoa é avisada e a mudança fica no log. Na tabela, o filtro <b>Pode repassar</b> acha essas tarefas.</p>
        <p>Se a tarefa for <b>privada</b>, ela deixa de ser privada ao delegar: tarefa delegada não pode ser privada.</p>
        <p>A pessoa recebe um <b>cartão ligado ao seu</b>, com o número do quadro dela, e é avisada no app e por e-mail. O seu cartão continua no seu quadro com a etiqueta verde-azulada <b>Para [nome]</b>; no quadro da pessoa, o cartão dela mostra a etiqueta roxa <b>De [seu nome]</b>.</p>
        <p>Quando a pessoa <b>aceita</b> a tarefa, você recebe um aviso no app e por e-mail.</p>
        <h3>Cancelar a delegação</h3>
        <p>Mudou de ideia? Abra a sua tarefa e, no bloco <b>Repassada para</b>, clique em <b>Cancelar delegação</b> (enquanto ela aguarda o aceite, está em andamento ou foi devolvida). A pessoa é avisada e a tarefa sai do quadro dela; a sua continua com você. O aviso na tela traz <b>Desfazer</b> por alguns segundos: a delegação volta como estava, no mesmo quadro, fase e número da pessoa, com o que ela tinha escrito, e ela recebe o aviso de que a tarefa voltou. Depois de 10 minutos, ou se você já tiver delegado a tarefa de novo, não dá mais para desfazer.</p>
        <p className="ex">Exemplo: o diretor delega “Orçamento 2027” ao gestor. O gestor abre essa tarefa e delega parte dela ao funcionário. Cada nível dá o ciente no nível de baixo antes de concluir o seu.</p>
      </Sec>

      <Sec id="painel" title="Painel (para quem tem equipe)">
        <p>Visão geral de tudo o que você delegou. Cada número ou barra abre <b>Tarefas delegadas</b> já filtrada.</p>
        <ul>
          <li><b>Resumo:</b> em aberto, atrasadas, aguardando seu ciente e devolvidas.</li>
          <li><b>Delegadas por pessoa:</b> uma barra por subordinado direto, com as tarefas que você delegou <b>no prazo ou sem data</b> (azul) e as <b>atrasadas</b> (vermelho). Os botões acima das barras ordenam pelo <b>total</b> ou pelas <b>atrasadas</b>, do maior para o menor ou ao contrário. Ao lado, quantas tarefas próprias a pessoa tem, só para conhecimento. Use para responder “posso mandar mais tarefas para ela?”.</li>
          <li><b>Próximos 14 dias:</b> o que vence em cada dia, com as atrasadas no topo.</li>
          <li><b>Paradas:</b> tarefas sem aceite há mais de 2 dias, sem movimento há mais de 7 dias e aguardando o seu ciente há mais de 2 dias.</li>
        </ul>
      </Sec>

      <Sec id="acompanhar" title="Tarefas delegadas (para quem tem equipe)">
        <p>Esta é a tela para responder “o que eu deleguei e ainda não foi concluído?”.</p>
        <ul>
          <li><b>Precisam da sua ação:</b> tarefas concluídas aguardando o seu ciente e tarefas devolvidas.</li>
          <li><b>Equipe:</b> um grupo por pessoa, com os contadores <b>abertas · atrasadas · aguardando ciente · devolvidas · próprias</b>. “Próprias” é só a quantidade de tarefas que a pessoa criou para si (o conteúdo é dela).</li>
          <li>Clique no nome da pessoa para recolher ou expandir, ou use <b>Recolher tudo</b> / <b>Expandir tudo</b>. A escolha fica lembrada. Marque <b>Mostrar arquivadas e canceladas</b> para ver o histórico.</li>
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
        <p>Para uma tarefa devolvida, quem delegou tem três saídas:</p>
        <ul>
          <li><b>Redelegar:</b> para a mesma ou outra pessoa; é o mesmo cartão, que chega à caixa de entrada dela.</li>
          <li><b>Retomar:</b> você mesmo fica com a tarefa. Ela vai para a sua <b>caixa de entrada</b>, com a justificativa da devolução como comentário, e dali você organiza, faz ou delega de novo. Quem devolveu não é avisado de novo. (Se a tarefa veio de cima para você por delegação, ela continua no seu quadro.)</li>
          <li><b>Cancelar:</b> encerra a delegação e a sua tarefa vai para <b>Arquivadas</b>, com a etiqueta <b>Cancelada</b>. Se precisar, desarquive: ela volta ao quadro.</li>
        </ul>
        <p>Todo cancelamento tem <b>Desfazer</b> no aviso, logo depois de cancelar.</p>
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
          <li>Toda tarefa tem um <b>número no quadro</b>, como <code>#12</code>. Cada quadro conta as próprias tarefas a partir de 1, e a <b>caixa de entrada</b> tem a numeração dela. Um número nunca é reaproveitado no mesmo quadro, nem depois de arquivar.</li>
          <li>Ao <b>mover para outro quadro</b>, aceitar uma tarefa da caixa de entrada ou receber por transferência, a tarefa ganha o próximo número de onde chegou; o log guarda o número antigo. Numa tarefa delegada, cada um vê o número do próprio quadro.</li>
          <li>Na <b>busca</b>, digite o número (<kbd>12</kbd> ou <kbd>#12</kbd>): abre a tarefa 12 do quadro aberto; se houver tarefa 12 em outros quadros seus, aparece a lista para escolher. Também vale uma palavra do título ou da descrição. Aparecem só tarefas que você pode ver. Links e códigos antigos (<code>ST-</code>, <code>NT-</code>) continuam abrindo a tarefa.</li>
          <li><b>Cartões do mesmo tamanho:</b> no quadro, todo cartão tem a mesma altura: duas linhas de título (um título maior termina em “…”) e uma linha com número, prazo, etiquetas <b>De…</b>/<b>Para…</b> e situação. Se faltar espaço, checklist, cadeado de privada e “não pode ser repassada” viram um <b>+1</b>, <b>+2</b>… (passe o mouse para ver quais).</li>
          <li><b>Ver a tarefa sem abrir:</b> no computador, pare o mouse sobre um cartão por meio segundo: aparece um balão com o título completo, a descrição, com quem está, o prazo e o checklist. Dá para levar o mouse até o balão: ele continua aberto, os links dele abrem numa aba nova e o ícone de copiar, no canto, copia a descrição (ou o título, se não houver descrição). Ele some ao tirar o mouse do cartão e do balão, rolar ou arrastar. No celular, toque para abrir a tarefa.</li>
          <li><b>Links:</b> endereços (https://…, www.…) e e-mails escritos na descrição, nos comentários ou no título viram links e abrem numa aba nova. Na tarefa aberta, a descrição aparece como texto: clique num link para abri-lo, ou no resto do texto (ou em Editar) para editar.</li>
          <li><b>Cor do cartão:</b> na tarefa aberta, clique em <b>Cor</b> (ao lado do número) e escolha uma das cores, ou <b>Sem cor</b>. O cartão fica todo dessa cor no quadro, em tom sólido médio; o texto fica escuro no tema claro e branco no tema escuro para ler bem, e o prazo atrasado aparece numa etiqueta branca. A cor é só sua: numa tarefa delegada, o cartão de quem recebe começa sem cor, e quem recebe por transferência também vê sem cor.</li>
          <li><b>Balão de tarefa nova:</b> quando chega uma tarefa delegada ou transferida para você, aparece um balão no canto de baixo da tela (“Marina delegou: … · Clique para ver”). Clique para abrir a tarefa; várias juntas abrem a caixa de entrada. Ele some sozinho em 10 segundos, e o aviso continua em <b>Avisos</b>.</li>
          <li><b>Avisos</b> chegam no app e por e-mail quando: uma tarefa é delegada a você, aceita, devolvida, concluída, reaberta, arquivada com ciente, cancelada (ou o cancelamento é desfeito), transferida para você, ou quando o prazo de uma tarefa que você delegou muda.</li>
          <li><b>Avisos de prazo por e-mail:</b> na <b>véspera</b> do prazo (“Prazo amanhã”) e no <b>dia seguinte</b>, se a tarefa continuar aberta (“Prazo vencido”), uma vez cada. Vão para quem está com a tarefa; numa tarefa delegada, quem delegou recebe também o de vencido. Se o prazo mudar, o aviso vale para a nova data.</li>
          <li><b>Resumo diário por e-mail:</b> às <b>7h</b>, de segunda a sexta, com o que vence hoje, o que está atrasado, as delegações aguardando o seu aceite e as tarefas aguardando o seu ciente, cada uma com o número e o link. Dia sem nada, sem e-mail.</li>
          <li><b>Meus dados:</b> clique no seu nome, no alto do menu à esquerda (ou em <b>Meus dados</b>, embaixo; no celular, dentro do <b>☰</b>), para desligar o resumo diário ou os avisos de prazo. Os avisos de delegação continuam chegando sempre.</li>
        </ul>
      </Sec>

      <Sec id="atalhos" title="Atalhos de teclado">
        <p>Funcionam quando você não está escrevendo num campo. A lista também abre com a tecla <kbd>?</kbd> ou em <b>Atalhos</b>, embaixo no menu.</p>
        <ul>
          <li><kbd>N</kbd>: nova tarefa na primeira fase do quadro aberto.</li>
          <li><kbd>/</kbd>: vai para a busca.</li>
          <li><kbd>C</kbd>: conclui (ou desfaz a conclusão) da tarefa aberta. <kbd>D</kbd>: delega a tarefa aberta.</li>
          <li><kbd>Ctrl</kbd> + <kbd>Enter</kbd>: envia o comentário, salva a descrição ou confirma a janela aberta (Delegar, Devolver, Reabrir…).</li>
          <li><kbd>Esc</kbd>: fecha a janela ou o menu.</li>
        </ul>
        <p>As mudanças aparecem na tela na hora em que você clica ou solta o cartão; o app grava por trás. Se o servidor recusar, a tela volta como estava e aparece um aviso com o motivo.</p>
      </Sec>

      <Sec id="ferias" title="Férias e ausências">
        <p>Antes de sair de férias ou se ausentar, escolha quem cuida das suas tarefas enquanto isso.</p>
        <ol>
          <li>Abra <b>Meus dados</b> e, em <b>Férias e ausências</b>, clique em <b>Escolher substituto</b>.</li>
          <li>Escolha a pessoa: pode ser qualquer pessoa ativa, inclusive alguém da sua equipe. Quem também está ausente aparece marcado “também ausente”.</li>
          <li>Decida se vai <b>compartilhar as tarefas comuns</b>. Sem compartilhar, o substituto vê só as tarefas ligadas a delegações (as que você recebeu e as que você delegou), o que chegou de outras pessoas e o que ele mesmo criar. Compartilhando, vê também as tarefas comuns. As <b>privadas nunca aparecem</b>: antes de sair, marque como privado o que for particular.</li>
          <li>Se quiser, informe o <b>último dia fora</b>: no dia seguinte a substituição acaba sozinha. Sem data, vale até você clicar em <b>Encerrar substituição</b>.</li>
        </ol>
        <p><b>Para quem substitui:</b> aparece um seletor no alto da tela. Escolha <b>Substituindo [nome]</b> para ver os quadros, a caixa de entrada, o Painel e as Tarefas delegadas da pessoa e agir por ela: aceitar, delegar para a equipe dela, dar ciente, reabrir, cancelar, criar tarefas. Uma faixa laranja lembra que você está substituindo; <b>Voltar para as minhas tarefas</b> volta para as suas. Avisos, Meus dados, exportar e importar e o log da pessoa não ficam disponíveis, e só ela marca ou desmarca uma tarefa como privada.</p>
        <p>Tudo o que o substituto faz fica registrado no log como feito por ele, substituindo a pessoa, e os comentários mostram “escrito por …, substituto”. Quem sai de surpresa (doença, por exemplo) pode ter o substituto escolhido pela administração.</p>
      </Sec>

      <Sec id="privacidade" title="Privacidade e log">
        <ul>
          <li>Seus quadros são só seus. Quem está acima de você vê <b>apenas as tarefas que delegou a você</b> e quantas tarefas próprias você tem.</li>
          <li>Marque uma tarefa como <b>Privada</b> (dentro dela) para que nem esse número a conte. Tarefas delegadas (recebidas, ou que você delegou para alguém) não podem ser privadas; se a delegação for cancelada, a tarefa volta a poder ser privada.</li>
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
          <dt><TipIcon name="inbox" tip="Capturada da web" /> Caixa</dt><dd>Na caixa de entrada: tarefa capturada da web ou de um e-mail</dd>
          <dt><span className="dtag from"><Icon name="into" />De Ana</span></dt><dd>Etiqueta roxa: delegada a você por alguém acima (aqui, a Ana)</dd>
          <dt><span className="dtag to"><Icon name="out" />Para João</span></dt><dd>Etiqueta verde-azulada: você delegou para alguém da sua equipe (aqui, o João)</dd>
          <dt><TipIcon name="lock" tip="Privada" /> Cadeado</dt><dd>Tarefa privada</dd>
          <dt><TipIcon name="self" tip="Não pode ser repassada" /> Pessoa</dt><dd>Não pode ser repassada: quem recebeu precisa fazer</dd>
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
          <li>Escolha o <b>superior direto</b>. Ele precisa estar num nível acima: o de um diretor é o CEO; o de um gestor é um diretor ou o CEO; o de um funcionário é um gestor, um diretor ou o CEO (por exemplo, a assistente que responde direto ao diretor). A lista mostra o cargo entre parênteses.</li>
          <li>Marque <b>Também é administrador</b> se a pessoa for cuidar do cadastro.</li>
          <li>Clique em <b>Cadastrar</b>. A pessoa recebe um e-mail com o link para definir a senha (válido por 72 horas).</li>
        </ol>
        <p>Uma pessoa pode ser CEO e administrador ao mesmo tempo: cadastre-a como CEO e marque <b>Também é administrador</b>. Se o CEO também comanda uma área, ligue os gestores dessa área direto a ele.</p>
        <p>Cadastre de cima para baixo: primeiro o CEO, depois os diretores, os gestores e os funcionários. Se o link expirar, use <b>Reenviar convite</b> no menu <b>…</b> da pessoa.</p>
        <h3>Editar dados (inclusive o superior direto)</h3>
        <p>No menu <b>…</b> da pessoa, escolha <b>Editar dados</b> para corrigir nome, e-mail, cargo exibido, marcar se também é administrador ou trocar o <b>superior direto</b>. O e-mail novo passa a ser o usado para entrar no app.</p>
        <p>Para mudar a quem a pessoa responde (por exemplo, o funcionário que passa para outro gestor, ou o gestor que passa para outro diretor), escolha o novo nome em <b>Superior direto</b> e clique em <b>Salvar</b>. Antes de salvar, a janela avisa o que acontece:</p>
        <ul>
          <li>As tarefas que o superior antigo tinha delegado a esta pessoa e ainda estão em aberto passam para o novo, que continua o acompanhamento.</li>
          <li>O histórico e as tarefas já arquivadas ficam com o antigo. Os três são avisados.</li>
        </ul>
        <p>O CEO não tem superior direto. O nível (CEO, diretor, gestor, funcionário) é escolhido no cadastro.</p>
        <h3>Desativar ou reativar</h3>
        <p>Não existe excluir: quem sai é <b>desativado</b>. Nada é apagado, o log continua com o nome da pessoa e ela pode ser reativada depois.</p>
        <ol>
          <li>No menu <b>…</b> da pessoa, escolha <b>Desativar</b>. A janela mostra o que está com ela.</li>
          <li>Se houver pendências, escolha <b>quem recebe</b>: alguém do mesmo nível ou o superior direto dela.</li>
          <li>Clique em <b>Desativar</b>. Na hora, a pessoa deixa de entrar e:
            <ul>
              <li>os <b>subordinados</b> passam a responder a quem recebe, e as tarefas que ela tinha delegado e estão em aberto passam a ser acompanhadas por essa pessoa;</li>
              <li>as tarefas que ela <b>recebeu e não terminou</b> voltam para quem delegou, como devolvidas, para redelegar ou cancelar;</li>
              <li>as tarefas <b>próprias abertas</b> vão para a caixa de entrada de quem recebe;</li>
              <li>as <b>privadas</b>, os quadros, as concluídas e as arquivadas ficam com ela. Todos os envolvidos recebem aviso.</li>
            </ul>
          </li>
        </ol>
        <p>A pessoa inativa continua na lista com a situação <b>Inativa</b>; marque <b>Esconder inativas</b> para tirá-la da vista (a escolha fica gravada na sua conta e vale da próxima vez que abrir a tela). O e-mail continua com ela. Para reativar, use <b>Reativar</b> no mesmo menu: ela volta a entrar e encontra os quadros e as privadas como deixou, mas o que foi passado adiante não volta sozinho.</p>
        <h3>Substituto em férias e ausências</h3>
        <p>Quando alguém sai de surpresa e não escolheu substituto, abra o menu <b>…</b> da pessoa e escolha <b>Substituto em férias e ausências</b>. Funciona como em Meus dados (veja <b>Férias e ausências</b>): escolha quem substitui, se as tarefas comuns ficam compartilhadas e o último dia fora. A pessoa e o substituto recebem aviso. No mesmo lugar dá para encerrar.</p>
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
