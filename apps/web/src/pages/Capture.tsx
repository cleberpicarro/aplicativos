import { useEffect, useState, type FormEvent } from 'react';
import { post } from '../lib/api';
import { go } from '../lib/router';
import { ErrorText, useToast } from '../components/ui';

/**
 * Item 14: janela aberta pelo botão "+ SyncTask" dos favoritos (ou pelo "Compartilhar" do Android).
 * Chega com título, endereço e texto selecionado; a tarefa vai para a caixa de entrada.
 */
export function CapturePage({ params }: { params: URLSearchParams }) {
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [text, setText] = useState(params.get('text') ?? '');
  const url = params.get('url') ?? '';
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
      const r = await post<{ code: string }>('/capture', { title, url, text });
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
          {url && (
            <div className="field">
              <span className="label">Link</span>
              <a className="cap-url" href={url} target="_blank" rel="noreferrer noopener">{url}</a>
            </div>
          )}
          <div className="field">
            <label htmlFor="cap-text">Trecho ou observação (opcional)</label>
            <textarea id="cap-text" className="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
          </div>
          <ErrorText error={error} />
          <button className="b pri" type="submit" disabled={busy || (!title.trim() && !url)}>{busy ? 'Salvando…' : 'Salvar na caixa de entrada'}</button>
        </form>
      )}
    </div>
  );
}

/** Código do favorito: abre a janela de captura com o título, o endereço e o texto selecionado da página atual. */
export function bookmarkletCode(origin: string) {
  return `javascript:(()=>{const s=String(getSelection()).slice(0,2000);window.open('${origin}/#/capturar?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(s),'synctask','width=480,height=620')})()`;
}

/** Botão para arrastar até a barra de favoritos do navegador. */
export function BookmarkletButton() {
  const toast = useToast();
  return (
    <a
      className="bookmarklet"
      ref={(el) => el?.setAttribute('href', bookmarkletCode(window.location.origin))}
      onClick={(e) => { e.preventDefault(); toast('Arraste este botão para a barra de favoritos do navegador.'); }}
      title="Arraste para a barra de favoritos"
    >
      + SyncTask
    </a>
  );
}
