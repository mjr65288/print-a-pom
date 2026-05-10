"""
Backend for the Print-A-Pom control UI.

Proxies HTTP calls to the printer firmware (session token, /status, /lines, etc.),
tracks connection and print progress in memory, and batches long jobs so the
machine can breathe between chunks. Not a substitute for the printer's own API docs.
"""

from fastapi import FastAPI, HTTPException, Header, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import httpx
import asyncio
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Print-A-Pom Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory state
printer_state = {
    "ip": None,
    "session_token": None,
    "connected": False,
    "printing": False,
    "print_progress": 0,
    "print_total": 0,
    "print_cancelled": False,
}

# How many P-Code lines we POST per /lines call before waiting on /ready.
BATCH_SIZE = 20


def get_printer_url(path: str) -> str:
    if not printer_state["ip"]:
        raise HTTPException(status_code=400, detail="Not connected to any printer")
    return f"http://{printer_state['ip']}{path}"


def get_headers() -> dict:
    """Session header the firmware expects on protected routes."""
    if not printer_state["session_token"]:
        raise HTTPException(status_code=401, detail="No active session token")
    return {"X-Session-Token": printer_state["session_token"]}


class ConnectRequest(BaseModel):
    ip: str


class ManualCommandRequest(BaseModel):
    command: str


class TemperatureRequest(BaseModel):
    nozzle: Optional[int] = None
    bed: Optional[int] = None


class MoveRequest(BaseModel):
    axis: str  # x, y, z
    distance: float  # mm


class ExtrudeRequest(BaseModel):
    amount: float  # mm


class FilamentRequest(BaseModel):
    action: str  # load or unload
    nozzle_temp: int = 210


@app.post("/api/connect")
async def connect(req: ConnectRequest):
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # First verify we can reach the printer
            status_resp = await client.get(f"http://{req.ip}/status")
            if status_resp.status_code != 200:
                #  printer responds but with bad data
                raise HTTPException(status_code=502, detail="Printer did not respond to status check")

            # Connect and get session token
            connect_resp = await client.post(f"http://{req.ip}/connect")
            if connect_resp.status_code != 200:
                #  printer refused connection
                raise HTTPException(status_code=502, detail="Printer refused connection")

            data = connect_resp.json()
            token = data.get("session_token")
            if not token:
                #  printer returned no session token
                raise HTTPException(status_code=502, detail="No session token returned")

            printer_state["ip"] = req.ip
            printer_state["session_token"] = token
            printer_state["connected"] = True
            printer_state["printing"] = False
            printer_state["print_progress"] = 0
            printer_state["print_total"] = 0
            printer_state["print_cancelled"] = False

            logger.info(f"Connected to printer at {req.ip}")
            return {"success": True, "session_token": token, "ip": req.ip}

    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"Cannot reach printer at {req.ip}")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"Timeout connecting to printer at {req.ip}")


@app.post("/api/disconnect")
async def disconnect():
    """Tell the printer to disconnect if possible; always clears local session."""
    if not printer_state["connected"]:
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                get_printer_url("/disconnect"),
                headers=get_headers()
            )
    except Exception as e:
        logger.warning(f"Error during disconnect: {e}")
    finally:
        printer_state["ip"] = None
        printer_state["session_token"] = None
        printer_state["connected"] = False
        printer_state["printing"] = False
        printer_state["print_progress"] = 0
        printer_state["print_total"] = 0

    return {"success": True}


@app.get("/api/status")
async def get_status():
    """Forward /status and merge in `app_state` so the SPA shows print counters."""
    if not printer_state["ip"]:
        raise HTTPException(status_code=400, detail="Not connected to any printer")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(get_printer_url("/status"))
            data = resp.json()
            # Inject our own state
            data["app_state"] = {
                "connected": printer_state["connected"],
                "printing": printer_state["printing"],
                "print_progress": printer_state["print_progress"],
                "print_total": printer_state["print_total"],
            }
            return data
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Lost connection to printer")


@app.get("/api/ready")
async def check_ready(timeout: int = 0):
    """Passthrough to the printer’s ready gate (used internally during prints)."""
    try:
        async with httpx.AsyncClient(timeout=max(timeout + 5, 15.0)) as client:
            url = get_printer_url(f"/ready?timeout={timeout}")
            resp = await client.get(url, headers=get_headers())
            return {"ready": resp.status_code == 200, "status_code": resp.status_code}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/log")
async def get_log(amount: int = 10):
    """Tail of the firmware log; `amount` is forwarded as a query param."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                get_printer_url(f"/log?amount={amount}"),
                headers=get_headers()
            )
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/command")
async def send_command(req: ManualCommandRequest):
    """Single raw P-Code line; rejected while `printing` is true."""
    if printer_state["printing"]:
        raise HTTPException(status_code=409, detail="Cannot send manual commands while printing")
    return await _send_lines([req.command])


@app.post("/api/move")
async def move(req: MoveRequest):
    """Relative jog: reads current XYZ from status, applies delta, sends one HEEL."""
    if printer_state["printing"]:
        raise HTTPException(status_code=409, detail="Cannot move while printing")
    # We need current position to do relative moves
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(get_printer_url("/status"))
            status = resp.json()
            pos = status["sensors"]["position"]
            x, y, z = pos[0], pos[1], pos[2]

        if req.axis == "x":
            x += req.distance
        elif req.axis == "y":
            y += req.distance
        elif req.axis == "z":
            z += req.distance

        cmd = f"HEEL {x},{y},{z}"
        return await _send_lines([cmd]) # send the HEEL command to the printer, Ex: "HEEL 110,50,0.2"
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/extrude")
async def extrude(req: ExtrudeRequest):
    """Positive FETCH extrudes; negative retracts."""
    if printer_state["printing"]:
        raise HTTPException(status_code=409, detail="Cannot extrude while printing")
    return await _send_lines([f"FETCH {req.amount}"])


@app.post("/api/temperature")
async def set_temperature(req: TemperatureRequest):
    """SIT for nozzle, DOWN for bed — only sends lines for fields you pass."""
    lines = []
    if req.nozzle is not None:
        lines.append(f"SIT {req.nozzle}")
    if req.bed is not None:
        lines.append(f"DOWN {req.bed}")
    if not lines:
        raise HTTPException(status_code=400, detail="No temperature values provided")
    return await _send_lines(lines)


@app.post("/api/home")
async def home():
    """Homes via PLACE (matches the mock and MaxPro P-Code vocabulary)."""
    if printer_state["printing"]:
        raise HTTPException(status_code=409, detail="Cannot home while printing")
    return await _send_lines(["PLACE"])


@app.post("/api/clear-faults")
async def clear_faults():
    """Sends GOODPUP to clear latched faults on the controller."""
    return await _send_lines(["GOODPUP"])


@app.post("/api/filament")
async def filament_operation(req: FilamentRequest):
    """Scripted heat + wait + extrude/retract sequence for load or unload."""
    if printer_state["printing"]:
        raise HTTPException(status_code=409, detail="Cannot change filament while printing")

    if req.action == "load":
        # Heat nozzle, wait, then extrude to load
        lines = [
            f"SIT {req.nozzle_temp}",
            "STAY 300",
            "SPEAK",
            "FETCH 50",   # push filament through
            "FETCH 30",
            "FETCH 20",
        ]
    elif req.action == "unload":
        # Heat nozzle, wait, then retract
        lines = [
            f"SIT {req.nozzle_temp}", # 1. Heat nozzle to temp
            "STAY 300", # 2. Wait for temp
            "SPEAK", # 3. Speak the status
            "FETCH -20",  # 4. Retract slowly first
            "FETCH -80",  # 5. Fast retract
        ]
    else:
        raise HTTPException(status_code=400, detail="action must be 'load' or 'unload'")

    return await _send_batched(lines)


@app.post("/api/print/cancel")
async def cancel_print():
    """Sets a flag; the background print loop stops before the next batch."""
    printer_state["print_cancelled"] = True
    return {"success": True, "message": "Cancel requested"}


@app.post("/api/print")
async def print_pcode(file: UploadFile = File(...)):
    """Strip comments, enqueue non-empty lines, and kick off `_run_print` asynchronously."""
    # Do not allow starting a new print while one is running
    if printer_state["printing"]:
        raise HTTPException(status_code=409, detail="Already printing")

    # Require the printer to be connected before printing
    if not printer_state["connected"]:
        raise HTTPException(status_code=400, detail="Not connected")

    # Read the uploaded file content
    content = await file.read()
    # Decode content as UTF-8, split into lines
    raw_lines = content.decode("utf-8").splitlines()

    # Filter out comments and blank lines
    lines = []
    for line in raw_lines:
        # Remove comments (anything after ';') and whitespace
        stripped = line.split(";")[0].strip()
        if stripped:
            lines.append(stripped)  # Only enqueue non-empty lines

    # No printable lines found: reject
    if not lines:
        raise HTTPException(status_code=400, detail="No valid P-Code lines found")

    # Update printer state to indicate printing has started
    printer_state["printing"] = True
    printer_state["print_cancelled"] = False
    printer_state["print_progress"] = 0
    printer_state["print_total"] = len(lines)

    # Start _run_print in the background so API returns immediately
    asyncio.create_task(_run_print(lines))

    # Return a success response to the client
    return {
        "success": True,
        "total_lines": len(lines),
        "message": f"Print started with {len(lines)} lines"
    }


@app.get("/api/print/progress")
async def print_progress():
    """Line counter + percent for the UI; `cancelled` reflects user cancel request."""
    return {
        "printing": printer_state["printing"], # true while job is running
        "progress": printer_state["print_progress"], # lines sent so far
        "total": printer_state["print_total"], # total lines in file
        "percent": (
            round(printer_state["print_progress"] / printer_state["print_total"] * 100, 1) # percentage complete, rounded to 1 decimal place
            if printer_state["print_total"] > 0 else 0
        ),
        "cancelled": printer_state["print_cancelled"], # true if the print was cancelled by the user
    }


async def _run_print(lines: list[str]):
    """
    Send `BATCH_SIZE` lines at a time to the printer.
    Wait for /ready endpoint between batches.
    Honor cancellation if requested.

    Why batch instead of sending all lines at once?
    Most printer firmwares have tiny buffers. 
    """
    try:
        # Loop over lines in BATCH_SIZE chunks
        for i in range(0, len(lines), BATCH_SIZE):
            # If a cancel request has been set, stop printing
            if printer_state["print_cancelled"]:
                logger.info("Print cancelled by user")
                break

            # Get the current batch of lines to send
            batch = lines[i:i + BATCH_SIZE]
            # Send these lines to the printer
            await _send_lines(batch)

            # Wait for the machine to be ready before sending the next batch
            try:
                async with httpx.AsyncClient(timeout=65.0) as client:
                    await client.get(
                        get_printer_url("/ready?timeout=60"),
                        headers=get_headers()
                    )
            except Exception as e:
                # Log but allow job to continue even if ready check fails
                logger.warning(f"Ready check failed: {e}")

            # That line updates the progress counter after each batch, 
            # but makes sure you never report more lines than actually exist.
            printer_state["print_progress"] = min(i + BATCH_SIZE, len(lines))

        # Ensure progress marks as completed at the end
        #printer_state["print_progress"] = printer_state["print_total"]
    except Exception as e:
        # Log any top-level exception that occurs during printing
        logger.error(f"Print error: {e}")
    finally:
        # Mark printing as finished/aborted in any case
        printer_state["printing"] = False


async def _send_batched(lines: list[str]) -> dict:
    """Like `_run_print` but for shorter scripted sequences (filament wizard)."""
    results = []
    for i in range(0, len(lines), BATCH_SIZE):
        batch = lines[i:i + BATCH_SIZE]
        result = await _send_lines(batch)
        results.append(result)
        if i + BATCH_SIZE < len(lines):
            # Wait for ready between batches
            async with httpx.AsyncClient(timeout=65.0) as client:
                await client.get(
                    get_printer_url("/ready?timeout=60"),
                    headers=get_headers()
                )
    return {"success": True, "batches": results}


async def _send_lines(lines: list[str]) -> dict:
    """
    Sends a list of P-Code command lines to the printer using a POST request.

    Args:
        lines (list[str]): A list of string commands to send to the printer.

    Returns:
        dict: A dictionary with 'success' (bool) indicating the request status,
              and 'status_code' (int) for the HTTP response code.

    Raises:
        HTTPException: If any connection or request error occurs, raises with
                       HTTP 502 and the error detail.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                get_printer_url("/lines"),
                headers=get_headers(),
                json={"lines": lines}
            )
            return {"success": resp.status_code == 200, "status_code": resp.status_code}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
