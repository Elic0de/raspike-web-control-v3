"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Bluetooth, StopCircle } from "lucide-react"

import {
  CalibrationCard,
  type EtroboTelemetry,
} from "@/components/hardware/CalibrationCard"
import { StatusBadge } from "@/components/hardware/StatusBadge"
import { Button } from "@/components/ui/button"
import type { WsState } from "@/components/hardware/types"

type GatewayStatus = {
  control_connected?: boolean
  telemetry_count?: number
  telemetry_age_sec?: number | null
}

function gatewayWsUrl() {
  const configured = import.meta.env.VITE_GATEWAY_WS_URL
  if (configured) return configured
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}/ws`
}

export function CalibrationPage() {
  const [wsState, setWsState] = useState<WsState>("connecting")
  const [gateway, setGateway] = useState<GatewayStatus>({})
  const [telemetry, setTelemetry] = useState<EtroboTelemetry | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const sendAction = (action: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "action", action }))
    }
  }

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let closed = false

    const connect = () => {
      setWsState("connecting")
      const ws = new WebSocket(gatewayWsUrl())
      wsRef.current = ws
      ws.addEventListener("open", () => setWsState("connected"))
      ws.addEventListener("close", () => {
        if (wsRef.current === ws) wsRef.current = null
        setWsState("disconnected")
        if (!closed) reconnectTimer = setTimeout(connect, 800)
      })
      ws.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === "etrobo_telemetry") {
            setTelemetry(message.payload)
          } else if (message.type === "gateway_status") {
            setGateway(message.payload)
          }
        } catch {
          // Ignore malformed gateway frames.
        }
      })
    }

    connect()
    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [])

  return (
    <main className="min-h-svh bg-neutral-50 px-4 py-5 text-neutral-900 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <a
              href="/"
              className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              <ArrowLeft className="size-3.5" /> Hardware
            </a>
            <h1 className="text-2xl font-semibold">Color Calibration</h1>
            <p className="mt-1 text-sm text-neutral-500">
              SPIKEの測定結果をRaspberry Pi経由で表示します
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={wsState === "connected" ? "ok" : "waiting"}>
              <Bluetooth className="size-3.5" /> ws {wsState}
            </StatusBadge>
            <StatusBadge tone={gateway.control_connected ? "ok" : "waiting"}>
              {gateway.control_connected ? "SPIKE connected" : "SPIKE waiting"}
            </StatusBadge>
            <Button
              variant="destructive"
              size="sm"
              className="rounded-full text-red-600"
              onClick={() => sendAction("emergency_stop")}
            >
              <StopCircle className="size-4" /> Stop
            </Button>
          </div>
        </header>

        <CalibrationCard
          telemetry={telemetry}
          onLeft={() => sendAction("button_left")}
          onConfirm={() => sendAction("center_button")}
          onRight={() => sendAction("button_right")}
        />

        <p className="px-2 text-center text-xs leading-relaxed text-neutral-400">
          測定中はセンサーと機体を動かさず、照明を遮らないでください。
          判定と基準値はブラウザではなくSPIKE側で管理されます。
        </p>
      </div>
    </main>
  )
}
