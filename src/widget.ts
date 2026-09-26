/**
 * `initiative-app-sdk/widget`: what a widget module is handed and what it
 * returns.
 *
 * A widget is a TypeScript module exporting `render`:
 *
 * ```ts
 * import type { Scene, WidgetData } from "initiative-app-sdk/widget";
 * import type { openTickets } from "../endpoints.js";
 *
 * export function render(data: WidgetData<typeof openTickets>): Scene {
 *   return { v: 1, scene: { kind: "metric", value: data.values.total ?? 0, label: "Open" } };
 * }
 * ```
 *
 * `initiative-app build` bundles it into one script with no imports, which
 * Initiative runs in a sandbox with no host bindings: no network, no DOM, no
 * timers. What it returns is data describing a picture, which Initiative
 * draws and bounds.
 *
 * These types follow the widget API version {@link WIDGET_API_VERSION} of
 * Initiative's scene vocabulary.
 */

import type { ReturnValueType } from "./contract.js";

/** The widget API version these scenes are written in. */
export const WIDGET_API_VERSION = 1;

type Scalar<T> = T extends "int" ? number : T extends "bool" ? boolean : string;
type TypeOf<S> = S extends ReturnValueType ? S : S extends { type: infer T } ? T : never;
type Returns<E> = E extends { returns?: infer R } ? NonNullable<R> : {};
type ListKey<R> = { [K in keyof R]: R[K] extends { list: true } ? K : never }[keyof R];
type SingleKey<R> = Exclude<keyof R, ListKey<R>>;

/**
 * What a widget is handed: the answer of the endpoint its tile is bound to,
 * read through that endpoint's declared returns. `E` is the endpoint's
 * declaration, as `defineEndpoint` gave it.
 */
export interface WidgetData<E> {
  source: "app";
  /** One entry per index across the endpoint's `list` returns, keyed by their names. */
  rows: Array<{ [K in ListKey<Returns<E>>]?: Scalar<TypeOf<Returns<E>[K]>> }>;
  /** The endpoint's single-valued returns, once. */
  values: { [K in SingleKey<Returns<E>>]?: Scalar<TypeOf<Returns<E>[K]>> | null };
  meta?: DataMeta;
}

/** What the host knows about the rows that the rows cannot say. */
export interface DataMeta {
  /** How many the viewer's query matched; `rows` may be a leading slice of it. */
  total?: number;
  truncated?: boolean;
}

/** The tile's display options, already checked by Initiative. */
export type WidgetConfig = Record<string, string>;

/** The third argument to `render`. */
export interface RenderContext {
  /** The viewer's language tag. */
  locale: string;
  /** Which of the data's columns fill each of the widget's slots, by ordinal. */
  slots: Record<string, number[]>;
}

/** What `render` returns. */
export interface Scene {
  v: number;
  scene: SceneNode;
}

export type Render<E = unknown> = (data: WidgetData<E>, config: WidgetConfig, context: RenderContext) => Scene;

/** Semantic colors, resolved to theme tokens by the renderer. */
export type Tone =
  | "accent"
  | "positive"
  | "negative"
  | "warning"
  | "neutral"
  | "muted"
  | "series-1"
  | "series-2"
  | "series-3"
  | "series-4"
  | "series-5";

/** How the renderer formats a bare number. */
export type NumberFormat = "plain" | "compact" | "percent" | "currency" | "duration" | "date";

export interface MetricNode {
  kind: "metric";
  value: number;
  label?: string;
  format?: NumberFormat;
  /** A fraction: 0.12 draws as +12%. */
  delta?: number;
  deltaGood?: "up" | "down";
  caption?: string;
  tone?: Tone;
}

export interface SeriesPoint {
  x: string | number;
  y: number;
}

export interface Series {
  name?: string;
  points: SeriesPoint[];
  tone?: Tone;
}

export interface SeriesNode {
  kind: "series";
  mark: "bar" | "line" | "area" | "pie";
  series: Series[];
  stacked?: boolean;
  format?: NumberFormat;
  xLabel?: string;
  yLabel?: string;
  showLegend?: boolean;
  labels?: "none" | "extremes" | "end";
  target?: number;
  targetLabel?: string;
  /** Index into `series` of the one drawn in color; the rest are muted. */
  emphasis?: number;
  horizontal?: boolean;
}

/** Times are epoch milliseconds; the renderer formats them. */
export interface TimelineSpan {
  label?: string;
  start: number;
  end: number;
  tone?: Tone;
  /** 0..1, the share of this span's work that is finished. */
  progress?: number;
  kind?: "bar" | "summary" | "milestone";
  baseline?: { start: number; end: number };
  caption?: string;
}

export interface TimelineLane {
  label?: string;
  spans: TimelineSpan[];
  children?: TimelineLane[];
  collapsed?: boolean;
  caption?: string;
  tone?: Tone;
}

export interface TimelineNode {
  kind: "timeline";
  lanes: TimelineLane[];
  start?: number;
  end?: number;
  scale?: "day" | "week" | "month" | "quarter";
  now?: number;
}

export interface FunnelNode {
  kind: "funnel";
  stages: Array<{ label: string; value: number; tone?: Tone }>;
  format?: NumberFormat;
}

export interface ProgressNode {
  kind: "progress";
  value: number;
  min?: number;
  max?: number;
  label?: string;
  caption?: string;
  tone?: Tone;
  format?: NumberFormat;
  target?: number;
}

export interface MatrixNode {
  kind: "matrix";
  cells: Array<{ x: number; y: number; value: number; label?: string }>;
  max?: number;
  xLabels?: string[];
  yLabels?: string[];
  tone?: Tone;
}

export interface TableColumn {
  key: string;
  label?: string;
  align?: "start" | "end";
  format?: NumberFormat;
}

export type TableCell = string | number | boolean | null | { value: string | number | boolean | null; tone?: Tone };

export interface TableNode {
  kind: "table";
  columns: TableColumn[];
  rows: Array<Record<string, TableCell>>;
}

export interface BoardCard {
  title: string;
  chips?: string[];
  /** Epoch milliseconds. */
  date?: number;
  progress?: number;
  caption?: string;
  tone?: Tone;
}

export interface BoardNode {
  kind: "board";
  columns: Array<{ label: string; cards: BoardCard[]; total?: number; caption?: string; tone?: Tone }>;
}

export interface TextNode {
  kind: "text";
  text: string;
  variant?: "heading" | "body" | "caption";
  tone?: Tone;
}

/** Nothing to show, and why. */
export interface EmptyNode {
  kind: "empty";
  message?: string;
}

export interface StackNode {
  kind: "stack";
  direction: "row" | "column";
  children: SceneNode[];
  gap?: "none" | "sm" | "md";
  weights?: number[];
}

export type SceneNode =
  | MetricNode
  | SeriesNode
  | TimelineNode
  | FunnelNode
  | ProgressNode
  | MatrixNode
  | TableNode
  | BoardNode
  | TextNode
  | EmptyNode
  | StackNode;
