// What an Organise overview panel receives and returns. Panels are listed in panels.ts; the Overview only iterates.
import type { OverviewPanels, TodayStrip } from "../../organise/overview.js";
import type { AppContext } from "../api.js";

export type OverviewData = OverviewPanels & { today: TodayStrip };

export interface OverviewPanel {
  id: string;
  title: string;
  /** Where the panel's title links to. */
  route: string;
  render(data: OverviewData, context: AppContext): HTMLElement;
}
