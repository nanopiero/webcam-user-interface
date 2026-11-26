import { useEffect, useRef } from "react";
import { classColour, visibilityBandColours } from "./icons";
import { targetKey, targetName, type WebcamTarget } from "./overlap";

interface Props {
  choices: WebcamTarget[];
  position: { left: number; top: number };
  onChoose: (target: WebcamTarget) => void;
  onClose: () => void;
}

export default function WebcamChooser({ choices, position, onChoose, onClose }: Props) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);
  return <section className="webcam-chooser" role="dialog" aria-label="Choose a webcam"
    style={position} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="panel-heading"><strong>Choose a webcam · {choices.length}</strong>
      <button className="icon-button" aria-label="Close webcam chooser" onClick={onClose}>×</button></div>
    <div className="webcam-choices">{choices.map((target, index) => {
      const camera = target.kind === "observed" ? target.camera : undefined;
      const band = visibilityBandColours(camera?.cls);
      const background = target.kind === "supplementary" ? "#111111" : band
        ? `linear-gradient(${band.upper} 50%, ${band.lower} 50%)` : classColour(camera?.cls);
      const ageing = camera?.freshness === "ageing" && camera.cls !== "white";
      const subtitle = target.kind === "supplementary" ? "Additional webcam" : [
        target.site.properties.name === camera?.name ? target.site.properties.platform
          : target.site.properties.name ?? target.site.properties.platform,
        camera && target.site.properties.n > 1
          ? `View ${target.site.properties.cams.findIndex(view => view.p === camera.p) + 1}` : null,
      ].filter(Boolean).join(" · ");
      return <button key={targetKey(target)} data-webcam-key={targetKey(target)} ref={index === 0 ? first : undefined}
        onClick={() => onChoose(target)}>
        <span className={`swatch${ageing ? " freshness-ring" : ""}`} style={{ background }} />
        <span><strong>{targetName(target)}</strong><small>{subtitle}</small></span>
      </button>;
    })}</div>
  </section>;
}
