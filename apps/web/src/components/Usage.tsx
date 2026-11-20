import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { ErrorText } from './ui';

/**
 * Item 121: “Uso da plataforma”, aberto pelo botão em Pessoas (só administração).
 * Barras por dia (ou por mês, em períodos longos) empilhadas por pessoa: as 7 que mais usaram têm cor própria
 * e as demais ficam juntas em cinza. Conta as ações gravadas no log das tarefas.
 */
interface UsageData {
  from: string; to: string; today: string; unit: 'day' | 'month'; buckets: string[]; total: number;
  activeUsers: number; usedUsers: number; idle: string[];
  people: { id: string; name: string; active: boolean; series: number[]; total: number }[];
  byType: { group: string; n: number }[];
}

type Preset = 'month' | 'last-month' | '7' | '30' | 'year' | 'custom';
const PRESETS: [Preset, string][] = [['month', 'Este mês'], ['last-month', 'Mês passado'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['year', 'Este ano'], ['custom', 'Escolher datas']];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const TOP = 7;

/** “Hoje” no horário de Brasília, como AAAA-MM-DD. */
const todaySP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const shift = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const brFull = (iso: string) => `${br(iso)}/${iso.slice(0, 4)}`;
const monthLabel = (iso: string) => `${MONTHS[+iso.slice(5, 7) - 1]}/${iso.slice(2, 4)}`;
const fmt = (n: number) => n.toLocaleString('pt-BR');

function rangeOf(p: Preset, custom: { from: string; to: string }) {
  const t = todaySP();
  const first = `${t.slice(0, 7)}-01`;
  if (p === 'month') { const next = new Date(`${first}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1); return { from: first, to: shift(next.toISOString().slice(0, 10), -1) }; }
  if (p === 'last-month') { const end = shift(first, -1); return { from: `${end.slice(0, 7)}-01`, to: end }; }
  if (p === '7') return { from: shift(t, -6), to: t };
  if (p === '30') return { from: shift(t, -29), to: t };
  if (p === 'year') return { from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` };
  return custom;
}

export function UsagePanel({ onBack }: { onBack: () => void }) {
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState(() => ({ from: shift(todaySP(), -29), to: todaySP() }));
  const range = rangeOf(preset, custom);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to;
  const q = useQuery({
    queryKey: ['usage', range.from, range.to],
    queryFn: () => get<UsageData>(`/admin/usage?from=${range.from}&to=${range.to}`),
    enabled: valid,
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  return (
    <div className="usage">
      <div className="usage-head">
        <button className="b" onClick={onBack}><span aria-hidden="true">←</span>Pessoas</button>
        <h2>Uso da plataforma</h2>
      </div>
      <div className="usage-period">
        <div className="seg usage-seg" role="group" aria-label="Período">
          {PRESETS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={preset === k} onClick={() => setPreset(k)}>{label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <span className="usage-dates">
            <label>De <input className="input" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label>até <input className="input" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
          </span>
        )}
      </div>
      {!valid && <p className="err">A data final precisa ser igual ou depois da inicial.</p>}
      <ErrorText error={q.error} />
      {q.isLoading && <p className="loading">Carregando…</p>}
      {d && <UsageBody d={d} />}
    </div>
  );
}

function UsageBody({ d }: { d: UsageData }) {
  const series = useMemo(() => {
    const top = d.people.length <= TOP + 1 ? d.people : d.people.slice(0, TOP);
    const rest = d.people.slice(top.length);
    const s = top.map((p, i) => ({ name: p.name, values: p.series, total: p.total, color: `var(--u${i + 1})` }));
    if (rest.length) s.push({
      name: `Outras ${rest.length} pessoas`, color: 'var(--u-rest)', total: rest.reduce((a, p) => a + p.total, 0),
      values: d.buckets.map((_, i) => rest.reduce((a, p) => a + p.series[i], 0)),
    });
    return { s, topIds: new Set(top.map((p) => p.id)) };
  }, [d]);
  const totals = d.buckets.map((_, i) => series.s.reduce((a, x) => a + x.values[i], 0));
  const day = d.unit === 'day';
  const peak = totals.reduce((best, v, i) => (v > totals[best] ? i : best), 0);
  // Média por dia útil (segunda a sexta) até hoje; em períodos longos, média por mês.
  const pastDays = day ? d.buckets.filter((b) => b <= d.today && weekday(b) % 6 !== 0).length : 0;
  // Conta os meses só a partir do primeiro com alguma ação (antes disso o app não era usado).
  const firstUsed = totals.findIndex((v) => v > 0);
  const pastMonths = day || firstUsed < 0 ? 0 : d.buckets.filter((b, i) => i >= firstUsed && b <= d.today).length;
  const avg = day ? (pastDays ? Math.round(d.total / pastDays) : 0) : (pastMonths ? Math.round(d.total / pastMonths) : 0);
  const colorOf = (id: string, i: number) => (series.topIds.has(id) ? `var(--u${i + 1})` : 'var(--u-rest)');
  const maxPerson = Math.max(1, ...d.people.map((p) => p.total));
  const maxType = Math.max(1, ...d.byType.map((t) => t.n));
  return (
    <>
      <p className="hint usage-range">{brFull(d.from)} a {brFull(d.to)}{d.to >= d.today && d.from <= d.today ? ' · até agora' : ''}</p>
      <div className="usage-tiles">
        <div><b>{fmt(d.total)}</b><span>ações no período</span></div>
        <div><b>{d.usedUsers} de {d.activeUsers}</b><span>pessoas ativas usaram</span></div>
        <div><b>{d.total ? (day ? br(d.buckets[peak]) : monthLabel(d.buckets[peak])) : '—'}</b><span>{day ? 'dia' : 'mês'} de mais uso{d.total ? ` (${fmt(totals[peak])})` : ''}</span></div>
        <div><b>{fmt(avg)}</b><span>{day ? 'média por dia útil' : 'média por mês de uso'}</span></div>
      </div>
      {d.total === 0 ? <div className="empty">Nenhuma ação registrada neste período.</div> : (
        <>
          <h3>Ações por {day ? 'dia' : 'mês'}, por pessoa</h3>
          <div className="usage-legend">{series.s.map((x) => <span key={x.name}><i style={{ background: x.color }} />{x.name}</span>)}</div>
          <Chart d={d} series={series.s} totals={totals} />
          <p className="hint">{day ? 'Dias em vermelho: sábado e domingo. ' : ''}Passe o mouse num pedaço da barra para ver a pessoa e o número.</p>
          <h3>Total por pessoa</h3>
          <div className="usage-rows">
            {d.people.map((p, i) => (
              <div key={p.id} className="usage-row">
                <span><i style={{ background: colorOf(p.id, i) }} />{p.name}{!p.active && <span className="hint"> · inativa</span>}</span>
                <span className="usage-bar"><b style={{ width: `${(p.total / maxPerson) * 100}%`, background: colorOf(p.id, i) }} /></span>
                <span className="usage-n">{fmt(p.total)} <em>{Math.round((p.total / d.total) * 100)}%</em></span>
              </div>
            ))}
          </div>
          <h3>Por tipo de ação</h3>
          <div className="usage-rows">
            {d.byType.map((t) => (
              <div key={t.group} className="usage-row">
                <span>{t.group}</span>
                <span className="usage-bar"><b style={{ width: `${(t.n / maxType) * 100}%`, background: 'var(--u1)' }} /></span>
                <span className="usage-n">{fmt(t.n)} <em>{Math.round((t.n / d.total) * 100)}%</em></span>
              </div>
            ))}
          </div>
        </>
      )}
      {d.idle.length > 0 && <p className="hint usage-note">Sem nenhuma ação no período: {d.idle.join(', ')}.</p>}
      <p className="hint usage-note">Conta cada ação gravada no histórico das tarefas (criar, editar, mover, concluir, dar ciente, delegar, aceitar, devolver, cobrar, comentar). Abrir uma tarefa só para olhar não conta.</p>
    </>
  );
}

function Chart({ d, series, totals }: { d: UsageData; series: { name: string; values: number[]; color: string }[]; totals: number[] }) {
  const n = d.buckets.length;
  const W = n > 31 ? n * 30 : 1000, H = 280, L = 40, B = 28, T = 22;
  const max = niceMax(Math.max(...totals));
  const cw = (W - L) / n, bw = Math.min(48, Math.max(4, cw - Math.min(8, cw * 0.25)));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 1, 2, 3].map((i) => (max / 3) * i);
  const day = d.unit === 'day';
  const every = n > 31 ? Math.ceil(n / 31) : 1;
  const showTotals = n <= 31;
  return (
    <div className="usage-chart">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: n > 31 ? W : '100%', minWidth: n > 15 ? 640 : undefined }} role="img" aria-label={`Ações por ${day ? 'dia' : 'mês'}, por pessoa`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{fmt(Math.round(t))}</text>
          </g>
        ))}
        {d.buckets.map((b, i) => {
          const cx = L + i * cw + (cw - bw) / 2;
          const we = day && weekday(b) % 6 === 0;
          const isToday = day ? b === d.today : b.slice(0, 7) === d.today.slice(0, 7);
          const label = day ? (i === 0 || b.endsWith('-01') ? br(b) : String(+b.slice(8, 10))) : monthLabel(b);
          let base = 0;
          return (
            <g key={b}>
              {i % every === 0 && (
                <text x={cx + bw / 2} y={H - 9} textAnchor="middle" fontSize="12" fontWeight={isToday ? 700 : 400}
                  fill={we ? 'var(--late)' : isToday ? 'var(--fg)' : 'var(--muted)'}>{label}</text>
              )}
              {series.map((s) => {
                const v = s.values[i];
                if (!v) return null;
                const top = y(base + v), h = Math.max(1, y(base) - top - (base ? 1.5 : 0));
                base += v;
                return <rect key={s.name} x={cx} y={top} width={bw} height={h} fill={s.color}><title>{`${day ? brFull(b) : monthLabel(b)} · ${s.name}: ${fmt(v)}`}</title></rect>;
              })}
              {showTotals && totals[i] > 0 && <text x={cx + bw / 2} y={y(totals[i]) - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--fg)">{fmt(totals[i])}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Topo do eixo arredondado para cima (3 linhas de grade com números redondos). */
function niceMax(v: number) {
  if (v <= 3) return 3;
  const step = v / 3;
  const p = 10 ** Math.floor(Math.log10(step));
  const m = [1, 2, 2.5, 5, 10].find((k) => k * p >= step)!;
  return m * p * 3;
}
