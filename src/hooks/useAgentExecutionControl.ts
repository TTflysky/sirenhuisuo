import { useCallback, useEffect, useRef, useState } from 'react';

export type AgentExecutionState = 'running' | 'paused' | 'stopping';

export function formatExecutionDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds.toString().padStart(2, '0')} 秒` : `${seconds} 秒`;
}

export function useAgentExecutionControl(active: boolean) {
  const stopRequestedRef = useRef(false);
  const pausedRef = useRef(false);
  const pauseResolversRef = useRef<Array<() => void>>([]);
  const steeringWakePendingRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const modelRequestControllerRef = useRef<AbortController>(new AbortController());
  const [executionState, setExecutionState] = useState<AgentExecutionState>('running');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const releasePauseWaiters = useCallback(() => {
    const waiters = pauseResolversRef.current.splice(0);
    waiters.forEach((resolve) => resolve());
  }, []);

  const reset = useCallback(() => {
    modelRequestControllerRef.current.abort();
    modelRequestControllerRef.current = new AbortController();
    stopRequestedRef.current = false;
    pausedRef.current = false;
    steeringWakePendingRef.current = false;
    releasePauseWaiters();
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setExecutionState('running');
  }, [releasePauseWaiters]);

  const pause = useCallback(() => {
    if (stopRequestedRef.current) return;
    pausedRef.current = true;
    setExecutionState('paused');
  }, []);

  const resume = useCallback(() => {
    if (stopRequestedRef.current) return;
    pausedRef.current = false;
    steeringWakePendingRef.current = false;
    setExecutionState('running');
    releasePauseWaiters();
  }, [releasePauseWaiters]);

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    pausedRef.current = false;
    steeringWakePendingRef.current = false;
    modelRequestControllerRef.current.abort();
    setExecutionState('stopping');
    releasePauseWaiters();
  }, [releasePauseWaiters]);

  const interruptForSteering = useCallback(() => {
    if (stopRequestedRef.current) return;
    modelRequestControllerRef.current.abort();
    modelRequestControllerRef.current = new AbortController();
    // Wake a paused loop so it can answer the new message, while keeping the
    // original task paused after that response. The pending bit also covers
    // the race where the model is aborted just before the loop starts waiting.
    steeringWakePendingRef.current = true;
    releasePauseWaiters();
  }, [releasePauseWaiters]);

  const getModelRequestSignal = useCallback(() => modelRequestControllerRef.current.signal, []);

  const shouldStop = useCallback(() => stopRequestedRef.current, []);
  const waitIfPaused = useCallback(async () => {
    if (!pausedRef.current || stopRequestedRef.current) return;
    if (steeringWakePendingRef.current) {
      steeringWakePendingRef.current = false;
      return;
    }
    await new Promise<void>((resolve) => pauseResolversRef.current.push(resolve));
    if (steeringWakePendingRef.current) steeringWakePendingRef.current = false;
  }, []);

  useEffect(() => {
    if (!active) {
      startedAtRef.current = null;
      setElapsedSeconds(0);
      return;
    }
    if (!startedAtRef.current) startedAtRef.current = Date.now();
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => () => {
    modelRequestControllerRef.current.abort();
    releasePauseWaiters();
  }, [releasePauseWaiters]);

  return { executionState, elapsedSeconds, reset, pause, resume, stop, shouldStop, waitIfPaused, interruptForSteering, getModelRequestSignal };
}
