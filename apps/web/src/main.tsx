import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { App } from './App';
import { ToastProvider } from './components/ui';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } },
});

// Volta a buscar os dados ao voltar para a janela. Por padrão a biblioteca só olha a troca de aba;
// assim também conta clicar de volta no navegador depois de usar outro programa ou o celular.
focusManager.setEventListener((handleFocus) => {
  const onChange = () => handleFocus(document.visibilityState === 'visible' && document.hasFocus());
  window.addEventListener('focus', onChange);
  window.addEventListener('blur', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    window.removeEventListener('blur', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
