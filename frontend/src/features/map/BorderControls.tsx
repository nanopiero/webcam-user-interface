import type { BorderVisibility } from "../../api/contracts";
import { borderControlsForROI } from "./roi";

export default function BorderControls({ value, onChange, roi }: { value: BorderVisibility; onChange: (value: BorderVisibility) => void; roi: string }) {
  const choices = borderControlsForROI(roi);
  return <section className="border-controls" aria-label="Border overlays"><h2>Borders</h2>
    {choices.map(({ label, layers }) => <label key={label} className="checkbox"><input type="checkbox" checked={layers.some(layer => value[layer.key])} onChange={event => {
      const next = { ...value };
      for (const layer of layers) next[layer.key] = event.target.checked;
      onChange(next);
    }} />
      <span className="border-swatches">{layers.map(layer => <span key={layer.key} className="border-swatch" style={{ borderTopColor: layer.colour, borderTopWidth: layer.width }} />)}</span>{label}</label>)}
  </section>;
}
