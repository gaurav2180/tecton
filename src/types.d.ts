// Shapes shared by the CLI (which builds the report model) and the report's client code (which reads it).
// Checked with `npm run typecheck`; the code stays plain JavaScript with JSDoc annotations.

export type Status = 'same' | 'added' | 'removed';
export type Severity = 'error' | 'warn';

// ---------------------------------------------------------------- config (tecton.config.json)
export interface Rule {
  name?: string;
  from: string | string[];
  to?: string | string[];
  allow?: string | string[];
  severity?: Severity;
  message?: string;
}
export interface Config {
  root?: string;
  depth?: number;
  cycles?: Severity | 'off';
  rules?: Rule[];
  modules?: Record<string, string | string[]>;
  onlyListedModules?: boolean;
  exclude?: string[];
  aliases?: Record<string, string | string[]>;
  externals?: boolean;
  base?: string;
}

// ---------------------------------------------------------------- sources and graphs
export interface Source {
  label?: string;
  files: string[];
  manifests: string[];
  extras?: string[];
  read(path: string): string | null;
  readConfig?(name: string): string | null;
}
export interface Evidence { file: string; line: number; spec: string; target: string }
export interface GraphEdge { from: string; to: string; external: boolean; imports: Evidence[]; count: number }
export interface Graph {
  modules: Map<string, { files: string[] }>;
  edges: Map<string, GraphEdge>;
  stats: { files: number; imports: number; unresolved: number };
  root: string;
  moduleOf: Map<string, string>;
  fileDeps: Map<string, Map<string, number>>;
}

// ---------------------------------------------------------------- rule breaks
export interface Violation {
  id: string;
  kind: 'rule' | 'cycle';
  rule: string;
  message: string | null;
  severity: Severity;
  from: string;
  to: string;
  members?: string[];
  edges: string[];
  count: number;
  imports: Evidence[];
  /** set once base and current are compared */
  status?: 'new' | 'existing' | 'fixed';
}

// ---------------------------------------------------------------- the dependency map
export interface MapNode {
  id: string;
  external: boolean;
  status: Status;
  filesBase: number;
  filesCur: number;
  files: { path: string; status: Status }[];
  /** layout box, top-left corner */
  pos?: { x: number; y: number; w: number; h: number };
  /** files in this module the change edits */
  touched?: number;
}
export interface MapEdge {
  id: string;
  from: string;
  to: string;
  external: boolean;
  status: Status;
  countBase: number;
  countCur: number;
  imports: Evidence[];
  addedImports: Evidence[];
  points?: [number, number][];
}
export interface Summary {
  modules: { added: number; removed: number; total: number };
  deps: { added: number; removed: number; changed: number; total: number };
  violations: { newErrors: number; newWarnings: number; existing: number; fixed: number };
  files: { base: number; cur: number };
  touched?: { files: number; modules: number };
}

// ---------------------------------------------------------------- the system (architecture) view
export interface SysEvidence { file: string; line: number; text?: string | null; module?: string | null }
export interface EntryPoint {
  key: string;
  label: string;
  file: string;
  line: number;
  methods?: string[];
  cmd?: string | null;
  /** cron schedules: the expression in plain words */
  human?: string | null;
  status?: Status;
}
export type EntryGroup = 'pages' | 'api' | 'endpoints' | 'jobs' | 'schedules';
export interface App {
  id: string;
  root: string;
  name: string;
  pkgName: string | null;
  framework: string;
  role: 'web' | 'mobile' | 'desktop' | 'server' | 'service';
  tech: string[];
  fileCount: number;
  fileCountBase?: number;
  modules: { name: string; files: number }[];
  groups: Record<EntryGroup, EntryPoint[]>;
  status?: Status;
}
export interface Store {
  id: string;
  name: string;
  kind: string;
  via: string[];
  evidence: SysEvidence[];
  apps: string[];
  status?: Status;
}
export interface Outside {
  id: string;
  name: string;
  kind: string;
  hosts: string[];
  via: string[];
  evidence: SysEvidence[];
  apps: string[];
  status?: Status;
}
/** An outside service after base and current are compared: each host carries its own status. */
export interface OutsideDiff extends Omit<Outside, 'hosts'> {
  hosts: { host: string; status: Status }[];
}
export interface Link {
  id: string;
  from: string;
  to: string;
  kind: 'users' | 'app' | 'data' | 'outside';
  labels: string[];
  evidence: SysEvidence[];
  count: number;
  status?: Status;
}
export interface SystemSnapshot {
  apps: App[];
  stores: Store[];
  outside: Outside[];
  links: Link[];
  hasUsers: boolean;
}
type Delta = { total: number; added: number; removed: number };
/** The system view in the report: base and current merged, every item with a status. */
export interface System extends Omit<SystemSnapshot, 'outside'> {
  outside: OutsideDiff[];
  summary: { apps: Delta; entry: Delta; stores: Delta; outside: Delta } | null;
}

// ---------------------------------------------------------------- the report model (embedded as JSON)
export interface RuleInfo {
  key: string;
  kind: 'rule' | 'cycle';
  from?: string | string[];
  to?: string[] | null;
  allow?: string[] | null;
  severity: Severity;
  message: string | null;
}
/** Files inside modules: [path, module, status (s|a|r), edited (0|1)] and imports: [fromIdx, toIdx, status, line] */
export interface FileGraph {
  files: [string, string, 's' | 'a' | 'r', 0 | 1][];
  deps: [number, number, 's' | 'a' | 'r', number][];
}
export interface ReportModel {
  project: string;
  curLabel: string;
  baseLabel: string | null;
  hasBase: boolean;
  ruleCount: number;
  generatedAt: string;
  width: number;
  height: number;
  summary: Summary;
  nodes: MapNode[];
  edges: MapEdge[];
  violations: Violation[];
  rules: RuleInfo[];
  files: FileGraph;
  version: string;
  system: System;
  markdown?: string;
}
