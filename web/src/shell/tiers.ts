/**
 * The three layouts the workbench takes, chosen by viewport width only.
 *
 *   large  ≥ 1100  left pane · centre · right pane, bottom pane under the centre
 *   mid    700–1099  left pane · centre, bottom pane under the centre; the right
 *                  pane's content moves into a bottom tab ("Details")
 *   mobile < 700   centre over bottom pane, 50/50, and a floating dock; the left
 *                  pane's content becomes a bottom tab ("Browse") too
 *
 * Panes move between tiers; state never does (selection, open notes, tab).
 */

export type Tier = "large" | "mid" | "mobile";

export const TIER_MID = 700;
export const TIER_LARGE = 1100;

export const tierOf = (width: number): Tier => (width >= TIER_LARGE ? "large" : width >= TIER_MID ? "mid" : "mobile");

/** Which panes a tier draws as panes. Anything not drawn lives in a bottom tab. */
export const PANES: Record<Tier, { left: boolean; right: boolean; dock: boolean }> = {
  large: { left: true, right: true, dock: false },
  mid: { left: true, right: false, dock: false },
  mobile: { left: false, right: false, dock: true },
};
