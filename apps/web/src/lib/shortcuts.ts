/*
 * Item 56: atalhos de teclado. Só valem quando a pessoa não está escrevendo num campo.
 */

/** A tecla foi apertada dentro de um campo de texto (ou com Ctrl/Alt/Cmd): não é atalho. */
export function isTyping(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

/** Ctrl+Enter (ou Cmd+Enter no Mac). */
export const isCtrlEnter = (e: { key: string; ctrlKey: boolean; metaKey: boolean }) => e.key === 'Enter' && (e.ctrlKey || e.metaKey);

/** Tecla N: abrir a criação de tarefa na primeira fase do quadro aberto. */
export const NEW_TASK_EVENT = 'synctasks:nova-tarefa';
let newTaskRequested = false;
export function requestNewTask() {
  newTaskRequested = true;
  window.dispatchEvent(new Event(NEW_TASK_EVENT));
}
/** O pedido vale uma vez só: quem abre a criação de tarefa o consome (também ao chegar no quadro depois do pedido). */
export function takeNewTaskRequest() {
  const asked = newTaskRequested;
  newTaskRequested = false;
  return asked;
}

export const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['N'], what: 'Nova tarefa na primeira fase do quadro' },
  { keys: ['/'], what: 'Buscar tarefa ou número' },
  { keys: ['C'], what: 'Concluir (ou desfazer a conclusão) da tarefa aberta' },
  { keys: ['D'], what: 'Delegar a tarefa aberta' },
  { keys: ['Ctrl', 'Enter'], what: 'Enviar o comentário, salvar a descrição ou confirmar a janela aberta' },
  { keys: ['Esc'], what: 'Fechar a janela ou o menu' },
  { keys: ['?'], what: 'Mostrar esta lista de atalhos' },
];
