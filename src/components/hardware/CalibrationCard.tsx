import { ArrowLeft, ArrowRight, Check, Palette } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export type EtroboTelemetry = {
  timestamp_us?: number | null
  state_id?: number | null
  script_step_id?: number | null
  script_action_id?: number | null
  script_error_code?: number | null
  brightness?: number | null
  phase_elapsed_ms?: number | null
  color_id?: number | null
  color_r?: number | null
  color_g?: number | null
  color_b?: number | null
  norm_r?: number | null
  norm_g?: number | null
  norm_b?: number | null
  hue?: number | null
  saturation?: number | null
  value?: number | null
  color_confirmed?: number | null
  color_confidence?: number | null
  calib_black?: number | null
  calib_white?: number | null
  calib_blue?: number | null
  calib_target?: number | null
}

const steps: Record<number, { label: string; instruction: string }> = {
  101: { label: "Course", instruction: "Left / Rightを選び、決定を押してください" },
  102: { label: "Black", instruction: "センサーを黒面に置いて取得してください" },
  103: { label: "White", instruction: "センサーを白面に置いて取得してください" },
  104: { label: "Blue", instruction: "センサーを青面に置いて取得してください" },
  105: { label: "Red", instruction: "センサーを赤面に置いて取得してください" },
  106: { label: "Yellow", instruction: "センサーを黄面に置いて取得してください" },
  107: { label: "Error", instruction: "値を確認して再取得してください" },
  108: { label: "Complete", instruction: "キャリブレーション完了です" },
}

const errors: Record<number, string> = {
  1: "黒の輝度が白以上です",
  2: "黒と白の差が不足しています",
  3: "青の輝度が黒と白の範囲外です",
  4: "黒の取得中に明るさが変動しました",
  5: "白の取得中に明るさが変動しました",
  6: "青の取得中に明るさが変動しました",
  7: "取得サンプル数が不足しています",
}

const colors: Record<number, string> = {
  0: "None",
  1: "Black",
  2: "White",
  3: "Gray",
  4: "Red",
  5: "Blue",
  6: "Yellow",
}

function value(value: number | null | undefined) {
  return typeof value === "number" ? value : "-"
}

export function CalibrationCard({
  telemetry,
  onLeft,
  onConfirm,
  onRight,
}: {
  telemetry: EtroboTelemetry | null
  onLeft: () => void
  onConfirm: () => void
  onRight: () => void
}) {
  const stepId = telemetry?.script_step_id ?? 0
  const step = steps[stepId]
  const errorCode = telemetry?.script_error_code ?? 0
  const progress = Math.min(
    100,
    Math.max(0, ((telemetry?.phase_elapsed_ms ?? 0) / 400) * 100)
  )
  const isCalibration = telemetry?.state_id === 1
  const isCourseSelect = stepId === 101
  const isError = stepId === 107

  return (
    <Card className="gap-3 rounded-2xl border border-neutral-200 bg-white py-0 shadow-sm">
      <CardHeader className="px-4 pt-4">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-800">
          <Palette className="size-5 text-blue-500" />
          Color Calibration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">
        {!telemetry ? (
          <p className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-500">
            ETROBO telemetry waiting
          </p>
        ) : !isCalibration ? (
          <p className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-500">
            SPIKE is not in Calibration state
          </p>
        ) : (
          <>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-600">STEP</span>
                <span className="text-sm font-bold text-blue-900">
                  {step?.label ?? `Unknown (${stepId})`}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-blue-800">
                {step?.instruction ?? "SPIKEの表示を確認してください"}
              </p>
              {(telemetry.phase_elapsed_ms ?? 0) > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px] text-blue-700">
                    <span>Sampling: do not move the sensor</span>
                    <span>{telemetry.phase_elapsed_ms} / 400 ms</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {errorCode > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                Error {errorCode}: {errors[errorCode] ?? "Unknown calibration error"}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-neutral-50 p-2">
                <span className="text-neutral-400">Brightness</span>
                <strong className="float-right text-neutral-800">
                  {value(telemetry.brightness)}
                </strong>
              </div>
              <div className="rounded-lg bg-neutral-50 p-2">
                <span className="text-neutral-400">Detected</span>
                <strong className="float-right text-neutral-800">
                  {colors[telemetry.color_confirmed ?? 0] ?? "Unknown"}
                </strong>
              </div>
              <div className="rounded-lg bg-neutral-50 p-2">
                RGB {value(telemetry.color_r)} / {value(telemetry.color_g)} /{" "}
                {value(telemetry.color_b)}
              </div>
              <div className="rounded-lg bg-neutral-50 p-2">
                HSV {value(telemetry.hue)} / {value(telemetry.saturation)} /{" "}
                {value(telemetry.value)}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
              <div>Black<br /><b>{value(telemetry.calib_black)}</b></div>
              <div>Blue<br /><b>{value(telemetry.calib_blue)}</b></div>
              <div>White<br /><b>{value(telemetry.calib_white)}</b></div>
              <div>Target<br /><b>{value(telemetry.calib_target)}</b></div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={onLeft}>
                <ArrowLeft className="size-4" /> {isCourseSelect ? "Left" : "Back"}
              </Button>
              <Button size="sm" onClick={onConfirm}>
                <Check className="size-4" /> {isCourseSelect ? "Confirm" : "Capture"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onRight}
                disabled={!isCourseSelect && !isError}
              >
                {isCourseSelect ? "Right" : "Blue retry"} <ArrowRight className="size-4" />
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
