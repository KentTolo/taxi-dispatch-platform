# Taxi Dispatch Platform

Uber-style booking and dispatch for taxi companies in Lesotho, starting with live driver tracking.

| Folder | What it is |
| --- | --- |
| `backend/` | Python (FastAPI) server: driver login, shifts, location uploads, live driver list, nearest-driver search, office live map at `/ops` |
| `driver-app/` | Lightweight Android driver app (Capacitor). Tracks location in the background during a shift, even with the screen off |
| `.github/workflows/` | Builds the driver APK on every push, and runs the server tests |

## Driver app: how tracking stays on

- **Start shift** starts a foreground service with a permanent "On shift — location sharing on" notification. Android keeps apps with such a notification alive, so tracking continues with the screen locked or the app swiped away.
- GPS is read every second, but a point is only kept when the car moves 15 m (at most every 4 s), or every 30 s when parked, as a heartbeat. That's about 1 KB per upload.
- Points are saved on the phone and sent in batches every 5 s. With no signal they queue (up to about 25 hours) and are sent when the signal returns.
- Uploads use native HTTP, because Android throttles WebView requests in the background.
- **End shift** stops tracking and the notification. Nothing is tracked off shift.
- If a driver hasn't reported for 90 s, the office map shows them as "signal lost" and they get no rides.

Driver phone checklist: Android 7 or newer, location set to "Allow" (precise), notifications allowed, battery use for the app set to **Unrestricted**. Some Tecno, Infinix, Itel, Xiaomi and Huawei phones need this or they kill background apps.

## Install the driver app on a phone

1. Each push to `main` builds the APK. The download link is
   `https://github.com/<owner>/<repo>/releases/download/driver-latest/driver-app.apk`
   (the repo must be public, or give drivers the APK file directly).
2. On the phone, open the link, download, tap the file, and allow "Install unknown apps" for the browser.
3. Open **Driver** and enter the server address and company code (`demo`). Log in with the driver's phone number and the SMS code. In demo mode the code is shown on screen.

New builds install over the old one, because every build is signed with the same demo key (`driver-app/android/app/demo-debug.keystore`). Before the Play Store or go-live, create a private release key and keep it out of git.

## Run the server locally

```bash
cd backend
pip install -r requirements.txt
python -m app.seed          # demo company "demo" with 5 drivers: +266 5800 0001 ... 6200 0005
uvicorn app.main:app --reload --host 0.0.0.0
```

- Office live map: http://localhost:8000/ops (company `demo`, operator key `demo-ops-key`). Click the map to list the nearest available drivers.
- API docs: http://localhost:8000/docs
- Tests: `python -m pytest -q`

To test with a real phone on the same Wi-Fi, use the computer's IP address as the server address in the app, e.g. `http://192.168.1.20:8000`.

## Put the demo server online (Render)

1. Push this repo to GitHub, then on render.com choose **New › Blueprint** and pick the repo. `render.yaml` creates the web service and a Postgres database.
2. Copy the `OPS_KEY` Render generated: it's the operator key for `/ops`.
3. In GitHub, go to **Settings › Secrets and variables › Actions › Variables** and add `DEMO_SERVER_URL` = your Render address. New APKs will then have it filled in.

Render's free database expires after a limited period and its free web service sleeps when idle. Move to a paid plan before showing clients.

## Settings (environment variables)

| Name | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./dev.db` | Postgres in production |
| `SECRET_KEY` | dev value | Signs login tokens. **Must be set** in production |
| `OPS_KEY` | `demo-ops-key` | Temporary operator key, until operator accounts are built |
| `DEMO_MODE` | `true` | Shows SMS codes on screen instead of sending them |
| `SIGNAL_LOST_AFTER_S` | `90` | Seconds without a position before "signal lost" |
| `DEFAULT_RADIUS_KM` | `8` | Nearest-driver search radius |
