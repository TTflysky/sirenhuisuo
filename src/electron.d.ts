export {};

export interface ExecCommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
  cwd: string;
}

export interface FsEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
  modifiedAt?: number;
}
export interface FsWriteResult { ok: boolean; path?: string; size?: number; error?: string; }
export interface FsReadResult { ok: boolean; path?: string; content?: string; format?: string; size?: number; truncated?: boolean; warnings?: string[]; error?: string; }
export interface FsListResult { ok: boolean; path?: string; items?: FsEntry[]; error?: string; }
export interface FsZipResult { ok: boolean; path?: string; error?: string; }

export type ChatWindowType = 'dm-chat' | 'team-chat' | 'assistant-chat';
export interface OpenChatOptions { type: ChatWindowType; refId: string; }
export interface OpenChatResult { ok: boolean; reused?: boolean; error?: string; }

export interface SkillListResult { ok: boolean; skills?: import('./types').Skill[]; error?: string; }
export interface SkillReadResult { ok: boolean; skill?: { id: string; name: string; content: string }; error?: string; }
export interface SkillDeleteResult { ok: boolean; error?: string; }
export interface SkillInstallResult { ok: boolean; skill?: import('./types').Skill; resolvedUrl?: string; error?: string; }

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
    execCommand: (cmd: string, scope?: string) => Promise<ExecCommandResult>;
    skillsList: () => Promise<SkillListResult>;
    skillsRead: (id: string) => Promise<SkillReadResult>;
    skillsDelete: (id: string) => Promise<SkillDeleteResult>;
    skillsInstall: (input: { sourceUrl: string; name?: string }) => Promise<SkillInstallResult>;
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;

    // 自主代理工作区文件系统（沙箱到 userData/workspace）
    getWorkspace: () => Promise<string>;
    fsWrite: (filePath: string, content: string) => Promise<FsWriteResult>;
    fsWriteData: (filePath: string, dataUrl: string) => Promise<FsWriteResult>;
    fsRead: (filePath: string) => Promise<FsReadResult>;
    fsMkdir: (dirPath: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
    fsList: (dirPath?: string, recursive?: boolean) => Promise<FsListResult>;
    fsExportZip: () => Promise<FsZipResult>;
    openPath: (p: string) => Promise<{ ok: boolean; error?: string }>;

    // 打开原生聊天窗口（真实桌面窗口，可自由拖动）
    openChat: (opts: OpenChatOptions) => Promise<OpenChatResult>;

    // 窗口间广播总线：broadcast 向其他窗口广播，onBroadcast 接收来自其他窗口的消息
    broadcast: (channel: string, payload: unknown) => void;
    onBroadcast: (callback: (data: { channel: string; payload: unknown }) => void) => () => void;

    // 自动更新
    checkUpdate: () => Promise<{ ok: boolean; error?: string }>;
    installUpdate: () => Promise<{ ok: boolean }>;
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;

    // 连接器 API 调用（主进程代理 HTTP 请求）
    connectorCall: (opts: ConnectorCallOpts) => Promise<ConnectorCallResult>;
    knowledgePickObsidian: () => Promise<KnowledgeVaultResult & { canceled?: boolean }>;
    knowledgeTestObsidian: (root: string) => Promise<KnowledgeVaultResult>;
    knowledgeSearchObsidian: (root: string, query: string) => Promise<{ ok: boolean; results?: Array<{ path: string; title: string; snippet: string }>; scanned?: number; error?: string }>;
    knowledgeReadObsidian: (root: string, path: string) => Promise<{ ok: boolean; path?: string; content?: string; size?: number; error?: string }>;
    knowledgeFetchUrl: (url: string) => Promise<{ ok: boolean; url?: string; title?: string; content?: string; error?: string }>;
  }
  interface Window {
    electronAPI?: ElectronAPI;
  }

  interface ConnectorCallOpts {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  }
  interface ConnectorCallResult {
    ok: boolean;
    status: number;
    data: string;
    error?: string;
  }
  interface KnowledgeVaultResult {
    ok: boolean;
    path?: string;
    noteCount?: number;
    isObsidian?: boolean;
    error?: string;
  }
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
