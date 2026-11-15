import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, patch } from '../lib/api';
import { ErrorText, useMe } from '../components/ui';
import { LATE_TONES, TODAY_TONES, toneOf } from '../lib/format';
import { useAction } from '../components/dialogs';

/**
 * Item 96: configurações que valem para todos, com item próprio no menu (antes era um botão em Pessoas, item 94).
 * Configurações gerais futuras entram aqui, cada uma no seu bloco.
 */
interface AppSettings { lateOn: boolean; lateColor: string; todayOn: boolean; todayColor: string }

export function SettingsPage() {
  const me = useMe().data!;
  if (!me.user.isAdmin) return <div className="page"><div className="empty">Somente a administração acessa esta tela.</div></div>;
  return (
    <div className="page settings-page">
      <p className="hint" style={{ marginTop: 0 }}>Valem para todas as pessoas, em qualquer computador e no celular.</p>
      <HighlightSettings />
    </div>
  );
}

function HighlightSettings() {
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => get<AppSettings>('/admin/settings') });
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const s = draft ?? q.data ?? null;
  const set = (p: Partial<AppSettings>) => s && setDraft({ ...s, ...p });
  const { run, busy, error } = useAction();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!s) return;
    if ((await run(() => patch('/admin/settings', s), 'Configurações salvas. Valem para todos.')) !== undefined) setDraft(null);
  };
  const part = (key: 'late' | 'today', label: string, tones: typeof LATE_TONES | typeof TODAY_TONES, example: string) => {
    if (!s) return null;
    const on = key === 'late' ? s.lateOn : s.todayOn;
    const color = key === 'late' ? s.lateColor : s.todayColor;
    const tone = toneOf(tones, color);
    return (
      <fieldset className="hl-part">
        <label className="check"><input type="checkbox" checked={on} onChange={(e) => set(key === 'late' ? { lateOn: e.target.checked } : { todayOn: e.target.checked })} /><b>{label}</b></label>
        <div className="swatches hl-swatches" role="radiogroup" aria-label={key === 'late' ? 'Cor das atrasadas' : 'Cor das que vencem hoje'}>
          {tones.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={color === t.id} className="sw-opt" disabled={!on}
              onClick={() => set(key === 'late' ? { lateColor: t.id } : { todayColor: t.id })}>
              <span className="swatch big" style={{ background: t.bg }} aria-hidden="true" />{t.label}
            </button>
          ))}
        </div>
        {on && tone && <div className="hl-sample" style={{ background: tone.bg, color: tone.ink }}>Exemplo: {example}</div>}
      </fieldset>
    );
  };
  return (
    <section className="settings-block" aria-labelledby="st-hl">
      <h2 id="st-hl">Destaque de prazos</h2>
      <form onSubmit={save} className="hl-form">
        <p className="hint" style={{ margin: 0 }}>Pinta os cartões do Quadro e as linhas da Tabela, de Tarefas delegadas e da Caixa de entrada.</p>
        {q.isLoading && <p className="loading">Carregando…</p>}
        <ErrorText error={q.error ?? error} />
        {part('late', 'Destacar tarefas atrasadas', LATE_TONES, 'Atualizar planilha · 12 nov')}
        {part('today', 'Destacar tarefas que vencem hoje', TODAY_TONES, 'Mapear processos · hoje')}
        {s && <p className="hint" style={{ margin: 0 }}>As letras ficam em negrito, brancas ou pretas, conforme a cor, para ler bem. Tarefa concluída ou aguardando o seu ciente não é pintada.</p>}
        <div className="settings-actions">
          {draft && <button type="button" className="b" onClick={() => setDraft(null)}>Desfazer mudanças</button>}
          <button className="b pri" type="submit" disabled={busy || !s || !draft}>Salvar</button>
        </div>
      </form>
    </section>
  );
}
