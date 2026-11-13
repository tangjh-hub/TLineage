export type Language = "zh" | "en";
export type Status = "done" | "open" | "idle" | "warn";
export type Filter = "all" | "active" | "stalled" | "done";

export interface MapUsage {
  total: number;
  input: number;
  output: number;
  approximate: boolean;
}

export interface MapSession {
  id: string;
  jitter: number;
  title: string;
  gist?: string;
  startedAt: string;
  endedAt: string;
  status: Status;
  lane: string;
  subagentOf?: string;
  usage: MapUsage;
  contribution?: MapUsage | null;
  threadCumulative?: number;
  fileCount: number;
  files: string[];
}

export interface MapHandoff {
  markdown: string;
  generatedAt: string;
}

export interface MapLane {
  id: string;
  name: string;
  handoff?: MapHandoff;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: "fork" | "subagent" | "shared-file";
  evidence: string[];
}

export interface MapProject {
  label: string;
  lanes: MapLane[];
  sessions: MapSession[];
  edges: MapEdge[];
  defaultList?: boolean;
}

export interface MapData {
  projects: MapProject[];
  demo?: boolean;
  lang?: Language;
}
