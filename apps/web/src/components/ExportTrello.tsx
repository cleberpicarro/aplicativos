import { useEffect, useRef, useState } from 'react';
import { get, type Board, type CardDetail } from '../lib/api';
import { plural } from '../lib/format';
import { authorizeUrl, buildTrelloExport, exportableCards, looksLikeToken, sendToTrello } from '../lib/trelloExport';
import { Dialog, ErrorText, useMe } from './ui';

type Phase = 'connect' | 'ready' | 'sending' | 'done';

/** Item 31: cria no Trello um quadro novo com as fases e tarefas do quadro aberto. Nada muda no SyncTasks. */
export function ExportTrelloDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const key = useMe().data?.trelloKey ?? null;
  const [phase, setPhase] = useState<Phase>('connect');
  const [token, setToken] = useState('');
  const [pasted, setPasted] = useState('');
  const [includePrivate, setIncludePrivate] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<unknown>(null);
  const popup = useRef<Window | null>(null);

  const privates = board.cards.filter((c) => !c.archivedAt && c.isPrivate).length;
  const cards = exportableCards(board, includePrivate);

  // A janela do Trello devolve o código de acesso por mensagem e fecha.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'https://trello.com' || (popup.current && e.source !== popup.current)) return;
      popup.current?.close();
      popup.current = null;
      const t = typeof e.data === 'string' ? e.data.trim() : '';
      if (looksLikeToken(t)) { setToken(t); setPhase('ready'); setError(null); }
      else setError(new Error('O Trello não deu a permissão. Clique em “Conectar ao Trello” e depois em “Permitir”.'));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const connect = () => {
    setError(null);
    popup.current = window.open(authorizeUrl(key!, window.location.origin), 'trello-auth', 'width=620,height=760');
    if (!popup.current) setError(new Error('O navegador bloqueou a janela do Trello. Use o caminho “cole o código” logo abaixo.'));
  };

  const applyPasted = () => {
    if (!looksLikeToken(pasted)) { setError(new Error('Esse não parece o código do Trello. Copie o código inteiro que aparece depois de clicar em “Permitir”.')); return; }
    setToken(pasted.trim());
    setPhase('ready');
    setError(null);
  };

  const send = async () => {
    setError(null);
    setPhase('sending');
    try {
      // Checklist e comentários vêm dos detalhes de cada tarefa (de 4 em 4).
      const details = new Map<string, CardDetail>();
      const queue = [...cards];
      setProgress({ done: 0, total: 0 });
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) details.set(c.id, await get<CardDetail>(`/cards/${c.id}`));
      }));
      const plan = buildTrelloExport(board, details, includePrivate);
      setUrl(await sendToTrello(plan, { key: key!, token }, (done, total) => setProgress({ done, total })));
      setPhase('done');
    } catch (err) {
      setError(err);
      setPhase('ready');
    }
  };

  const footer = phase === 'done'
    ? <button className="b pri" onClick={onClose}>Fechar</button>
    : <>
        <button className="b" onClick={onClose} disabled={phase === 'sending'}>Cancelar</button>
        {phase !== 'connect' && (
          <button className="b pri" onClick={send} disabled={phase === 'sending'}>
            {phase === 'sending' ? 'Exportando…' : `Exportar ${cards.length} ${plural(cards.length, 'tarefa', 'tarefas')}`}
          </button>
        )}
      </>;

  return (
    <Dialog title="Exportar para o Trello" onClose={phase === 'sending' ? () => {} : onClose} footer={key ? footer : <button className="b" onClick={onClose}>Fechar</button>}>
      <div className="dialog-b" style={{ padding: 0 }}>
        {!key ? (
          <p className="hint" style={{ margin: 0 }}>
            A exportação para o Trello ainda não foi ligada neste SyncTasks: falta a chave do Trello nas configurações do servidor.
            Peça ao administrador (o passo a passo está na Ajuda, no Manual do administrador, em “Ligar a exportação para o Trello”).
          </p>
        ) : phase === 'done' ? (
          <div className="box" style={{ display: 'grid', gap: 6 }}>
            <b style={{ fontWeight: 500 }}>Pronto! O quadro “{board.name}” foi criado no Trello.</b>
            <a href={url} target="_blank" rel="noreferrer">Abrir o quadro no Trello</a>
            <span className="muted">Nada mudou aqui no SyncTasks.</span>
          </div>
        ) : (
          <>
            <div className="box" style={{ display: 'grid', gap: 4 }}>
              <b style={{ fontWeight: 500 }}>Vai ser criado no Trello um quadro novo “{board.name}” com:</b>
              <span>{board.lists.length} {plural(board.lists.length, 'lista', 'listas')} (as fases, na mesma ordem) e {cards.length} {plural(cards.length, 'cartão', 'cartões')}</span>
              <span>Cada cartão leva título, descrição, prazo, se está concluída, checklist e comentários (com o autor e a data no texto). O código ST- e a situação da delegação vão no topo da descrição.</span>
              <span className="muted">Tarefas arquivadas ficam de fora. Nada muda aqui no SyncTasks.</span>
            </div>
            {privates > 0 && (
              <label className="check">
                <input type="checkbox" checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} disabled={phase === 'sending'} />
                Incluir {privates} {plural(privates, 'tarefa privada', 'tarefas privadas')}
              </label>
            )}
            {phase === 'connect' && (
              <>
                <button className="b pri" onClick={connect} style={{ justifySelf: 'start' }}>Conectar ao Trello</button>
                <p className="hint" style={{ margin: 0 }}>Abre uma janela do Trello: entre com a sua conta e clique em <b>Permitir</b>. A permissão vale por 1 dia e fica só neste navegador.</p>
                <details>
                  <summary className="hint">A janela não voltou sozinha? Cole o código</summary>
                  <div className="field" style={{ marginTop: 8 }}>
                    <p className="hint" style={{ margin: 0 }}>
                      <a href={authorizeUrl(key, null)} target="_blank" rel="noreferrer">Abra esta página do Trello</a>, clique em <b>Permitir</b>, copie o código que aparecer e cole aqui.
                    </p>
                    <label htmlFor="exp-token">Código do Trello</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input id="exp-token" className="input" value={pasted} onChange={(e) => setPasted(e.target.value)} autoComplete="off" />
                      <button className="b" onClick={applyPasted} disabled={!pasted.trim()}>Usar código</button>
                    </div>
                  </div>
                </details>
              </>
            )}
            {phase === 'ready' && <p className="hint" style={{ margin: 0 }}>Conectado ao Trello. Clique em <b>Exportar</b> para criar o quadro lá.</p>}
            {phase === 'sending' && progress && (
              <div className="field">
                <span className="hint">{progress.total ? `Enviando para o Trello… ${progress.done} de ${progress.total}` : 'Lendo as tarefas…'}</span>
                <progress max={progress.total || 1} value={progress.done} style={{ width: '100%' }} />
              </div>
            )}
          </>
        )}
        <ErrorText error={error} />
      </div>
    </Dialog>
  );
}
