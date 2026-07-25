/**
 * 窗口间 IPC 广播总线 (ipcBus)
 * --------------------------------------------------
 * 主办公室窗口与原生聊天子窗口（独立 Electron BrowserWindow）各自拥有独立的
 * React store 实例，彼此不实时同步（已知限制）。本模块在它们之间建立一层轻量
 * 广播信道：任意窗口调用 sendBus(channel, payload)，main 进程会把消息转发给
 * 除发送者外的所有窗口；接收方经 main.tsx 注册的 onBroadcast 监听统一调用
 * deliverBus 分发到本地订阅者。
 *
 * 注意：所有 payload 必须是可结构化克隆（JSON 序列化）的纯数据，不要传函数。
 */

type BusHandler = (payload: unknown) => void;

const handlers = new Map<string, Set<BusHandler>>();

/** 向其他窗口广播一条消息。在普通浏览器环境（无 electronAPI）下为安全空操作。 */
export function sendBus(channel: string, payload: unknown): void {
  try {
    window.electronAPI?.broadcast?.(channel, payload);
  } catch (e) {
    console.warn('[ipcBus] sendBus failed:', e);
  }
}

/** 订阅某频道，返回取消订阅函数。 */
export function onBus(channel: string, cb: BusHandler): () => void {
  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
  }
  set.add(cb);
  return () => {
    handlers.get(channel)?.delete(cb);
  };
}

/**
 * 内部：由预处理进程（main.tsx 中注册的 onBroadcast 监听）调用，
 * 把来自其他窗口的广播分发给本进程内的本地订阅者。
 */
export function deliverBus(channel: string, payload: unknown): void {
  const set = handlers.get(channel);
  if (!set) return;
  for (const h of set) {
    try {
      h(payload);
    } catch (e) {
      console.warn('[ipcBus] handler error:', e);
    }
  }
}

// ===== 预定义频道名（避免拼写漂移）=====
export const BUS_CHANNELS = {
  /** store action：跨窗口同步的 reducer action */
  STORE_ACTION: 'store:action',
  /** 产出物变更：某作用域新增/删除了产出物 */
  OUTPUTS_CHANGED: 'outputs:changed',
  CONNECTORS_CHANGED: 'connectors:changed',
  ASSISTANT_SETTINGS_CHANGED: 'assistant-settings:changed',
} as const;
