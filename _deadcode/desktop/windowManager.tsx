import {
  createContext,
  useContext,
  useReducer,
  type ReactNode,
} from 'react';

export type AppKey = 'chat' | 'kanban' | 'tasks' | 'settings';

export interface AppDef {
  key: AppKey;
  title: string;
  icon: string;
  defaultW: number;
  defaultH: number;
}

export const APPS: AppDef[] = [
  { key: 'chat', title: 'Agent 协作', icon: '💬', defaultW: 620, defaultH: 560 },
  { key: 'kanban', title: '任务看板', icon: '🗂️', defaultW: 760, defaultH: 520 },
  { key: 'tasks', title: '任务列表', icon: '✅', defaultW: 420, defaultH: 520 },
  { key: 'settings', title: '设置', icon: '⚙️', defaultW: 460, defaultH: 420 },
];

export interface WinState {
  id: string;
  key: AppKey;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
}

interface State {
  windows: WinState[];
  topZ: number;
}

type Action =
  | { type: 'OPEN'; key: AppKey }
  | { type: 'FOCUS'; id: string }
  | { type: 'CLOSE'; id: string }
  | { type: 'MINIMIZE'; id: string }
  | { type: 'MOVE'; id: string; x: number; y: number }
  | { type: 'RESIZE'; id: string; w: number; h: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'OPEN': {
      const existing = state.windows.find((w) => w.key === action.key);
      if (existing) {
        return {
          ...state,
          topZ: state.topZ + 1,
          windows: state.windows.map((w) =>
            w.key === action.key ? { ...w, minimized: false, z: state.topZ + 1 } : w,
          ),
        };
      }
      const openCount = state.windows.length;
      const z = state.topZ + 1;
      const win: WinState = {
        id: `win-${action.key}-${Date.now()}`,
        key: action.key,
        x: 80 + openCount * 36,
        y: 70 + openCount * 30,
        w: APPS.find((a) => a.key === action.key)!.defaultW,
        h: APPS.find((a) => a.key === action.key)!.defaultH,
        z,
        minimized: false,
      };
      return { windows: [...state.windows, win], topZ: z };
    }
    case 'FOCUS': {
      const z = state.topZ + 1;
      return {
        topZ: z,
        windows: state.windows.map((w) => (w.id === action.id ? { ...w, z } : w)),
      };
    }
    case 'CLOSE':
      return { ...state, windows: state.windows.filter((w) => w.id !== action.id) };
    case 'MINIMIZE':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, minimized: !w.minimized } : w,
        ),
      };
    case 'MOVE':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, x: action.x, y: action.y } : w,
        ),
      };
    case 'RESIZE':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, w: action.w, h: action.h } : w,
        ),
      };
    default:
      return state;
  }
}

interface WindowCtx {
  windows: WinState[];
  open: (key: AppKey) => void;
  focus: (id: string) => void;
  close: (id: string) => void;
  minimize: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, w: number, h: number) => void;
}

const Ctx = createContext<WindowCtx | null>(null);

export function WindowProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { windows: [], topZ: 10 });
  const api: WindowCtx = {
    windows: state.windows,
    open: (key) => dispatch({ type: 'OPEN', key }),
    focus: (id) => dispatch({ type: 'FOCUS', id }),
    close: (id) => dispatch({ type: 'CLOSE', id }),
    minimize: (id) => dispatch({ type: 'MINIMIZE', id }),
    move: (id, x, y) => dispatch({ type: 'MOVE', id, x, y }),
    resize: (id, w, h) => dispatch({ type: 'RESIZE', id, w, h }),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWindows(): WindowCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWindows must be used within WindowProvider');
  return c;
}
