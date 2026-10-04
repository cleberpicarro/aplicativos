import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../lib/api';
import { go } from '../lib/router';
import { ErrorText } from '../components/ui';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand"><img src="/icon.svg" alt="" />SyncTask</div>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { email, password });
      await qc.invalidateQueries();
      if (window.location.hash.startsWith('#/entrar')) go('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <form onSubmit={submit}>
        <h1>Entrar</h1>
        <div className="field"><label htmlFor="l-e">E-mail</label><input id="l-e" type="email" className="input" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
        <div className="field"><label htmlFor="l-p">Senha</label><input id="l-p" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <ErrorText error={error} />
        <button className="b pri" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <button type="button" className="link" onClick={() => go('/esqueci')}>Esqueci minha senha</button>
      </form>
    </Shell>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post('/auth/password/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Shell>
      <form onSubmit={submit}>
        <h1>Redefinir senha</h1>
        {sent ? (
          <p style={{ margin: 0 }}>Se houver uma conta com {email}, enviamos um link para definir uma nova senha. Ele vale por 2 horas.</p>
        ) : (
          <>
            <div className="field"><label htmlFor="f-e">E-mail</label><input id="f-e" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
            <ErrorText error={error} />
            <button className="b pri" type="submit">Enviar link</button>
          </>
        )}
        <button type="button" className="link" onClick={() => go('/')}>Voltar para o login</button>
      </form>
    </Shell>
  );
}

export function SetPasswordPage({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError(new Error('As senhas não conferem.')); return; }
    try {
      await post('/auth/password/set', { token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Shell>
      <form onSubmit={submit}>
        <h1>Definir senha</h1>
        {done ? (
          <>
            <p style={{ margin: 0 }}>Senha definida. Agora é só entrar.</p>
            <button type="button" className="b pri" onClick={() => go('/entrar')}>Ir para o login</button>
          </>
        ) : (
          <>
            <div className="field"><label htmlFor="s-p">Nova senha (mínimo de 8 caracteres)</label><input id="s-p" type="password" className="input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus /></div>
            <div className="field"><label htmlFor="s-c">Repita a senha</label><input id="s-c" type="password" className="input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
            <ErrorText error={error} />
            <button className="b pri" type="submit">Definir senha</button>
          </>
        )}
      </form>
    </Shell>
  );
}
