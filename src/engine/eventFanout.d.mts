export type EventHandler = (payload: unknown) => void;
export interface EventFanout {
  subscribe(channel: string, handler: EventHandler): () => void;
  deliver(channel: string, payload: unknown, onError?: (error: unknown) => void): number;
  listenerCount(channel?: string): number;
}
export function createEventFanout(): EventFanout;
