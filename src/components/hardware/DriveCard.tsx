import { Gamepad2, Power, PowerOff, Settings2 } from "lucide-react"
import type React from "react"

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Drive, DriveSettings } from "@/components/hardware/types"

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
  settings,
  controlEnabled,
  canControl,
  onSettingsChange,
  onControlEnabledChange,
  onVirtualKey,
}: {
  drive: Drive
  pressedKeys: Set<string>
  settings: DriveSettings
  controlEnabled: boolean
  canControl: boolean
  onSettingsChange: (settings: DriveSettings) => void
  onControlEnabledChange: (enabled: boolean) => void
  onVirtualKey: (key: string, pressed: boolean) => void
}) {
  const active = (key: string) => pressedKeys.has(key)
  const update = <K extends keyof DriveSettings>(key: K, value: DriveSettings[K]) =>
    onSettingsChange({ ...settings, [key]: value })

  const holdProps = (key: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      onVirtualKey(key, true)
    },
    onPointerUp: () => onVirtualKey(key, false),
    onPointerCancel: () => onVirtualKey(key, false),
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  })

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
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={controlEnabled ? "default" : "outline"}
            disabled={!canControl || controlEnabled}
            onClick={() => onControlEnabledChange(true)}
          >
            <Power /> ENABLE
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!controlEnabled}
            onClick={() => onControlEnabledChange(false)}
          >
            <PowerOff /> DISABLE
          </Button>
        </div>
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
            <span>Precision: speed {Math.round(settings.precisionSpeed * 100)}% / turn {Math.round(settings.precisionTurn * 100)}%</span>
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
            W/S: forward/reverse · A/D: {Math.round(settings.turnStart * 100)}% start → {Math.round(settings.turn * 100)}% hold · opposite keys cancel
          </p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 select-none touch-none">
          <span />
          <button type="button" aria-label="Forward" className={`rounded-xl border py-3 font-bold ${active("w") ? "bg-blue-500 text-white" : "bg-neutral-50"}`} {...holdProps("w")}>W</button>
          <span />
          <button type="button" aria-label="Left" className={`rounded-xl border py-3 font-bold ${active("a") ? "bg-blue-500 text-white" : "bg-neutral-50"}`} {...holdProps("a")}>A</button>
          <button type="button" aria-label="Reverse" className={`rounded-xl border py-3 font-bold ${active("s") ? "bg-blue-500 text-white" : "bg-neutral-50"}`} {...holdProps("s")}>S</button>
          <button type="button" aria-label="Right" className={`rounded-xl border py-3 font-bold ${active("d") ? "bg-blue-500 text-white" : "bg-neutral-50"}`} {...holdProps("d")}>D</button>
        </div>

        <details className="mt-4 border-t border-neutral-100 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-neutral-700">
            <Settings2 className="size-4" /> Drive settings
          </summary>
          <div className="mt-3 space-y-3">
            {([
              ["speed", "Speed", 0.2, 1, 0.05],
              ["turn", "Turn max", 0.3, 1, 0.05],
              ["turnStart", "Turn start", 0.2, 1, 0.05],
              ["turnRamp", "Turn ramp / sec", 0, 3, 0.1],
              ["precisionSpeed", "Precision speed", 0.1, 1, 0.05],
              ["precisionTurn", "Precision turn", 0.1, 1, 0.05],
              ["arm", "Arm power", 0.1, 1, 0.05],
            ] as const).map(([key, label, min, max, step]) => (
              <label key={key} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-xs">
                <span>{label}</span>
                <input type="range" min={min} max={max} step={step} value={settings[key]} onChange={(event) => update(key, Number(event.target.value))} />
                <output className="text-right font-mono">{settings[key].toFixed(2)}</output>
              </label>
            ))}
            <label className="flex items-center justify-between text-xs">
              <span>Auto enable while operating</span>
              <input type="checkbox" checked={settings.autoEnable} onChange={(event) => update("autoEnable", event.target.checked)} />
            </label>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
