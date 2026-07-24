const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMax: () => ipcRenderer.send('win:toggle-max'),
  close: () => ipcRenderer.send('win:close'),

  // 命令执行：renderer 调用，main 进程 exec，返回 { success, stdout, stderr, exitCode, cwd }
  execCommand: (cmd, scope) => ipcRenderer.invoke('exec:command', { cmd, scope }),
  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsRead: (id) => ipcRenderer.invoke('skills:read', id),
  skillsDelete: (id) => ipcRenderer.invoke('skills:delete', id),

  // 打开原生聊天窗口（真实桌面窗口，可自由拖动）
  openChat: (opts) => ipcRenderer.invoke('win:openChat', opts),

  // ===== 自主代理工作区文件系统（沙箱到 userData/workspace）=====
  getWorkspace: () => ipcRenderer.invoke('fs:getWorkspace'),
  fsWrite: (filePath, content) => ipcRenderer.invoke('fs:write', { filePath, content }),
  fsRead: (filePath) => ipcRenderer.invoke('fs:read', { filePath }),
  fsMkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', { dirPath }),
  fsList: (dirPath, recursive) => ipcRenderer.invoke('fs:list', { dirPath, recursive }),
  fsExportZip: () => ipcRenderer.invoke('fs:exportZip'),

  // 在系统文件管理器中打开路径
  openPath: (p) => ipcRenderer.invoke('sys:openPath', p),

  // ===== 连接器 API 调用（主进程代理）=====
  connectorCall: (opts) => ipcRenderer.invoke('connector:call', opts),
  // broadcast: 向其他窗口广播一条消息（{ channel, payload }）
  broadcast: (channel, payload) => ipcRenderer.send('win:broadcast', { channel, payload }),
  // onBroadcast: 监听来自其他窗口的广播，返回取消订阅函数
  onBroadcast: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('win:broadcast', handler);
    // 返回取消监听的函数
    return () => ipcRenderer.removeListener('win:broadcast', handler);
  },

  // ===== 自动更新 =====
  // 手动触发检查更新
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  // 重启安装已下载的更新
  installUpdate: () => ipcRenderer.invoke('update:install'),
  // 监听更新状态事件（checking/available/not-available/downloading/downloaded/error）
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update:status', handler);
    // 返回取消监听的函数
    return () => ipcRenderer.removeListener('update:status', handler);
  },
});
