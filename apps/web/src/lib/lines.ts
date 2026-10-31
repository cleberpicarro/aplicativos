/** Item 30: texto com várias linhas ao criar tarefa. */

export const MAX_TITLE = 200;
export const MAX_BATCH = 50;

/** Tira do começo da linha os marcadores comuns de lista: “-”, “*”, “•”, “1.”, “2)”, “[ ]”, “[x]”. */
export function stripMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•–—]|\d{1,3}[.)]|\[[ xX]?\])\s+/, '').trim();
}

/** Uma entrada por linha não vazia, já sem marcador. */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map(stripMarker).filter(Boolean);
}

/** Opção “uma tarefa só”: a primeira linha vira o título e o resto, como foi escrito, a descrição. */
export function asSingle(text: string): { title: string; description: string } {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((l) => stripMarker(l));
  if (first < 0) return { title: '', description: '' };
  return { title: stripMarker(lines[first]), description: lines.slice(first + 1).join('\n').trim() };
}
