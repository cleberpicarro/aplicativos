import { useState, type ChangeEvent, type FormEvent } from 'react';
import { post } from '../lib/api';
import { parseTrello, type TrelloPreview } from '../lib/trello';
import { plural } from '../lib/format';
import { Dialog, ErrorText } from './ui';
import { useAction } from './dialogs';

interface Result { boardId: string; lists: number; cards: number; checklistItems: number; comments: number }

export function ImportTrelloDialog({ onClose, onImported }: { onClose: () => void; onImported: (boardId: string) => void }) {
  const [preview, setPreview] = useState<TrelloPreview | null>(null);
  const [name, setName] = useState('');
  const [readError, setReadError] = useState<unknown>(null);
  const [reading, setReading] = useState(false);
  const { run, busy, error } = useAction();

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPreview(null);
    setReadError(null);
    if (!file) return;
    setReading(true);
    try {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('Não foi possível ler o arquivo. Escolha o arquivo .json exportado do Trello.');
      }
      const p = parseTrello(json);
      setPreview(p);
      setName(p.payload.boardName);
    } catch (err) {
      setReadError(err);
    } finally {
      setReading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    const r = await run(
      () => post<Result>('/import/trello', { ...preview.payload, boardName: name.trim() || preview.payload.boardName }),
      undefined,
    );
    if (r) onImported(r.boardId);
  };

  const s = preview?.stats;
  const left = s ? [
    s.archivedCards ? `${s.archivedCards} ${plural(s.archivedCards, 'cartão arquivado', 'cartões arquivados')}` : '',
    s.archivedLists ? `${s.archivedLists} ${plural(s.archivedLists, 'lista arquivada', 'listas arquivadas')}` : '',
    s.labels ? `${s.labels} ${plural(s.labels, 'etiqueta', 'etiquetas')}` : '',
    s.attachments ? `${s.attachments} ${plural(s.attachments, 'anexo', 'anexos')}` : '',
  ].filter(Boolean) : [];

  return (
    <Dialog title="Importar do Trello" onClose={onClose} footer={<>
      <button className="b" onClick={onClose}>Cancelar</button>
      <button className="b pri" type="submit" form="imp" disabled={!preview || busy}>
        {busy ? 'Importando…' : preview ? `Importar ${s!.cards} ${plural(s!.cards, 'tarefa', 'tarefas')}` : 'Importar'}
      </button>
    </>}>
      <form id="imp" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <ol className="hint" style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.6 }}>
          <li>No Trello, abra o quadro e clique no menu <b>…</b> (canto superior direito).</li>
          <li>Escolha <b>Imprimir, exportar e compartilhar</b> → <b>Exportar como JSON</b> e salve o arquivo.</li>
          <li>Escolha esse arquivo abaixo.</li>
        </ol>
        <div className="field">
          <label htmlFor="imp-file">Arquivo exportado do Trello (.json)</label>
          <input id="imp-file" type="file" accept=".json,application/json" onChange={pick} className="input" style={{ paddingTop: 4 }} />
        </div>
        {reading && <p className="hint">Lendo o arquivo…</p>}
        <ErrorText error={readError} />

        {preview && s && (
          <>
            <div className="field">
              <label htmlFor="imp-name">Nome do novo quadro</label>
              <input id="imp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </div>
            <div className="box" style={{ display: 'grid', gap: 4 }}>
              <b style={{ fontWeight: 500 }}>Vai ser criado um quadro novo seu com:</b>
              <span>{s.lists} {plural(s.lists, 'fase', 'fases')} (as listas do Trello) e {s.cards} {plural(s.cards, 'tarefa', 'tarefas')}{s.completed ? `, ${s.completed} já ${plural(s.completed, 'concluída', 'concluídas')}` : ''}</span>
              {s.checklistItems > 0 && <span>{s.checklistItems} {plural(s.checklistItems, 'item', 'itens')} de checklist</span>}
              {s.comments > 0 && <span>{s.comments} {plural(s.comments, 'comentário', 'comentários')}, em seu nome, com o autor e a data originais no texto</span>}
              {left.length > 0 && <span className="muted">Ficam de fora: {left.join(', ')}.</span>}
            </div>
            <p className="hint">
              Todas as tarefas ficam com você. Os membros dos cartões no Trello ficam anotados na descrição; para entregar uma tarefa a alguém da sua equipe, use Delegar depois.
              O Trello pode não incluir no arquivo os comentários mais antigos de quadros com muita atividade.
            </p>
          </>
        )}
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}
