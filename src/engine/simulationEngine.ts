import type { RoleId, TaskLane } from '../types';

export interface ScriptStep {
  role: RoleId;
  message: string;
  mentions?: RoleId[];
  advanceTaskTo?: TaskLane;
  delayBefore?: number; // 该步播放前的等待 ms（默认 900）
}

export interface ScriptHandlers {
  onMessage: (role: RoleId, content: string, mentions: RoleId[]) => void;
  onTaskUpdate: (taskId: string, lane: TaskLane) => void;
  onStart: () => void;
  onDone: () => void;
}

let cancelled = false;
export function cancelDemo(): void {
  cancelled = true;
}
export function resetCancel(): void {
  cancelled = false;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 按顺序播放剧本，模拟「主动型」多角色协作。
 * 每步先等待 delayBefore（打字/思考节奏），再推消息；若 advanceTaskTo 则同步任务侧栏。
 * 任意时刻被 cancelDemo() 中断即提前结束。
 */
export async function runScript(
  steps: ScriptStep[],
  handlers: ScriptHandlers,
  demoTaskId: string,
): Promise<void> {
  resetCancel();
  handlers.onStart();
  for (const step of steps) {
    if (cancelled) {
      handlers.onDone();
      return;
    }
    await sleep(step.delayBefore ?? 900);
    if (cancelled) {
      handlers.onDone();
      return;
    }
    handlers.onMessage(step.role, step.message, step.mentions ?? []);
    if (step.advanceTaskTo) {
      handlers.onTaskUpdate(demoTaskId, step.advanceTaskTo);
    }
  }
  handlers.onDone();
}
