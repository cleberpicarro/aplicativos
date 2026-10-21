import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { parseImportFile, type ImportFile, type TrelloPreview } from '../lib/trello';
import { plural } from '../lib/format';
import { Dialog, ErrorText, useMe } from './ui';

interface Result { boardId: string; lists: number; cards: number; checklistItems: number; comments: number }

/** Item 62: arquivo baixado pelo "Exportar tarefas (JSON)". Cada quadro segue o formato do JSON do Trello. */
interface ExportData {
  quadros: { name: string; closed: boolean; synctasks?: { caixaDeEntrada?: boolean }; cards: { closed: boolean; synctasks?: { privada?: boolean } }[] }[];
}

/** Item 62: baixa um arquivo JSON com todas as tarefas da pessoa, de todos os quadros. Nada muda no SyncTasks. */
export function ExportTasksDialog({ onClose }: { onClose: () => void }) {
  const today = useMe().data?.today ?? new Date().toISOString().slice(0, 10);
  const [data, setData] = useState<ExportData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    get<ExportData>('/export').then(setData, setError);
  }, []);

  const cards = data?.quadros.flatMap((q) => q.cards) ?? [];
  const archived = cards.filter((c) => c.closed).length;
  const privates = cards.filter((c) => c.synctasks?.privada).length;
  const boards = data?.quadros.filter((q) => !q.synctasks?.caixaDeEntrada) ?? [];
  const closedBoards = boards.filter((q) => q.closed).length;
  const inbox = data?.quadros.some((q) => q.synctasks?.caixaDeEntrada);
  const fileName = `synctasks-tarefas-${today}.json`;

  const download = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  };

  return (
    <Dialog title="Exportar tarefas (JSON)" onClose={onClose} footer={<>
      <button className="b" onClick={onClose}>{saved ? 'Fechar' : 'Cancelar'}</button>
      <button className="b pri" onClick={download} disabled={!data}>Baixar arquivo</button>
    </>}>
      <div className="dialog-b" style={{ padding: 0 }}>
        {!data && !error && <p className="hint">Juntando as suas tarefas…</p>}
        {data && (
          <div className="box" style={{ display: 'grid', gap: 4 }}>
            <b style={{ fontWeight: 500 }}>O arquivo {fileName} vai ter todas as suas tarefas:</b>
            <span>
              {boards.length} {plural(boards.length, 'quadro', 'quadros')}{closedBoards ? ` (${closedBoards} ${plural(closedBoards, 'arquivado', 'arquivados')})` : ''}
              {inbox ? ' e a caixa de entrada' : ''}, com {cards.length} {plural(cards.length, 'tarefa', 'tarefas')}
              {archived ? `, ${archived} ${plural(archived, 'arquivada', 'arquivadas')}` : ''}{privates ? ` e ${privates} ${plural(privates, 'privada', 'privadas')}` : ''}
            </span>
            <span>Cada tarefa leva fase, número, título, descrição, prazo, se está concluída, cor, checklist, comentários e a situação da delegação.</span>
            <span className="muted">Nada muda aqui no SyncTasks. Para trazer de volta, use <b>Importar arquivo JSON</b> no menu … do quadro.</span>
          </div>
        )}
        {saved && <p className="hint" role="status" style={{ margin: 0 }}>Arquivo baixado. Ele fica na pasta de downloads do navegador.</p>}
        <ErrorText error={error} />
      </div>
    </Dialog>
  );
}

/** Importa o JSON de um quadro do Trello ou o arquivo do "Exportar tarefas (JSON)" (item 62), que pode ter vários quadros. */
export function ImportFileDialog({ onClose, onImported }: { onClose: () => void; onImported: (boardId: string, boards: number) => void }) {
  const [file, setFile] = useState<ImportFile | null>(null);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<boolean[]>([]);
  const [readError, setReadError] = useState<unknown>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(null);
    setReadError(null);
    if (!f) return;
    setReading(true);
    try {
      const text = await f.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('Não foi possível ler o arquivo. Escolha o arquivo .json exportado do Trello ou do SyncTasks.');
      }
      const p = parseImportFile(json);
      setFile(p);
      setName(p.boards[0].payload.boardName);
      setChosen(p.boards.map(() => true));
    } catch (err) {
      setReadError(err);
    } finally {
      setReading(false);
    }
  };

  const picked: TrelloPreview[] = file ? file.boards.filter((_, i) => chosen[i]) : [];
  const busy = progress !== null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !picked.length) return;
    setError(null);
    setProgress({ done: 0, total: picked.length });
    let first: string | null = null;
    let done = 0;
    try {
      // Um quadro por vez: se algo falhar, os quadros anteriores já ficaram importados.
      for (let i = 0; i < picked.length; i++) {
        const payload = file.kind === 'trello' ? { ...picked[i].payload, boardName: name.trim() || picked[i].payload.boardName } : picked[i].payload;
        const r = await post<Result>('/import/trello', payload);
        first ??= r.boardId;
        setProgress({ done: ++done, total: picked.length });
      }
      await qc.invalidateQueries();
      onImported(first!, picked.length);
    } catch (err) {
      if (first) await qc.invalidateQueries();
      setError(first
        ? new Error(`${(err as Error).message} Foram importados ${done} dos ${picked.length} quadros antes do erro.`)
        : err);
      setProgress(null);
    }
  };

  const sum = (k: keyof TrelloPreview['stats']) => picked.reduce((n, b) => n + b.stats[k], 0);
  const cards = sum('cards');
  const s = file?.kind === 'trello' ? file.boards[0].stats : null;
  const left = s ? [
    s.archivedCards ? `${s.archivedCards} ${plural(s.archivedCards, 'cartão arquivado', 'cartões arquivados')}` : '',
    s.archivedLists ? `${s.archivedLists} ${plural(s.archivedLists, 'lista arquivada', 'listas arquivadas')}` : '',
    s.labels ? `${s.labels} ${plural(s.labels, 'etiqueta', 'etiquetas')}` : '',
    s.attachments ? `${s.attachments} ${plural(s.attachments, 'anexo', 'anexos')}` : '',
  ].filter(Boolean) : file ? [
    sum('archivedCards') ? `${sum('archivedCards')} ${plural(sum('archivedCards'), 'tarefa arquivada', 'tarefas arquivadas')}` : '',
    file.skippedBoards ? `${file.skippedBoards} ${plural(file.skippedBoards, 'quadro arquivado', 'quadros arquivados')}` : '',
  ].filter(Boolean) : [];

  return (
    <Dialog title="Importar arquivo JSON" onClose={busy ? () => {} : onClose} footer={<>
      <button className="b" onClick={onClose} disabled={busy}>Cancelar</button>
      <button className="b pri" type="submit" form="imp" disabled={!picked.length || busy}>
        {busy ? `Importando… ${progress!.done} de ${progress!.total}`
          : !file ? 'Importar'
          : file.kind === 'trello' ? `Importar ${cards} ${plural(cards, 'tarefa', 'tarefas')}`
          : `Importar ${picked.length} ${plural(picked.length, 'quadro', 'quadros')}`}
      </button>
    </>}>
      <form id="imp" onSubmit={submit} className="dialog-b" style={{ padding: 0 }}>
        <ul className="hint" style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.6 }}>
          <li><b>Do SyncTasks:</b> o arquivo baixado em <b>Exportar tarefas (JSON)</b>, no menu … do quadro.</li>
          <li><b>Do Trello:</b> abra o quadro, menu <b>…</b> → <b>Imprimir, exportar e compartilhar</b> → <b>Exportar como JSON</b>.</li>
        </ul>
        <div className="field">
          <label htmlFor="imp-file">Arquivo JSON (do SyncTasks ou do Trello)</label>
          <input id="imp-file" type="file" accept=".json,application/json" onChange={pick} className="input" style={{ paddingTop: 4 }} disabled={busy} />
        </div>
        {reading && <p className="hint">Lendo o arquivo…</p>}
        <ErrorText error={readError} />

        {file?.kind === 'trello' && s && (
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

        {file?.kind === 'synctasks' && (
          <>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="hint" style={{ marginBottom: 4 }}>Quadros do arquivo (cada um vira um quadro novo seu):</legend>
              {file.boards.map((b, i) => (
                <label key={i} className="check">
                  <input type="checkbox" checked={chosen[i]} disabled={busy}
                    onChange={(e) => setChosen(chosen.map((v, j) => (j === i ? e.target.checked : v)))} />
                  {b.payload.boardName} · {b.stats.cards} {plural(b.stats.cards, 'tarefa', 'tarefas')}
                </label>
              ))}
            </fieldset>
            <div className="box" style={{ display: 'grid', gap: 4 }}>
              <b style={{ fontWeight: 500 }}>Vão ser criados {picked.length} {plural(picked.length, 'quadro novo', 'quadros novos')} com {cards} {plural(cards, 'tarefa', 'tarefas')}</b>
              <span>Com fases na mesma ordem, título, descrição, prazo, concluída, cor, privada, checklist e comentários (em seu nome, com o autor e a data originais no texto).</span>
              <span className="muted">Cada tarefa ganha um número novo no quadro novo. Delegações não voltam: as tarefas ficam só com você.</span>
              {left.length > 0 && <span className="muted">Ficam de fora: {left.join(', ')}.</span>}
            </div>
          </>
        )}
        <ErrorText error={error} />
      </form>
    </Dialog>
  );
}
