export function createEventFanout() {
  const channels = new Map();

  function subscribe(channel, handler) {
    let handlers = channels.get(channel);
    if (!handlers) {
      handlers = new Set();
      channels.set(channel, handlers);
    }
    handlers.add(handler);
    return () => {
      const current = channels.get(channel);
      current?.delete(handler);
      if (current?.size === 0) channels.delete(channel);
    };
  }

  function deliver(channel, payload, onError) {
    const handlers = channels.get(channel);
    if (!handlers) return 0;
    let delivered = 0;
    for (const handler of [...handlers]) {
      try {
        handler(payload);
        delivered += 1;
      } catch (error) {
        onError?.(error);
      }
    }
    return delivered;
  }

  function listenerCount(channel) {
    if (channel) return channels.get(channel)?.size ?? 0;
    let total = 0;
    for (const handlers of channels.values()) total += handlers.size;
    return total;
  }

  return { subscribe, deliver, listenerCount };
}
