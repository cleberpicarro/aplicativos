import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { ErrorText } from './ui';

/** Converte a chave pública (base64url) no formato que o navegador pede. */
function keyBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * Item 119 (F6 da revisão geral): avisos neste aparelho. Liga as notificações do navegador (celular ou computador)
 * para receber na hora os mesmos avisos da tela Avisos. Só aparece quando o servidor tem as chaves.
 */
export function PushBox() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['push'], queryFn: () => get<{ publicKey: string | null; devices: number }>('/push') });
  const [here, setHere] = useState<PushSubscription | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!supported()) { setHere(null); return; }
    navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription() ?? null).then((s) => setHere(s ?? null), () => setHere(null));
  }, []);

  if (!q.data?.publicKey) return null;
  const blocked = supported() && Notification.permission === 'denied';

  const on = async () => {
    setBusy(true); setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('O navegador não deu permissão para avisos. Libere nas configurações do site e tente de novo.');
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(q.data!.publicKey!) });
      const j = s.toJSON();
      await post('/push/subscribe', { endpoint: j.endpoint, keys: j.keys });
      setHere(s);
      qc.invalidateQueries({ queryKey: ['push'] });
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const off = async () => {
    if (!here) return;
    setBusy(true); setError(null);
    try {
      await post('/push/unsubscribe', { endpoint: here.endpoint });
      await here.unsubscribe();
      setHere(null);
      qc.invalidateQueries({ queryKey: ['push'] });
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <fieldset className="my-mail">
      <legend>Avisos neste aparelho</legend>
      {!supported() ? (
        <p className="hint" style={{ margin: 0 }}>Este navegador não mostra avisos. No celular, instale o SyncTasks na tela inicial (no iPhone, pelo Safari: Compartilhar › Adicionar à Tela de Início) e abra por lá.</p>
      ) : here ? (
        <>
          <p style={{ margin: 0 }}>Ligado: os avisos chegam aqui na hora, mesmo com o SyncTasks fechado.</p>
          <div><button type="button" className="b" onClick={off} disabled={busy}>Desligar neste aparelho</button></div>
        </>
      ) : (
        <>
          <p className="hint" style={{ margin: 0 }}>
            Receba na hora, como notificação do celular ou do computador, os mesmos avisos da tela Avisos (tarefa delegada, devolvida, concluída, cobrança…).
            {blocked && ' Os avisos estão bloqueados para este site no navegador: libere nas configurações do site.'}
          </p>
          <div><button type="button" className="b" onClick={on} disabled={busy || here === undefined || blocked}>Ligar avisos neste aparelho</button></div>
        </>
      )}
      <ErrorText error={error} />
    </fieldset>
  );
}
