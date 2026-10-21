// View-only shapes the report builds from the model (the model itself is src/types.d.ts).
import type { App, Link, MapEdge, OutsideDiff as Outside, Status, Store } from '../../types';

/** A row on the Changes page: a module or a dependency that appeared, went away or changed. */
export interface ChangeItem {
  type: string; // 'node' | 'edge'
  id: string;
  kind: string;
  label: string;
  sub?: string;
  edge?: MapEdge;
  viol?: boolean;
}

/** A file inside a module, with its file-level imports both ways (module drill-down). */
export interface FileInfo {
  i: number;
  path: string;
  module: string;
  status: Status;
  /** content differs from the base */
  edited: boolean;
  out: FileDep[];
  in: FileDep[];
}
export interface FileDep { from: FileInfo; to: FileInfo; status: Status; line: number }

/** A box on the architecture diagram. Positions are filled in by the layout. */
export interface ArchNode {
  id: string;
  type: 'person' | 'app' | 'db' | 'queue' | 'ext' | 'extpanel';
  name: string;
  kind: string;
  sub: string;
  tech?: string;
  status: Status;
  w: number;
  h: number;
  x?: number;
  y?: number;
  ref?: App | Store | Outside;
  color?: string;
  envOnly?: boolean;
  /** the outside systems panel: group headings and one row per service */
  rows?: ArchRow[];
  /** width of one column of the outside panel */
  colW?: number;
}
/** A row of the outside systems panel (a group heading when `head`). `y` is relative to the panel. */
export interface ArchRow {
  id: string;
  name: string;
  sub: string;
  status: Status;
  icon?: string;
  head?: boolean;
  x?: number;
  y?: number;
  ref?: Outside;
  envOnly?: boolean;
}
type Pt = [number, number];
/** A connector on the architecture diagram. Ports, route and label box are filled in by the router. */
export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  kind: Link['kind'];
  status: Status;
  /** the full label (tooltips) */
  label: string;
  /** what's drawn on the wire: empty when the line's style already says it */
  tag: string;
  link: Link;
  /** every link this wire stands for (an app's wire into the outside panel carries several) */
  links: Link[];
  async: boolean;
  ss?: 'top' | 'bottom' | 'left' | 'right';
  ts?: 'top' | 'bottom' | 'left' | 'right';
  P0?: Pt; Q0?: Pt; P1?: Pt; Q1?: Pt;
  pts?: Pt[];
  lbl?: { x: number; y: number; w: number; h: number };
}
export interface ArchModel { nodes: ArchNode[]; edges: ArchEdge[]; byId: Map<string, ArchNode> }
