import { Gamepad2 } from "lucide-react"

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Drive } from "@/components/hardware/types"

function DriveMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-3">
      <div className="text-xs font-semibold text-neutral-400">{label}</div>
      <div className="mt-2 text-base font-semibold text-neutral-900">
        {value}
      </div>
    </div>
  )
}

function Key({ name, active = false }: { name: string; active?: boolean }) {
  return (
    <kbd
      className={`inline-grid min-w-7 place-items-center rounded-md border px-1.5 py-1 font-mono text-xs font-semibold shadow-sm transition-colors ${
        active
          ? "border-blue-500 bg-blue-500 text-white"
          : "border-neutral-300 bg-neutral-50 text-neutral-700"
      }`}
    >
      {name}
    </kbd>
  )
}

export function DriveCard({
  drive,
  pressedKeys,
}: {
  drive: Drive
  pressedKeys: Set<string>
}) {
  const active = (key: string) => pressedKeys.has(key)

  return (
    <Card className="gap-3 rounded-2xl border border-neutral-200 bg-white py-0 shadow-sm">
      <CardHeader className="px-4 pt-4">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-800">
          <Gamepad2 className="size-5 text-blue-500" />
          Drive
        </CardTitle>
        <CardAction className="text-xs font-medium text-neutral-400">
          Keyboard control
        </CardAction>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="relative mx-auto mb-4 size-20 rounded-full border border-neutral-200 bg-neutral-50">
          <div className="absolute top-1/2 right-4 left-4 border-t border-dashed border-neutral-300" />
          <div className="absolute top-4 bottom-4 left-1/2 border-l border-dashed border-neutral-300" />
          <div
            className="absolute top-1/2 left-1/2 size-4 rounded-full bg-blue-500 shadow-sm transition-transform"
            style={{
              transform: `translate(calc(-50% + ${drive.steering * 28}px), calc(-50% + ${drive.throttle * -28}px))`,
            }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <DriveMetric label="THROTTLE" value={drive.throttle.toFixed(2)} />
          <DriveMetric label="STEERING" value={drive.steering.toFixed(2)} />
          <DriveMetric label="ARM" value={drive.arm.toFixed(2)} />
        </div>
        <div className="mt-4 space-y-2 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
          <div className="flex items-center justify-between gap-3">
            <span>Drive / steering</span>
            <div className="flex gap-1">
              {(["w", "a", "s", "d"] as const).map((key) => (
                <Key key={key} name={key.toUpperCase()} active={active(key)} />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Precision: speed 40% / turn 25%</span>
            <Key name="Shift" active={active("shift")} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Arm up / down</span>
            <div className="flex gap-1">
              <Key name="↑" active={active("arrowup")} />
              <Key name="↓" active={active("arrowdown")} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 font-medium text-red-600">
            <span>Emergency stop</span>
            <Key name="Space" active={active(" ")} />
          </div>
          <p className="pt-1 text-[11px] leading-relaxed text-neutral-400">
            W/S: forward/reverse · A/D: 25% start → 55% hold · opposite keys cancel
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
