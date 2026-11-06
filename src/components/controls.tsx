import { useEditor } from "../store";

export function Slider(props: { label: string; value: number; min: number; max: number; step: number; unit?: string; format?(v: number): string; onChange(v: number): void }) {
  const begin = useEditor((s) => s.beginGesture);
  const end = useEditor((s) => s.endGesture);
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output>
        {props.format ? props.format(props.value) : Number(props.value.toFixed(2))}
        {props.unit}
      </output>
    </label>
  );
}

export function Segmented<T extends string | number>(props: { options: { value: T; label: string }[]; value: T | null; onPick(v: T): void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={String(o.value)} className={props.value === o.value ? "on" : ""} onClick={() => props.onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange(v: boolean): void }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span>{label}</span>
      <span className="knob" />
    </button>
  );
}
