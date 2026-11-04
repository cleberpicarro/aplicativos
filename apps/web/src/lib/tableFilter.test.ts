import { describe as group, it, expect } from 'vitest';
import { cleanFilter, defaultValue, describe, isComplete, newCondition, opsFor, READY, toCsv, type Names } from './tableFilter';

const names: Names = { boards: { b1: 'Comercial' }, lists: { l1: 'Comercial · Fazendo' }, people: { p1: 'Marina' } };

group('filtro da tabela (item 36)', () => {
  it('cada campo oferece só os operadores dele', () => {
    expect(opsFor('code')).toEqual(['eq']);
    expect(opsFor('due')).toContain('next_days');
    expect(opsFor('title')).not.toContain('before');
  });
  it('valor inicial conforme o tipo', () => {
    expect(defaultValue('due', 'before')).toBe('today');
    expect(defaultValue('due', 'next_days')).toBe(7);
    expect(defaultValue('status', 'eq')).toBe('open');
    expect(defaultValue('title', 'empty')).toBeNull();
    expect(newCondition('archived')).toEqual({ field: 'archived', op: 'eq', value: true });
  });
  it('condição incompleta não vai para o servidor', () => {
    expect(isComplete({ field: 'title', op: 'contains', value: '  ' })).toBe(false);
    expect(isComplete({ field: 'due', op: 'between', value: ['2026-10-01', ''] })).toBe(false);
    expect(isComplete({ field: 'description', op: 'empty' })).toBe(true);
    const f = cleanFilter({ all: [{ field: 'title', op: 'contains', value: '' }, { field: 'status', op: 'eq', value: 'open' }], any: [] });
    expect(f.all).toHaveLength(1);
  });
  it('etiquetas em português', () => {
    expect(describe({ field: 'due', op: 'before', value: 'today' }, names)).toBe('Prazo antes de hoje');
    expect(describe({ field: 'due', op: 'next_days', value: 7 }, names)).toBe('Prazo nos próximos 7 dias');
    expect(describe({ field: 'due', op: 'between', value: ['2026-10-01', '2026-10-31'] }, names)).toBe('Prazo entre 01/10/2026 e 31/10/2026');
    expect(describe({ field: 'board', op: 'neq', value: 'b1' }, names)).toBe('Quadro não é Comercial');
    expect(describe({ field: 'delegatedTo', op: 'eq', value: 'p1' }, names)).toBe('Delegada para é Marina');
    expect(describe({ field: 'delegatedTo', op: 'not_empty' }, names)).toBe('Delegada para é alguém');
    expect(describe({ field: 'title', op: 'contains', value: 'galpão' }, names)).toBe('Título contém “galpão”');
    expect(describe({ field: 'archived', op: 'eq', value: true }, names)).toBe('Arquivada é sim');
  });
  it('filtros prontos são válidos', () => {
    for (const r of READY) expect(cleanFilter(r.filter), r.name).toEqual(r.filter);
  });
  it('planilha com ponto e vírgula, aspas e acentos', () => {
    const csv = toCsv(['Código', 'Tarefa'], [['ST-000001', 'Comprar "papel"; caneta'], ['ST-000002', null]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual(['Código;Tarefa', 'ST-000001;"Comprar ""papel""; caneta"', 'ST-000002;']);
  });
});
