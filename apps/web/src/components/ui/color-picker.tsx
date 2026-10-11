"use client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

// Installed from shadcn.io/color-picker. Controlled state and keyboard support are
// adapted to nohmi; changes are emitted only from user input, never on mount.
import Color from "color";
import { Slider } from "radix-ui";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ComponentProps,
} from "react";
import { cn } from "@/lib/utils";

type HSV = [number, number, number];
type PickerContext = { hsv: HSV; update: (value: HSV) => void };
const Context = createContext<PickerContext | null>(null);
function usePicker() {
  const value = useContext(Context);
  if (!value) throw new Error("Color picker controls require ColorPicker.");
  return value;
}
export type ColorPickerProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
};
export function ColorPicker({
  value,
  defaultValue = "#000000",
  onChange,
  className,
  ...props
}: ColorPickerProps) {
  const [hsv, setHsv] = useState<HSV>(
    () =>
      Color(value ?? defaultValue)
        .hsv()
        .array() as HSV,
  );
  const emitted = useRef(value ?? defaultValue);
  useEffect(() => {
    if (value && Color(value).hex() !== Color(emitted.current).hex()) {
      setHsv(Color(value).hsv().array() as HSV);
      emitted.current = value;
    }
  }, [value]);
  const update = (next: HSV) => {
    setHsv(next);
    const hex = Color.hsv(...next).hex();
    if (hex === Color(emitted.current).hex()) return;
    emitted.current = hex;
    onChange?.(hex);
  };
  return (
    <Context.Provider value={{ hsv, update }}>
      <div className={cn("flex min-w-0 flex-col gap-4", className)} {...props} />
    </Context.Provider>
  );
}
export function ColorPickerSelection({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const {
    hsv: [hue, saturation, brightness],
    update,
  } = usePicker();
  const dragging = useRef(false);
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    update([
      hue,
      Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      Math.max(0, Math.min(100, 100 - ((event.clientY - rect.top) / rect.height) * 100)),
    ]);
  }
  return (
    <div
      {...props}
      role="slider"
      tabIndex={0}
      aria-label="Color saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(saturation)}
      aria-valuetext={`Saturation ${Math.round(saturation)}%, brightness ${Math.round(brightness)}%. Arrow keys adjust color.`}
      className={cn(
        "relative h-40 w-full touch-none cursor-crosshair rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
      style={{
        background: `linear-gradient(0deg,#000,transparent),linear-gradient(90deg,#fff,transparent),hsl(${hue},100%,50%)`,
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        move(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) move(event);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 1;
        const delta = (
          {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          } as Record<string, [number, number]>
        )[event.key];
        if (!delta) return;
        event.preventDefault();
        update([
          hue,
          Math.max(0, Math.min(100, saturation + delta[0])),
          Math.max(0, Math.min(100, brightness + delta[1])),
        ]);
      }}
    >
      <span
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background outline outline-foreground"
        style={{ left: `${saturation}%`, top: `${100 - brightness}%` }}
      />
    </div>
  );
}
export function ColorPickerHue({ className, ...props }: ComponentProps<typeof Slider.Root>) {
  const {
    hsv: [hue, saturation, brightness],
    update,
  } = usePicker();
  return (
    <Slider.Root
      {...props}
      min={0}
      max={360}
      step={1}
      value={[hue]}
      onValueChange={([value]) => {
        if (value !== undefined) update([value, saturation, brightness]);
      }}
      className={cn("relative flex h-5 w-full touch-none items-center", className)}
    >
      <Slider.Track
        className="relative h-3 w-full grow rounded-full"
        style={{ background: "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
      >
        <Slider.Range />
      </Slider.Track>
      <Slider.Thumb
        aria-label="Color hue"
        className="block size-5 rounded-full border border-border bg-background focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
    </Slider.Root>
  );
}

export function ColorPickerInput(props: ComponentProps<typeof Input>) {
  const { hsv, update } = usePicker();
  const hex = Color.hsv(...hsv).hex();
  const [text, setText] = useState(hex);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(hex);
    setInvalid(false);
  }, [hex]);
  return (
    <Input
      {...props}
      type="text"
      value={text}
      maxLength={7}
      spellCheck={false}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        const value = event.target.value;
        setText(value);
        if (/^#[0-9a-f]{6}$/i.test(value)) {
          setInvalid(false);
          update(Color(value).hsv().array() as HSV);
        }
      }}
      onBlur={() => {
        if (!/^#[0-9a-f]{6}$/i.test(text)) {
          setInvalid(true);
          toast.error("Enter a six-digit hex color, such as #C7D23C.");
        }
      }}
    />
  );
}
