export const PARAMETER_LABELS = { snow: "Snow", visibility: "Visibility" };
export const REASON_LABELS: Record<string, string> = {
  no_record: "No WEOW observation received for this parameter. A current provider image may still be available.",
  stale: "No recent WEOW observation for this parameter. A current provider image may still be available.",
  no_published_derived_result: "No classification available; raw predictions may be present",
  scene_unqualified: "Snow result withheld: scene qualification has not passed",
  qualification_unknown: "Snow result withheld: qualification has not been supplied",
};
export function qualificationLabel(status: number | null | undefined): string {
  return status === 2 ? "Qualified" : status === 1 ? "Incomplete" : status === 0 ? "Disqualified" : "Unknown · treated as unqualified";
}
export function utc(value: string | null | undefined): string {
  if (!value) return "Not supplied";
  return new Date(value).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}
export function number(value: number | null | undefined, digits = 3): string {
  return value == null ? "Not supplied" : value.toLocaleString("en-GB", { maximumFractionDigits: digits });
}
export function interval(lower: number | null, upper: number | null, unit = ""): string {
  return lower == null || upper == null ? "Not published" : `${number(lower)} – ${number(upper)}${unit ? ` ${unit}` : ""}`;
}
export function toUTCInput(value: string): string { return new Date(value).toISOString().slice(0, 16); }
export function fromUTCInput(value: string): string { return new Date(value + (value.endsWith("Z") ? "" : "Z")).toISOString(); }
