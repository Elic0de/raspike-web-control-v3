"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, RotateCcw } from "lucide-react"

import { ActionsCard } from "@/components/hardware/ActionsCard"
import { CameraCard } from "@/components/hardware/CameraCard"
import { DriveCard } from "@/components/hardware/DriveCard"
import { HardwarePortBar } from "@/components/hardware/HardwarePortBar"
import { Header } from "@/components/hardware/Header"
import { HubButtonsCard } from "@/components/hardware/HubButtonsCard"
import type {
  Drive,
  HardwarePort,
  HardwareTelemetry,
  HeaderStatus,
  PortId,
  WsState,
} from "@/components/hardware/types"

type MotorTelemetry = {
  port?: number
  count?: number
  speed?: number
  power?: number
  stalled?: boolean
}

type ForceTelemetry = {
  port?: number
  force_n?: number
  distance?: number
  touched?: boolean
}

type ColorTelemetry = {
  port?: number
  rgb?: {
    r?: number
    g?: number
    b?: number
  }
  hsv?: {
    h?: number
    s?: number
    v?: number
  }
  reflection?: number
  ambient?: number
}

type UltrasonicTelemetry = {
  port?: number
  distance_mm?: number
  presence?: boolean
}

type Telemetry = {
  commands?: {
    left_power?: number
    right_power?: number
  }
  control?: {
    safe_mode?: boolean
    emergency?: boolean
    power_limit?: number
    throttle?: number
    steering?: number
    arm?: number
  }
  drive_motors?: {
    left_port?: number
    right_port?: number
    left?: MotorTelemetry | null
    right?: MotorTelemetry | null
  }
  motors?: Record<string, MotorTelemetry>
  force_sensors?: Record<string, ForceTelemetry>
  color_sensors?: Record<string, ColorTelemetry>
  ultrasonic_sensors?: Record<string, UltrasonicTelemetry>
  imu?: {
    acceleration?: number[]
    angular_velocity?: number[]
  }
  battery?: {
    voltage_mv?: number
    current_ma?: number
  }
}

type GatewayStatus = {
  control_connected?: boolean
  telemetry_count?: number
  telemetry_age_sec?: number | null
  telemetry_peer?: string | null
}

const shownPorts = ["A", "B", "C", "D", "E", "F"] as const

function getGatewayWsUrl() {
  const configured = import.meta.env.VITE_GATEWAY_WS_URL
  if (configured) {
    return configured
  }

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/ws`
}

function getCameraStreamUrl() {
  return import.meta.env.VITE_CAMERA_STREAM_URL ?? "/camera/stream.mjpg"
}

function portName(port: number | undefined): PortId | undefined {
  if (!Number.isInteger(port) || port === undefined || port < 0 || port > 5) {
    return undefined
  }
  return String.fromCharCode(65 + port) as PortId
}

function valueOrDash(value: unknown, digits = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "-"
}

function detailValue(value: unknown, unit = "", digits = 0) {
  const text = valueOrDash(value, digits)
  return text === "-" || !unit ? text : `${text} ${unit}`
}

function motorValue(motor: MotorTelemetry) {
  return `${valueOrDash(motor.count)}°`
}

function forceValue(force: ForceTelemetry) {
  if (typeof force.touched === "boolean") {
    return force.touched ? "ON" : "OFF"
  }
  if (typeof force.force_n === "number" && Math.abs(force.force_n) >= 0.05) {
    return `${valueOrDash(force.force_n, 1)} N`
  }
  return "-"
}

function colorValue(color: ColorTelemetry) {
  if (typeof color.reflection === "number") {
    return valueOrDash(color.reflection)
  }
  if (typeof color.ambient === "number") {
    return valueOrDash(color.ambient)
  }
  if (color.hsv && typeof color.hsv.h === "number") {
    return valueOrDash(color.hsv.h)
  }
  if (color.rgb && typeof color.rgb.r === "number") {
    return valueOrDash(color.rgb.r)
  }
  return "-"
}

function ultrasonicValue(ultrasonic: UltrasonicTelemetry) {
  if (typeof ultrasonic.distance_mm !== "number") {
    return "-"
  }
  return `${valueOrDash(ultrasonic.distance_mm)} mm`
}

function batteryText(telemetry: Telemetry | null) {
  const voltage = telemetry?.battery?.voltage_mv
  if (typeof voltage === "number" && Number.isFinite(voltage)) {
    return `${(voltage / 1000).toFixed(2)} V`
  }
  return "battery"
}

function estimateTilt(accel: number[] | undefined) {
  if (!accel || accel.length < 3 || accel.some((v) => !Number.isFinite(v))) {
    return { pitch: undefined, roll: undefined }
  }
  const [x, y, z] = accel
  return {
    pitch: Math.atan2(-x, Math.sqrt(y * y + z * z)) * (180 / Math.PI),
    roll: Math.atan2(y, z) * (180 / Math.PI),
  }
}

function getAxis(keys: Set<string>, steeringMagnitude = 0): Drive {
  const precision = keys.has("shift")
  const throttleScale = precision ? 0.4 : 1
  const steeringDirection =
    (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0)
  return {
    throttle:
      ((keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0)) * throttleScale,
    steering: steeringDirection * steeringMagnitude,
    arm: (keys.has("arrowup") ? 1 : 0) - (keys.has("arrowdown") ? 1 : 0),
  }
}

function mapByPort<T extends { port?: number }>(
  values: Record<string, T> | undefined
) {
  const map = new Map<PortId, T>()
  Object.values(values ?? {}).forEach((value) => {
    const name = portName(value.port)
    if (name) {
      map.set(name, value)
    }
  })
  return map
}

export function HardwareDashboard() {
  const [wsState, setWsState] = useState<WsState>("connecting")
  const [gateway, setGateway] = useState<GatewayStatus>({})
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [cameraOk, setCameraOk] = useState(false)
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set())
  const [drive, setDrive] = useState<Drive>({
    throttle: 0,
    steering: 0,
    arm: 0,
  })
  const [wsUrl, setWsUrl] = useState("")

  const wsRef = useRef<WebSocket | null>(null)
  const keysRef = useRef<Set<string>>(new Set())
  const controlEnabledRef = useRef(false)

  const hasActiveControlKey = () =>
    ["w", "a", "s", "d", "arrowup", "arrowdown"].some((key) =>
      keysRef.current.has(key)
    )

  const send = (payload: object) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
    }
  }

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let closed = false

    const connect = () => {
      const url = getGatewayWsUrl()
      setWsUrl(url)
      setWsState("connecting")
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.addEventListener("open", () => {
        setWsState("connected")
        controlEnabledRef.current = false
        if (hasActiveControlKey()) {
          ws.send(JSON.stringify({ type: "enable", enabled: true }))
          controlEnabledRef.current = true
        }
      })
      ws.addEventListener("close", () => {
        if (wsRef.current === ws) {
          wsRef.current = null
        }
        controlEnabledRef.current = false
        setWsState("disconnected")
        if (!closed) {
          reconnectTimer = setTimeout(connect, 800)
        }
      })
      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === "telemetry") {
            setTelemetry(msg.payload)
          } else if (msg.type === "gateway_status") {
            setGateway(msg.payload)
          }
        } catch {
          // Ignore malformed gateway frames.
        }
      })
    }

    connect()

    return () => {
      closed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "drive", throttle: 0, steering: 0, arm: 0 })
        )
        wsRef.current.send(JSON.stringify({ type: "enable", enabled: false }))
      }
      wsRef.current?.close()
    }
  }, [])

  useEffect(() => {
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const checkCamera = async () => {
      try {
        const response = await fetch("/camera/status", { cache: "no-store" })
        const payload = await response.json()
        if (!closed) {
          setCameraOk(response.ok && Boolean(payload.ok))
        }
      } catch {
        if (!closed) {
          setCameraOk(false)
        }
      } finally {
        if (!closed) {
          timer = setTimeout(checkCamera, 3000)
        }
      }
    }

    checkCamera()

    return () => {
      closed = true
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

  useEffect(() => {
    const controlKeys = new Set([
      "w",
      "a",
      "s",
      "d",
      "shift",
      "arrowup",
      "arrowdown",
      " ",
    ])

    let steeringMagnitude = 0
    let previousSteeringDirection = 0
    let lastDriveUpdate = performance.now()

    const updateDrive = () => {
      const now = performance.now()
      const dt = Math.min((now - lastDriveUpdate) / 1000, 0.1)
      lastDriveUpdate = now

      const keys = keysRef.current
      const steeringDirection =
        (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0)
      const steeringLimit = keys.has("shift") ? 0.25 : 0.55

      if (steeringDirection === 0) {
        steeringMagnitude = 0
      } else if (steeringDirection !== previousSteeringDirection) {
        steeringMagnitude = Math.min(0.25, steeringLimit)
      } else {
        steeringMagnitude = Math.min(
          steeringLimit,
          steeringMagnitude + 0.75 * dt
        )
      }
      previousSteeringDirection = steeringDirection

      const next = getAxis(keys, steeringMagnitude)
      setDrive(next)
      send({ type: "drive", ...next })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!controlKeys.has(key)) {
        return
      }
      event.preventDefault()
      if (key === " ") {
        if (!event.repeat) {
          keysRef.current.add(key)
          setPressedKeys(new Set(keysRef.current))
          send({ type: "action", action: "emergency_stop" })
        }
        return
      }
      keysRef.current.add(key)
      setPressedKeys(new Set(keysRef.current))
      if (!controlEnabledRef.current && hasActiveControlKey()) {
        send({ type: "enable", enabled: true })
        controlEnabledRef.current = true
      }
      updateDrive()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!controlKeys.has(key)) {
        return
      }
      event.preventDefault()
      keysRef.current.delete(key)
      setPressedKeys(new Set(keysRef.current))
      updateDrive()
      if (controlEnabledRef.current && !hasActiveControlKey()) {
        send({ type: "enable", enabled: false })
        controlEnabledRef.current = false
      }
    }

    const releaseAllKeys = () => {
      if (keysRef.current.size === 0) {
        return
      }
      keysRef.current.clear()
      setPressedKeys(new Set())
      updateDrive()
      if (controlEnabledRef.current) {
        send({ type: "enable", enabled: false })
        controlEnabledRef.current = false
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        releaseAllKeys()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", releaseAllKeys)
    document.addEventListener("visibilitychange", onVisibilityChange)
    const interval = setInterval(updateDrive, 50)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", releaseAllKeys)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      clearInterval(interval)
    }
  }, [])

  const motorsByPort = useMemo(() => {
    const map = mapByPort(telemetry?.motors)
    const leftPort = portName(telemetry?.drive_motors?.left_port)
    const rightPort = portName(telemetry?.drive_motors?.right_port)
    if (leftPort && telemetry?.drive_motors?.left) {
      map.set(leftPort, telemetry.drive_motors.left)
    }
    if (rightPort && telemetry?.drive_motors?.right) {
      map.set(rightPort, telemetry.drive_motors.right)
    }
    return map
  }, [telemetry])

  const forcesByPort = useMemo(
    () => mapByPort(telemetry?.force_sensors),
    [telemetry]
  )
  const colorsByPort = useMemo(
    () => mapByPort(telemetry?.color_sensors),
    [telemetry]
  )
  const ultrasonicsByPort = useMemo(
    () => mapByPort(telemetry?.ultrasonic_sensors),
    [telemetry]
  )

  const ports: HardwarePort[] = shownPorts.map((id) => {
    const motor = motorsByPort.get(id)
    if (motor) {
      return {
        id,
        icon: "/SensorMotor.svg",
        value: motorValue(motor),
        active: motor.stalled === undefined ? undefined : !motor.stalled,
        kind: "motor",
        connected: true,
        details: [
          { label: "position", value: detailValue(motor.count, "deg") },
          { label: "speed", value: detailValue(motor.speed, "deg/s") },
          { label: "power", value: detailValue(motor.power) },
          { label: "stalled", value: motor.stalled ? "yes" : "no" },
        ],
      }
    }

    const force = forcesByPort.get(id)
    if (force) {
      return {
        id,
        icon: "/SensorTouch.svg",
        value: forceValue(force),
        active: force.touched,
        kind: "force",
        connected: true,
        details: [
          { label: "touched", value: force.touched ? "yes" : "no" },
          { label: "force", value: detailValue(force.force_n, "N", 1) },
          { label: "distance", value: detailValue(force.distance) },
        ],
      }
    }

    const color = colorsByPort.get(id)
    if (color) {
      return {
        id,
        icon: "/SensorColor.svg",
        value: colorValue(color),
        active: true,
        kind: "color",
        connected: true,
        details: [
          { label: "reflection", value: detailValue(color.reflection, "%") },
          { label: "ambient", value: detailValue(color.ambient, "%") },
          { label: "hue", value: detailValue(color.hsv?.h, "deg") },
        ],
      }
    }

    const ultrasonic = ultrasonicsByPort.get(id)
    if (ultrasonic) {
      return {
        id,
        icon: "/SensorDistance.svg",
        value: ultrasonicValue(ultrasonic),
        active: ultrasonic.presence,
        kind: "distance",
        connected: true,
        details: [
          {
            label: "distance",
            value: detailValue(ultrasonic.distance_mm, "mm"),
          },
          { label: "presence", value: ultrasonic.presence ? "yes" : "no" },
        ],
      }
    }

    return {
      id,
      value: "-",
      kind: "empty",
      connected: false,
      details: [
        { label: "status", value: "waiting" },
        { label: "port", value: id },
      ],
    }
  })

  const hasTelemetry =
    Boolean(gateway.telemetry_count && gateway.telemetry_count > 0) &&
    (gateway.telemetry_age_sec ?? 999) < 2
  const cameraStreamUrl = getCameraStreamUrl()
  const headerStatus: HeaderStatus = {
    wsState,
    controlConnected: Boolean(gateway.control_connected),
    telemetryReady: hasTelemetry,
    telemetryAgeSec: gateway.telemetry_age_sec,
    batteryText: batteryText(telemetry),
  }
  const gyro = telemetry?.imu?.angular_velocity ?? []
  const tilt = estimateTilt(telemetry?.imu?.acceleration)
  const hardwareTelemetry: HardwareTelemetry = {
    yaw:
      typeof gyro[2] === "number" && Number.isFinite(gyro[2])
        ? gyro[2]
        : undefined,
    pitch: tilt.pitch,
    roll: tilt.roll,
    ports: ports.map((port) => ({
      port: port.id,
      type: port.kind,
      value: port.value,
    })),
  }

  const sendAction = (action: string) => {
    send({ type: "action", action })
  }

  return (
    <main className="min-h-svh bg-neutral-50 text-neutral-900 lg:h-svh lg:overflow-hidden">
      <div className="mx-auto grid h-full w-full max-w-7xl grid-rows-[auto_auto_minmax(0,1fr)] gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <Header
          gatewayUrl={wsUrl}
          status={headerStatus}
          hardwareTelemetry={hardwareTelemetry}
          onStop={() => sendAction("emergency_stop")}
        />

        <HardwarePortBar ports={ports} />

        <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_360px]">
          <CameraCard
            streamUrl={cameraStreamUrl}
            cameraOk={cameraOk}
            onLoad={() => setCameraOk(true)}
            onError={() => setCameraOk(false)}
          />

          <aside className="grid min-h-0 content-start gap-3 lg:overflow-y-auto lg:pr-1">
            <DriveCard drive={drive} pressedKeys={pressedKeys} />
            <HubButtonsCard
              onLeft={() => sendAction("button_left")}
              onCenter={() => sendAction("center_button")}
              onRight={() => sendAction("button_right")}
            />
            <ActionsCard
              actions={[
                {
                  label: "GYRO",
                  detail: "Reset",
                  icon: RotateCcw,
                  onClick: () => sendAction("gyro_reset"),
                },
                {
                  label: "FORCE",
                  detail: "Press",
                  icon: Download,
                  onClick: () => sendAction("virtual_force_touch"),
                },
              ]}
            />
          </aside>
        </div>
      </div>
    </main>
  )
}
