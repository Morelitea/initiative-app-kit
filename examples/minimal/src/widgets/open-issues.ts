/** A project's open issues, with the closed ones beneath. */

import type { Scene, WidgetData } from "initiative-app-sdk/widget";

import type { issueCounts } from "../app.js";

export function render(data: WidgetData<typeof issueCounts>): Scene {
  const { opened, closed } = data.values;
  if (typeof opened !== "number") return { v: 1, scene: { kind: "empty", message: "No counts yet" } };
  return { v: 1, scene: { kind: "metric", value: opened, label: "Open issues", caption: `${closed ?? 0} closed` } };
}
