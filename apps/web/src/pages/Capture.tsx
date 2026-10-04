import { useEffect, useState, type FormEvent } from 'react';
import { post } from '../lib/api';
import { go } from '../lib/router';
import { Dialog, ErrorText, useToast } from '../components/ui';

/**
 * Item 14: janela aberta pelo botão "+ SyncTask" dos favoritos (ou pelo "Compartilhar" do Android).
 * Chega com título, endereço e texto selecionado; a tarefa vai para a caixa de entrada.
 */
export function CapturePage({ params }: { params: URLSearchParams }) {
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [text, setText] = useState(params.get('text') ?? '');
  const fromPage = params.get('url') ?? '';
  const [url, setUrl] = useState(fromPage);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const popup = typeof window !== 'undefined' && !!window.opener;

  useEffect(() => {
    if (saved && popup) {
      const t = window.setTimeout(() => window.close(), 1800);
      return () => window.clearTimeout(t);
    }
  }, [saved, popup]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ code: string }>('/capture', { title, url: url.trim(), text });
      setSaved(r.code);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="capture">
      <div className="brand"><img src="/icon.svg" alt="" />SyncTask</div>
      {saved ? (
        <div className="capture-card">
          <h1>Salvo na caixa de entrada</h1>
          <p>A tarefa <span className="code">{saved}</span> está na sua caixa de entrada para você organizar depois.</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {popup && <button className="b pri" onClick={() => window.close()}>Fechar</button>}
            <button className="b" onClick={() => go('/entrada')}>Abrir a caixa de entrada</button>
          </div>
          {popup && <p className="hint">Esta janela fecha sozinha.</p>}
        </div>
      ) : (
        <form className="capture-card" onSubmit={submit}>
          <h1>Nova tarefa a partir da página</h1>
          <div className="field">
            <label htmlFor="cap-title">Título</label>
            <input id="cap-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} autoFocus />
          </div>
          {fromPage ? (
            <div className="field">
              <span className="label">Link</span>
              <a className="cap-url" href={url} target="_blank" rel="noreferrer noopener">{url}</a>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="cap-url">Link (cole o endereço da página)</label>
              <input id="cap-url" className="input" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} />
            </div>
          )}
          <div className="field">
            <label htmlFor="cap-text">Trecho ou observação (opcional)</label>
            <textarea id="cap-text" className="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
          </div>
          <ErrorText error={error} />
          {!popup && <button type="button" className="b ghost" onClick={() => go('/entrada')}>Voltar para a caixa de entrada</button>}
          <button className="b pri" type="submit" disabled={busy || (!title.trim() && !url.trim())}>{busy ? 'Salvando…' : 'Salvar na caixa de entrada'}</button>
        </form>
      )}
    </div>
  );
}

/** Código do favorito: abre a janela de captura com o título, o endereço e o texto selecionado da página atual. */
export function bookmarkletCode(origin: string) {
  // Se o navegador bloquear a janela, abre a captura na própria aba.
  return `javascript:(()=>{const s=String(getSelection()).slice(0,2000);const u='${origin}/#/capturar?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(s);if(!window.open(u,'synctask','width=480,height=620'))location.href=u})()`;
}

/** Botão para arrastar até a barra de favoritos. Clicar nele explica como instalar. */
export function BookmarkletButton() {
  const [help, setHelp] = useState(false);
  return (
    <>
      <a
        className="bookmarklet"
        ref={(el) => el?.setAttribute('href', bookmarkletCode(window.location.origin))}
        onClick={(e) => { e.preventDefault(); setHelp(true); }}
        title="Arraste para a barra de favoritos. Clique para ver como."
      >
        + SyncTask
      </a>
      {help && <CaptureHelpDialog onClose={() => setHelp(false)} />}
    </>
  );
}

function CaptureHelpDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const code = bookmarkletCode(window.location.origin);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Código copiado.');
    } catch {
      toast('Não foi possível copiar. Selecione o código e use Ctrl+C.');
    }
  };
  return (
    <Dialog title="Instalar o botão + SyncTask" onClose={onClose}
      footer={<button className="b pri" onClick={onClose}>Entendi</button>}>
      <div className="cap-help">
        <p>O botão fica na barra de favoritos do Chrome (ou Edge). Clicar nele aqui dentro do SyncTask não faz nada: ele funciona nas <b>outras</b> páginas.</p>
        <h4>Jeito 1: arrastar</h4>
        <ol>
          <li>Mostre a barra de favoritos: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.</li>
          <li>Feche esta janela e arraste o botão azul <b>+ SyncTask</b> até a barra.</li>
        </ol>
        <h4>Jeito 2: criar o favorito à mão</h4>
        <ol>
          <li><button className="b sm" onClick={copy}>Copiar código</button></li>
          <li>Clique com o botão direito na barra de favoritos → <b>Adicionar página…</b></li>
          <li>Nome: <b>+ SyncTask</b>. Em <b>URL</b>, cole o código (<kbd>Ctrl</kbd>+<kbd>V</kbd>) e salve.</li>
        </ol>
        <h4>Para usar</h4>
        <p>Em qualquer site, selecione um trecho (opcional) e clique em <b>+ SyncTask</b> na barra. Abre uma janela pequena: confira o título e clique em <b>Salvar na caixa de entrada</b>. Se você ainda não entrou no SyncTask nesse navegador, ele pede o login primeiro.</p>
        <p className="hint">Se você mudou de endereço do SyncTask, apague o favorito antigo e instale de novo: ele guarda o endereço de onde foi instalado.</p>
        <h4>Sem favorito</h4>
        <p><button className="b sm" onClick={() => go('/capturar')}>Colar um link</button> abre o formulário para criar a tarefa colando o endereço.</p>
      </div>
    </Dialog>
  );
}
