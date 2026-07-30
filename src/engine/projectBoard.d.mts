import type { TaskRun, TaskRunStep } from '../types';

export interface ProjectBoardStage {
  id: string;
  label: string;
  total: number;
  completed: number;
  status: string;
  ownerId?: string;
  entries: Array<{ run: TaskRun; step: TaskRunStep }>;
}

export interface ProjectBoardProject {
  id: string;
  projectId?: string;
  archived?: boolean;
  title: string;
  goal: string;
  status: string;
  statusLabel: string;
  total: number;
  completed: number;
  runs: TaskRun[];
  root: TaskRun;
  actionRun?: TaskRun;
  currentStage?: ProjectBoardStage;
  stages: ProjectBoardStage[];
  latestResult: string;
  updatedAt: number;
  section: 'current' | 'completed' | 'stopped';
}

export function buildProjectBoard(runs?: TaskRun[], projectRecords?: Array<{ id: string; title?: string; request?: string; status?: string }>): ProjectBoardProject[];
export function projectBoardSections(projects?: ProjectBoardProject[]): {
  current: ProjectBoardProject[];
  completed: ProjectBoardProject[];
  stopped: ProjectBoardProject[];
};
