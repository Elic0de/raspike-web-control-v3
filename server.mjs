import { createReadStream, existsSync, statSync } from "node:fs"
import { open as openFile, readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize, resolve, sep } from "node:path"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import dgram from "node:dgram"
import net from "node:net"

loadEnvFile(".env")
loadEnvFile(".env.local")

const rootDir = process.cwd()
const distDir = resolve(rootDir, "dist")
const host = process.env.HOST || process.env.RASPIKE_WEBUI_HOST || "0.0.0.0"
const port = Number.parseInt(process.env.PORT || "3000", 10)
const telemetryHost =
  process.env.TELEMETRY_HOST ||
  process.env.RASPIKE_TELEMETRY_LISTEN_HOST ||
  "0.0.0.0"
const telemetryPort = Number.parseInt(
  process.env.TELEMETRY_PORT || process.env.RASPIKE_TELEMETRY_PORT || "8765",
  10
)
const targetMode = (process.env.RASPIKE_TARGET || "remote").toLowerCase()
const remoteHost = process.env.RASPIKE_REMOTE_HOST || process.env.RASPIKE_HOST
const defaultBridgeHost =
  targetMode === "local" ? remoteHost || "127.0.0.1" : "127.0.0.1"
const bridgeHost =
  process.env.BRIDGE_HOST ||
  process.env.RASPIKE_BRIDGE_HOST ||
  defaultBridgeHost
const bridgePort = Number.parseInt(
  process.env.BRIDGE_PORT || process.env.RASPIKE_WEB_CONTROL_PORT || "8766",
  10
)
const bridgeRetrySec = Number.parseFloat(process.env.BRIDGE_RETRY_SEC || "1")
const etroboTelemetryCsv = process.env.ETROBO_TELEMETRY_CSV || ""

function numericCsvValue(row, columns, name) {
  const index = columns.get(name)
  if (index === undefined) return null
  const value = Number(row[index])
  return Number.isFinite(value) ? value : null
}

async function readLatestEtroboRecord(path, size) {
  if (size <= 0) return null
  const handle = await openFile(path, "r")
  try {
    const headerLength = Math.min(size, 8192)
    const headerBuffer = Buffer.alloc(headerLength)
    await handle.read(headerBuffer, 0, headerLength, 0)
    const headerLine = headerBuffer.toString("utf8").split(/\r?\n/, 1)[0]
    if (!headerLine.includes("script_step_id")) return null

    const tailLength = Math.min(size, 16384)
    const tailBuffer = Buffer.alloc(tailLength)
    await handle.read(tailBuffer, 0, tailLength, size - tailLength)
    const lines = tailBuffer
      .toString("utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim())
    if (lines.length === 0) return null
    const row = lines.at(-1).split(",")
    const columns = new Map(
      headerLine.split(",").map((name, index) => [name.trim(), index])
    )

    return {
      timestamp_us: numericCsvValue(row, columns, "timestamp_us"),
      state_id: numericCsvValue(row, columns, "state_id"),
      script_step_id: numericCsvValue(row, columns, "script_step_id"),
      script_action_id: numericCsvValue(row, columns, "script_action_id"),
      script_error_code: numericCsvValue(row, columns, "script_error_code"),
      brightness: numericCsvValue(row, columns, "line_raw_l"),
      phase_elapsed_ms: numericCsvValue(row, columns, "phase_elapsed_ms"),
      color_id: numericCsvValue(row, columns, "color_id"),
      color_r: numericCsvValue(row, columns, "color_r"),
      color_g: numericCsvValue(row, columns, "color_g"),
      color_b: numericCsvValue(row, columns, "color_b"),
      norm_r: numericCsvValue(row, columns, "norm_r"),
      norm_g: numericCsvValue(row, columns, "norm_g"),
      norm_b: numericCsvValue(row, columns, "norm_b"),
      hue: numericCsvValue(row, columns, "std_h"),
      saturation: numericCsvValue(row, columns, "std_s"),
      value: numericCsvValue(row, columns, "std_v"),
      color_confirmed: numericCsvValue(row, columns, "color_confirmed"),
      color_confidence: numericCsvValue(row, columns, "color_confidence"),
      calib_black: numericCsvValue(row, columns, "calib_black"),
      calib_white: numericCsvValue(row, columns, "calib_white"),
      calib_blue: numericCsvValue(row, columns, "calib_blue"),
      calib_target: numericCsvValue(row, columns, "calib_target"),
    }
  } finally {
    await handle.close()
  }
}

class Gateway {
  constructor() {
    this.clients = new Set()
    this.latestTelemetry = null
    this.telemetryCount = 0
    this.lastTelemetryAt = 0
    this.lastTelemetryPeer = null
    this.bridge = null
    this.bridgeConnecting = false
    this.nextBridgeRetryAt = 0
    this.lastControlLog = ""
    this.lastTelemetryBroadcastAt = 0
    this.latestEtroboTelemetry = null
    this.lastEtroboCsvMtimeMs = 0
    this.readingEtroboTelemetry = false

    this.udp = dgram.createSocket("udp4")
    this.udp.on("message", (data, rinfo) => this.readTelemetry(data, rinfo))
    this.udp.on("error", (error) => {
      console.error(`telemetry udp error: ${error.message}`)
    })
  }

  listen() {
    this.udp.bind(telemetryPort, telemetryHost, () => {
      console.log(`telemetry udp <- ${telemetryHost}:${telemetryPort}`)
    })

    this.statusTimer = setInterval(() => {
      this.ensureBridgeConnected()
      this.broadcastStatus()
    }, 1000)
    if (etroboTelemetryCsv) {
      this.etroboTimer = setInterval(() => this.pollEtroboTelemetry(), 200)
      this.pollEtroboTelemetry()
      console.log(`ETROBO telemetry CSV <- ${etroboTelemetryCsv}`)
    }
  }

  close() {
    clearInterval(this.statusTimer)
    clearInterval(this.etroboTimer)
    for (const client of this.clients) {
      client.close()
    }
    this.udp.close()
    this.bridge?.destroy()
  }

  addClient(ws) {
    this.clients.add(ws)
    ws.on("message", (data) => this.sendBridge(data.toString("utf8")))
    ws.on("close", () => this.clients.delete(ws))
    ws.on("error", () => this.clients.delete(ws))

    if (this.latestTelemetry) {
      this.send(ws, { type: "telemetry", payload: this.latestTelemetry })
    }
    if (this.latestEtroboTelemetry) {
      this.send(ws, {
        type: "etrobo_telemetry",
        payload: this.latestEtroboTelemetry,
      })
    }
    this.sendStatus(ws)
  }

  readTelemetry(data, rinfo) {
    try {
      this.latestTelemetry = JSON.parse(data.toString("utf8"))
      this.telemetryCount += 1
      this.lastTelemetryAt = Date.now()
      const peer = `${rinfo.address}:${rinfo.port}`
      if (this.lastTelemetryPeer !== peer) {
        this.lastTelemetryPeer = peer
        console.log(`telemetry received from ${peer}`)
      }

      const now = Date.now()
      if (now - this.lastTelemetryBroadcastAt >= 50) {
        this.broadcast({ type: "telemetry", payload: this.latestTelemetry })
        this.lastTelemetryBroadcastAt = now
      }
    } catch {
      // Ignore malformed telemetry datagrams.
    }
  }

  async pollEtroboTelemetry() {
    if (this.readingEtroboTelemetry) return
    let fileStat
    try {
      fileStat = statSync(etroboTelemetryCsv)
    } catch {
      return
    }
    if (!fileStat.isFile() || fileStat.mtimeMs === this.lastEtroboCsvMtimeMs) {
      return
    }

    this.readingEtroboTelemetry = true
    try {
      const record = await readLatestEtroboRecord(
        etroboTelemetryCsv,
        fileStat.size
      )
      if (!record) return
      this.lastEtroboCsvMtimeMs = fileStat.mtimeMs
      this.latestEtroboTelemetry = record
      this.broadcast({ type: "etrobo_telemetry", payload: record })
    } catch (error) {
      console.warn(`ETROBO telemetry read failed: ${error.message}`)
    } finally {
      this.readingEtroboTelemetry = false
    }
  }

  ensureBridgeConnected() {
    if (
      this.bridge ||
      this.bridgeConnecting ||
      Date.now() < this.nextBridgeRetryAt
    ) {
      return
    }

    this.bridgeConnecting = true
    const sock = net.createConnection(
      { host: bridgeHost, port: bridgePort },
      () => {
        this.bridge = sock
        this.bridgeConnecting = false
        console.log(`control connected: ${bridgeHost}:${bridgePort}`)
        this.broadcastStatus()
      }
    )

    sock.setNoDelay(true)
    sock.on("error", () => {
      this.bridgeConnecting = false
      this.nextBridgeRetryAt = Date.now() + bridgeRetrySec * 1000
    })
    sock.on("close", () => {
      if (this.bridge === sock) {
        this.bridge = null
      }
      this.bridgeConnecting = false
      this.nextBridgeRetryAt = Date.now() + bridgeRetrySec * 1000
      this.broadcastStatus()
    })
  }

  sendBridge(message) {
    let payload
    try {
      payload = JSON.parse(message)
    } catch {
      return
    }

    if (!this.bridge) {
      this.ensureBridgeConnected()
    }
    if (!this.bridge) {
      return
    }

    this.bridge.write(`${message}\n`, "utf8", (error) => {
      if (error) {
        this.bridge?.destroy()
        this.bridge = null
        this.nextBridgeRetryAt = Date.now() + bridgeRetrySec * 1000
      }
    })
    this.logControl(payload)
  }

  logControl(payload) {
    let summary = ""
    if (payload.type === "drive") {
      const throttle = payload.throttle ?? 0
      const steering = payload.steering ?? 0
      const arm = payload.arm ?? 0
      if (![throttle, steering, arm].some((value) => Math.abs(value) > 0.01)) {
        return
      }
      summary = `drive throttle=${throttle} steering=${steering} arm=${arm}`
    } else if (payload.type === "action") {
      summary = `action=${payload.action}`
    }

    if (summary && summary !== this.lastControlLog) {
      console.log(`control forwarded: ${summary}`)
      this.lastControlLog = summary
    }
  }

  broadcastStatus() {
    this.broadcast(this.statusPayload())
  }

  sendStatus(ws) {
    this.send(ws, this.statusPayload())
  }

  statusPayload() {
    const telemetryAgeSec =
      this.lastTelemetryAt === 0
        ? null
        : Math.round(((Date.now() - this.lastTelemetryAt) / 1000) * 1000) /
          1000

    return {
      type: "gateway_status",
      payload: {
        control_connected: Boolean(this.bridge),
        telemetry_count: this.telemetryCount,
        telemetry_age_sec: telemetryAgeSec,
        telemetry_peer: this.lastTelemetryPeer,
      },
    }
  }

  broadcast(payload) {
    for (const client of this.clients) {
      this.send(client, payload)
    }
  }

  send(ws, payload) {
    if (ws.readyState === BrowserSocket.OPEN) {
      ws.send(JSON.stringify(payload))
    }
  }
}

const gateway = new Gateway()
const browserSockets = new Set()
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host}`)
    .pathname

  serveStatic(req, res).catch((error) => {
    console.error(`static serve error: ${error.message}`)
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
    res.end("internal server error")
  })
})

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname

  if (pathname === "/ws") {
    const ws = acceptWebSocket(req, socket, head)
    if (!ws) {
      return
    }
    browserSockets.add(ws)
    ws.on("close", () => browserSockets.delete(ws))
    ws.on("error", () => browserSockets.delete(ws))
    queueMicrotask(() => {
      gateway.addClient(ws)
    })
    return
  }

  socket.destroy()
})

server.listen(port, host, () => {
  gateway.listen()
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host
  console.log(`WebUI: http://${displayHost}:${port}`)
  console.log(`target mode: ${targetMode}`)
  console.log(`control tcp -> ${bridgeHost}:${bridgePort}`)
  if (targetMode === "local" && !remoteHost && !process.env.BRIDGE_HOST) {
    console.warn("local target mode has no RASPIKE_REMOTE_HOST or BRIDGE_HOST")
  }
  if (!existsSync(distDir)) {
    console.warn("dist directory is missing. Run `pnpm build` before production start.")
  }
})

async function serveStatic(req, res) {
  if (!existsSync(distDir)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
    res.end("dist directory is missing. Run `pnpm build`.")
    return
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const pathname = decodeURIComponent(url.pathname)
  const requestedPath = pathname === "/" ? "/index.html" : pathname
  const normalized = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "")
  let filePath = resolve(join(distDir, normalized))

  if (!filePath.startsWith(distDir + sep) && filePath !== distDir) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" })
    res.end("forbidden")
    return
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(distDir, "index.html")
  }

  const headers = {
    "content-type": mimeType(filePath),
    "cache-control": filePath.includes(`${sep}assets${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  }

  res.writeHead(200, headers)
  createReadStream(filePath).pipe(res)
}

function mimeType(filePath) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
  }
  return types[extname(filePath).toLowerCase()] || "application/octet-stream"
}

async function loadEnvFile(path) {
  if (!existsSync(path)) {
    return
  }

  const text = await readFile(path, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue
    }
    const [key, ...rest] = trimmed.split("=")
    if (process.env[key]) {
      continue
    }
    process.env[key] = rest
      .join("=")
      .trim()
      .replace(/^['"]|['"]$/g, "")
  }
}

let shuttingDown = false

const closeServer = () =>
  new Promise((resolve) => {
    server.close((error) => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
        console.error(`http server close error: ${error.message}`)
      }
      resolve()
    })
  })

const shutdown = (signal) => {
  if (shuttingDown) {
    return
  }
  shuttingDown = true

  const exitCode = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 0
  const forceExit = setTimeout(() => process.exit(exitCode), 3000)
  forceExit.unref()

  ;(async () => {
    gateway.close()
    for (const client of browserSockets) {
      client.terminate()
    }
    server.closeIdleConnections()
    await closeServer()
    process.exit(exitCode)
  })().catch((error) => {
    console.error(`shutdown error: ${error?.message ?? error}`)
    process.exit(1)
  })
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

class BrowserSocket extends EventEmitter {
  static OPEN = 1
  static CLOSED = 3

  constructor(socket) {
    super()
    this.socket = socket
    this.readyState = BrowserSocket.OPEN
    this.buffer = Buffer.alloc(0)

    socket.on("data", (chunk) => this.read(chunk))
    socket.on("close", () => this.close())
    socket.on("error", (error) => {
      this.emit("error", error)
      this.close()
    })
  }

  read(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])

    while (this.buffer.length >= 2) {
      const first = this.buffer[0]
      const second = this.buffer[1]
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let length = second & 0x7f
      let offset = 2

      if (length === 126) {
        if (this.buffer.length < offset + 2) {
          return
        }
        length = this.buffer.readUInt16BE(offset)
        offset += 2
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) {
          return
        }
        const bigLength = this.buffer.readBigUInt64BE(offset)
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.terminate()
          return
        }
        length = Number(bigLength)
        offset += 8
      }

      const maskLength = masked ? 4 : 0
      if (this.buffer.length < offset + maskLength + length) {
        return
      }

      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null
      offset += maskLength
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length))
      this.buffer = this.buffer.subarray(offset + length)

      if (mask) {
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] ^= mask[i % 4]
        }
      }

      if (opcode === 0x8) {
        this.close()
        return
      }
      if (opcode === 0x9) {
        this.writeFrame(0xA, payload)
        continue
      }
      if (opcode === 0x1) {
        this.emit("message", payload.toString("utf8"))
      }
    }
  }

  send(data) {
    if (this.readyState !== BrowserSocket.OPEN) {
      return
    }
    this.writeFrame(0x1, Buffer.from(data, "utf8"))
  }

  writeFrame(opcode, payload) {
    if (this.readyState !== BrowserSocket.OPEN) {
      return
    }

    let header
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, payload.length])
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }

    this.socket.write(Buffer.concat([header, payload]))
  }

  close() {
    if (this.readyState === BrowserSocket.CLOSED) {
      return
    }
    this.readyState = BrowserSocket.CLOSED
    this.socket.end()
    this.emit("close")
  }

  terminate() {
    if (this.readyState === BrowserSocket.CLOSED) {
      return
    }
    this.readyState = BrowserSocket.CLOSED
    this.socket.destroy()
    this.emit("close")
  }
}

function acceptWebSocket(req, socket, head) {
  const key = req.headers["sec-websocket-key"]
  if (!key) {
    socket.destroy()
    return null
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64")

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  )

  const ws = new BrowserSocket(socket)
  if (head?.length) {
    ws.read(head)
  }
  return ws
}
