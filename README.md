# RasPike Web Control v3

Vite + React Web UI for `raspike-bridge-ps5`.

v2 の Next.js 構成から、配布しやすい静的 `dist` 構成へ移行した版です。UI は Vite でビルドし、`server.mjs` は次の役割だけを持ちます。

- `dist/` の静的配信
- Browser WebSocket `/ws` と bridge TCP の中継
- RasPi telemetry UDP の受信と Browser への配信

```text
RasPi UDP telemetry -> server.mjs -> Browser WebSocket
Browser control -> server.mjs -> RasPi TCP control
```

## Development

UI だけを開発する場合:

```bash
pnpm install
pnpm dev
```

gateway も動かす場合は別ターミナルで起動します。Vite は `/ws` を `127.0.0.1:3001` へ proxy します。

```bash
pnpm dev:gateway
pnpm dev
```

Open:

```text
http://127.0.0.1:5173
http://127.0.0.1:5173/calibration
```

## Production

```bash
pnpm install --prod=false
pnpm build
RASPIKE_TARGET=remote pnpm start
```

`pnpm build` は `dist/` を生成します。platform installer/update は GitHub Releases の `dist.zip` だけを取得します。`server.mjs` は単体ではダウンロードしないため、release 用には `pnpm build:dist-zip` で `dist/` と `server.mjs` を同梱した zip を作成してください。

`main`へpushすると、GitHub Actionsの`Release dist.zip` workflowが同じビルドを実行し、`dist.zip`を添付した最新のGitHub Releaseを自動作成します。Actions画面から手動実行することもできます。

## Configuration

Default remote mode:

```bash
RASPIKE_TARGET=remote pnpm start
```

In remote mode, the server listens on `0.0.0.0:3000`, receives telemetry on UDP `0.0.0.0:8765`, and connects control TCP to `127.0.0.1:8766`.

Optional local PC mode:

```bash
RASPIKE_TARGET=local RASPIKE_REMOTE_HOST=<RASPI_IP_ADDRESS> pnpm start
```

Optional environment variables:

```bash
HOST=0.0.0.0
PORT=3000
RASPIKE_TARGET=remote
RASPIKE_REMOTE_HOST=<RASPI_IP_ADDRESS>
TELEMETRY_HOST=0.0.0.0
TELEMETRY_PORT=8765
BRIDGE_HOST=<OVERRIDE_HOST>
BRIDGE_PORT=8766
ETROBO_TELEMETRY_CSV=/home/raspike/etrobo2026/logs/latest.csv
```

`ETROBO_TELEMETRY_CSV`を設定すると、Gatewayは`etrobo2026`が出力する最新CSVを読み、
SPIKE側のキャリブレーション工程、色センサー値、判定結果をWebSocketへ転送します。
未設定またはファイルが存在しない場合、Web UIは`ETROBO telemetry waiting`と表示します。
Raspberry Pi上では`http://<RASPI_IP>:3000/calibration`から専用画面を直接開けます。

Client-side Vite variables:

```bash
VITE_GATEWAY_WS_URL=ws://127.0.0.1:3000/ws
```

Usually this can remain unset. The browser will use the current host for `/ws`.

## Drive controls

- `ENABLE` / `DISABLE`: bridge controlを手動で有効・無効化
- `W/S`, `A/D`: 前後進、左右旋回（画面上のボタンも長押し可能）
- `Shift`: 精密操作
- `Space`: 緊急停止
- `Drive settings`: 速度、旋回PWM、初動PWM、立ち上がり、精密モード、アーム出力、自動enableを調整

Drive settingsはブラウザのlocal storageに保存されます。旋回の初期値は、停止状態からでも動き出しやすいように `Turn start=0.65`, `Turn max=1.00` です。
