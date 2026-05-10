# Print-A-Pom Control Center

A full-stack web application for controlling Print-A-Pom 3D printers via their REST API.

---

## Screenshots

See `screenshots/` directory for UI and P-Code visualizer screenshots.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript |
| Styling | Tailwind CSS, PrimeReact, PrimeIcons |
| Animations | Framer Motion |
| Backend | Python 3.12, FastAPI, httpx |
| Container | Docker + Docker Compose |

---

## Quick Start (Docker)

### Prerequisites
- Docker Desktop (or Docker Engine + Compose)

### Run with Docker Compose

```bash
# Clone / unzip the project
cd print-a-pom

# Build and start all services (frontend, backend, mock printer)
docker compose up --build

# Navigate to:
open http://localhost:8080
```

The frontend runs at **port 8080**, backend at **port 8000**, and the mock printer at **port 9000**.

### Docker Testing Without a Real Printer

When using Docker Compose, a mock printer service is available by default.

1. Start the stack:
   ```bash
   docker compose up --build
   ```
2. Open the app at `http://localhost:8080`
3. In the Connect field, use printer IP: `mock-printer:9000`

This works because both backend and mock-printer run on the same Compose network.

---

## Local Development (without Docker)

You will need three terminals running simultaneously:

| Terminal | Directory | Command | Port |
|---|---|---|---|
| 1 | `backend/` | `python -m uvicorn main:app --reload --port 8000` | 8000 |
| 2 | `backend/` | `python mock_printer.py` | 9000 |
| 3 | `frontend/` | `npm install && npm run dev` | 8080 |

### Backend setup

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

### Mock printer

```bash
# In a second terminal
cd backend
python mock_printer.py
```
The mock printer simulates the full Print-A-Pom REST API on **port 9000**. It tracks nozzle/bed temperatures (which slowly drift toward their targets when set), nozzle position, faults, and logs every P-Code command it receives. Use it to test the full UI without a real machine.

To connect via the app, enter **`localhost:9000`** as the printer IP.

### Frontend

```bash
cd frontend
npm install
npm run dev
```
Navigate to **http://localhost:8080**.

---

## Usage Guide

### 1. Connect to a Printer

Enter the printer IP address in the top bar and click **Connect**. For local testing use `localhost:9000` (mock printer). The status panel will populate with live data once connected.

### 2. Monitor Status

The **Machine Status** panel shows:
- Nozzle and bed temperatures with live gauges
- Nozzle XYZ position
- Active fault codes (decoded from bitmask)
- Filament sensor state
- Model and firmware version

### 3. Manual control

Under the **Manual** tab (disabled during printing):
- **XY jog pad** — moves the nozzle in configurable step sizes (0.1–50mm). Sends `HEEL x,y,z` using the current known position.
- **Z movement** — raises or lowers the nozzle
- **Home (⌂)** — sends `PLACE` to home the nozzle
- **Extrude / Retract** — sends `FETCH` with a configurable mm amount
- **Temperature sliders** — sends `SIT` (nozzle) and `DOWN` (bed)

> Manual controls are **disabled during printing** to prevent conflicts.

### 4. Filament

Under the **Filament** tab:
1. Set the nozzle temperature (default 210°C — minimum 170°C for most filaments)
2. Click **Load Filament** or **Unload Filament**
3. The app automatically:
   - Sends `SIT <temp>` to heat the nozzle
   - Sends `STAY 300` to wait until temperature is reached
   - For **load**: extrudes 100mm in batches to feed filament through
   - For **unload**: retracts slowly first (20mm) then quickly (80mm) to prevent stringing

> ⚠️ The nozzle **must** be at temperature before plastic can move. The app handles this automatically, but never try to load/unload cold.

### 5. Print a P-Code File

1. Drag and drop (or browse for) a `.pcode` file in the **Print Control** panel
2. Click **Start Print**
3. The backend sends the file to the printer in batches of up to 20 lines, polling `/ready` between each batch
4. Progress is shown in real time
5. Click **Cancel Print** to abort mid-job

### 6. P-Code Visualizer

When a P-Code file is loaded:
- The canvas renders the full toolpath
- **Orange lines** = extrusion moves (HEEL + FETCH) — brighter = more recent
- **Dashed grey lines** = travel moves (PAW lifted, no material)
- A **scrubber** lets you step through the path manually
- **Animate** button plays through the path at ~300 frames

During an active print, the visualizer shows a live **LIVE** badge and tracks the current progress automatically.

### 7. Machine Log

The **Machine Log** panel fetches serial output from the printer. Click **SPEAK** to send a status query and then **Fetch Log** to read the response. During printing the log auto-refreshes every 3 seconds.

---

## Assumptions

1. **Printer network**: The printer is assumed to be reachable from the machine running Docker on the given IP address and default HTTP port (80). If the printer uses a different port, append it to the IP (e.g. `192.168.1.100:5000`).

2. **P-Code comments**: Lines starting with `;` or text after `;` on any line are treated as comments and stripped before sending to the printer.

3. **Batch size**: P-Code is sent in batches of 20 lines as per API spec. The backend polls `/ready?timeout=60` between batches to avoid overwhelming the printer.

4. **Filament retract direction**: `FETCH` with a negative value is assumed to retract filament. This is standard for most FDM printer implementations.

5. **Z after PAW**: After a `PAW` command, if the next `HEEL` includes an explicit Z coordinate, the visualizer treats it as lowering back to printing height. A `HEEL` without Z maintains the lifted height.

6. **Single-client control**: The API spec states that a second `/connect` invalidates the previous session. This app manages one session at a time per browser tab.

7. **Temperature ready check**: The `STAY` timeout is set to 300 seconds (5 minutes) which should be sufficient for most nozzle preheating. For very cold environments this can be increased in `backend/main.py`.

---

## API Bonus Suggestion

**`GET /preview` — Toolpath Preview Endpoint**

The REST API would benefit from a `/preview` endpoint that accepts a P-Code payload and returns a structured JSON representation of the toolpath (coordinates, extrusion moves, estimated print time, bounding box). 

This would allow:
- Server-side P-Code parsing (useful for large files)
- Estimated print time before starting
- Collision detection against printer dimensions
- More accurate live progress (line numbers → physical progress)

```json
POST /preview
Body: { "lines": ["HEEL 100,100,0.2", "FETCH 0.4", ...] }

Response:
{
  "bounding_box": [[35, 16], [180, 185]],
  "total_moves": 312,
  "extrusion_moves": 198,
  "estimated_time_seconds": 1840,
  "filament_used_mm": 47.3,
  "path": [
    { "x": 100, "y": 185, "z": 0.2, "extrude": false },
    { "x": 95, "y": 182, "z": 0.2, "extrude": true, "amount": 0.4 },
    ...
  ]
}
```

---

## Project Structure

```
print-a-pom/
├── backend/
│   ├── main.py           # FastAPI app — proxies to printer REST API
│   ├── mock_printer.py      # Simulated printer for local testing
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx          # Main dashboard
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── ConnectionPanel.tsx  # Connect / disconnect
│   │   │   ├── StatusDisplay.tsx    # Temperatures, position, faults
│   │   │   ├── ManualControl.tsx    # Jog, extrude, temperature
│   │   │   ├── FilamentManager.tsx  # Load / unload routine
│   │   │   ├── PrintPanel.tsx       # File upload, print progress
│   │   │   └── PCodeVisualizer.tsx  # Canvas toolpath renderer
│   │   │   └── LogViewer.tsx
│   │   ├── lib/
│   │   │   └── api.ts            # Axios API client
│   │   └── types/
│   │       └── printer.ts        # Types + P-Code parser
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── package.json
│   └── Dockerfile
├── sample.pcode           # Example P-Code from assignment
├── docker-compose.yml
└── README.md
```
