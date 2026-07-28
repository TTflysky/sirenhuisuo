const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMax: () => ipcRenderer.send('win:toggle-max'),
  close: () => ipcRenderer.send('win:close'),
  getAppSessionId: () => ipcRenderer.sendSync('app:getSessionId'),
  taskStoreRead: () => ipcRenderer.invoke('task-store:read'),
  taskStoreWrite: (runs, metadata) => ipcRenderer.invoke('task-store:write', runs, metadata),
  taskLedgerRead: (options) => ipcRenderer.invoke('task-ledger:read', options),
  getAssistantLock: () => ipcRenderer.invoke('win:getAssistantLock'),
  setAssistantLock: (locked) => ipcRenderer.invoke('win:setAssistantLock', locked),
  getChatLock: (opts) => ipcRenderer.invoke('win:getChatLock', opts),
  setChatLock: (opts) => ipcRenderer.invoke('win:setChatLock', opts),
  setZoomFactor: (factor) => webFrame.setZoomFactor(Math.max(0.8, Math.min(1.3, Number(factor) || 1))),

  // 命令执行：renderer 调用，main 进程 exec，返回 { success, stdout, stderr, exitCode, cwd }
  execCommand: (cmd, scope, policy) => ipcRenderer.invoke('exec:command', { cmd, scope, sandboxEnabled: policy?.sandboxEnabled !== false, env: policy?.env, skillId: policy?.skillId }),
  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsRead: (id) => ipcRenderer.invoke('skills:read', id),
  skillsDelete: (id) => ipcRenderer.invoke('skills:delete', id),
  skillsInstall: (input) => ipcRenderer.invoke('skills:install', input),
  skillsInspectSource: (sourceUrl) => ipcRenderer.invoke('skills:inspectSource', sourceUrl),
  skillsRepair: (id) => ipcRenderer.invoke('skills:repair', id),
  openExternal: (url) => ipcRenderer.invoke('sys:openExternal', url),

  // 打开原生聊天窗口（真实桌面窗口，可自由拖动）
  openChat: (opts) => ipcRenderer.invoke('win:openChat', opts),
  openSettings: () => ipcRenderer.invoke('win:openSettings'),
  openTool: (opts) => ipcRenderer.invoke('win:openTool', opts),
  getToolPayload: (session) => ipcRenderer.invoke('win:getToolPayload', session),

  // ===== 自主代理工作区文件系统（沙箱到 userData/workspace）=====
  getWorkspace: () => ipcRenderer.invoke('fs:getWorkspace'),
  fsWrite: (filePath, content) => ipcRenderer.invoke('fs:write', { filePath, content }),
  fsWriteDocument: (filePath, content) => ipcRenderer.invoke('fs:writeDocument', { filePath, content }),
  fsWriteData: (filePath, dataUrl) => ipcRenderer.invoke('fs:writeData', { filePath, dataUrl }),
  fsRead: (filePath) => ipcRenderer.invoke('fs:read', { filePath }),
  fsMkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', { dirPath }),
  fsInitWorkspace: (workspaceId, metadata) => ipcRenderer.invoke('fs:initWorkspace', { workspaceId, metadata }),
  fsCopyIntoWorkspace: (sourceScope, targetWorkspaceId, entries) => ipcRenderer.invoke('fs:copyIntoWorkspace', { sourceScope, targetWorkspaceId, entries }),
  fsList: (dirPath, recursive) => ipcRenderer.invoke('fs:list', { dirPath, recursive }),
  fsExportZip: () => ipcRenderer.invoke('fs:exportZip'),

  // 在系统文件管理器中打开路径
  openPath: (p) => ipcRenderer.invoke('sys:openPath', p),

  // ===== 连接器 API 调用（主进程代理）=====
  connectorCall: (opts) => ipcRenderer.invoke('connector:call', opts),
  connectorVerifyPreset: (input) => ipcRenderer.invoke('connector:verifyPreset', input),
  knowledgePickObsidian: () => ipcRenderer.invoke('knowledge:pickObsidian'),
  knowledgeTestObsidian: (root) => ipcRenderer.invoke('knowledge:testObsidian', root),
  knowledgeSearchObsidian: (root, query) => ipcRenderer.invoke('knowledge:searchObsidian', { root, query }),
  knowledgeReadObsidian: (root, path) => ipcRenderer.invoke('knowledge:readObsidian', { root, path }),
  knowledgeFetchUrl: (url) => ipcRenderer.invoke('knowledge:fetchUrl', url),
  knowledgeSearchWeb: (query) => ipcRenderer.invoke('knowledge:searchWeb', query),
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
  installUpdate: (snapshot) => ipcRenderer.invoke('update:install', snapshot),
  getUpgradeStatus: () => ipcRenderer.invoke('upgrade:status'),
  recordUpgradeValidation: (validation) => ipcRenderer.invoke('upgrade:recordValidation', validation),
  readUpgradeBackup: () => ipcRenderer.invoke('upgrade:readBackup'),
  prepareRollback: () => ipcRenderer.invoke('upgrade:prepareRollback'),
  rollbackUpgrade: () => ipcRenderer.invoke('upgrade:rollback'),
  // 监听更新状态事件（checking/available/not-available/downloading/downloaded/error）
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update:status', handler);
    // 返回取消监听的函数
    return () => ipcRenderer.removeListener('update:status', handler);
  },
});
