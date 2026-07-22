export {};

export interface ExecCommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
  cwd: string;
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  total?: number;
  transferred?: number;
  message: string;
}

declare global {
  interface ElectronAPI {
    minimize: () => void;
    toggleMax: () => void;
    close: () => void;
    execCommand: (cmd: string) => Promise<ExecCommandResult>;

    // 打开原生聊天窗口（真实桌面窗口，可自由拖动）
    openChat: (opts: { type: string; refId: string }) => Promise<{ ok: boolean }>;

    // 窗口间广播总线：broadcast 向其他窗口广播，onBroadcast 接收来自其他窗口的消息
    broadcast: (channel: string, payload: unknown) => void;
    onBroadcast: (callback: (data: { channel: string; payload: unknown }) => void) => () => void;

    // 自动更新
    checkUpdate: () => Promise<{ ok: boolean; error?: string }>;
    installUpdate: () => Promise<{ ok: boolean }>;
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  }
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
