import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import App from './App';
import { StoreProvider } from './store';
import { deliverBus } from './ipcBus';

// 注册窗口间广播监听：任意窗口经 main 进程转发来的消息，统一交给本地总线分发
if (typeof window !== 'undefined' && window.electronAPI?.onBroadcast) {
  window.electronAPI.onBroadcast((data) => {
    const channel = (data && (data as any).channel) as string;
    const payload = (data && (data as any).payload) as unknown;
    if (channel) deliverBus(channel, payload);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);

