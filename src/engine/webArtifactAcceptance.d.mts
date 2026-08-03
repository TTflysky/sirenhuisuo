export interface WebArtifactAcceptanceCycle {
  path: string;
  mutationAfterFailure: boolean;
}

export interface WebArtifactAcceptanceEvent {
  name?: string;
  args?: string;
  output?: string;
  success?: boolean;
  executed?: boolean;
}

export function createWebArtifactAcceptanceCycle(): WebArtifactAcceptanceCycle;
export function webArtifactAcceptanceGate(state: WebArtifactAcceptanceCycle, toolName: string): string;
export function observeWebArtifactAcceptanceCycle(
  state: WebArtifactAcceptanceCycle,
  event?: WebArtifactAcceptanceEvent,
): WebArtifactAcceptanceCycle;
