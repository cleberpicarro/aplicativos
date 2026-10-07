import { describe, expect, it } from 'vitest';
import { asSingle, splitLines, stripMarker } from './lines';

describe('item 30: várias linhas', () => {
  it('tira marcadores de lista do começo da linha', () => {
    expect(stripMarker('- Ligar para o cliente')).toBe('Ligar para o cliente');
    expect(stripMarker('• Revisar contrato')).toBe('Revisar contrato');
    expect(stripMarker('  12. Enviar proposta ')).toBe('Enviar proposta');
    expect(stripMarker('3) Pagar boleto')).toBe('Pagar boleto');
    expect(stripMarker('[x] Feito')).toBe('Feito');
    expect(stripMarker('2026 orçamento')).toBe('2026 orçamento');
    expect(stripMarker('-5 graus')).toBe('-5 graus');
  });
  it('uma entrada por linha, ignorando as vazias', () => {
    expect(splitLines('A\n\n  \r\n- B\n3. C\n')).toEqual(['A', 'B', 'C']);
    expect(splitLines('só uma')).toEqual(['só uma']);
  });
  it('uma tarefa só: primeira linha é o título, o resto é a descrição', () => {
    expect(asSingle('\n- Reunião\n- pauta 1\n- pauta 2\n')).toEqual({ title: 'Reunião', description: '- pauta 1\n- pauta 2' });
    expect(asSingle('   ')).toEqual({ title: '', description: '' });
  });
});
