"""
Mock Print-A-Pom Printer Server
Simulates the printer REST API for local testing.
Run with: python mock_printer.py
Listens on http://localhost:9000
"""

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import random
import time
import math

app = FastAPI(title="Mock Print-A-Pom Printer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simulated machine state
state = {
    "session_token": None,
    "nozzle_temp": 25.0,
    "nozzle_target": 0.0,
    "bed_temp": 22.0,
    "bed_target": 0.0,
    "position": [0.0, 0.0, 0.0],
    "parked": True,
    "filament": True,
    "faults": 0,
    "boot_time": time.time(),
    "log": [],
    "ready": True,
}

# Fixed token so the backend and mock agree without config files.
SESSION_TOKEN = "bW9ja19wcmludGVyX3Nlc3Npb24="


def require_token(x_session_token: str = Header(None)):
    """401 unless the caller presents the mock session header."""
    if x_session_token != SESSION_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing session token")


def simulate_temp_drift():
    """Slowly move current temps toward their targets."""
    diff_n = state["nozzle_target"] - state["nozzle_temp"]
    diff_b = state["bed_target"] - state["bed_temp"]
    # move 15% of the remaining distance to the target, plus some random noise
    state["nozzle_temp"] += diff_n * 0.15 + random.uniform(-0.3, 0.3)
    # move 8% of the remaining distance to the target, plus some random noise
    state["bed_temp"] += diff_b * 0.08 + random.uniform(-0.1, 0.1)
    # ensure the temperatures are not below 20°C
    state["nozzle_temp"] = max(20.0, state["nozzle_temp"])
    # ensure the temperatures are not below 20°C
    state["bed_temp"] = max(20.0, state["bed_temp"])


def add_log(msg: str):
    """Ring buffer of human-readable lines returned by GET /log."""
    ts = time.strftime("%H:%M:%S")  # Get current time string in HH:MM:SS format
    # Append the timestamped message to the log list
    state["log"].append(f"[{ts}] {msg}")
    # If the log exceeds 100 entries, discard the oldest entry to maintain ring buffer size
    if len(state["log"]) > 100:
        state["log"].pop(0)
 


@app.get("/status",  status_code=200)
def get_status() -> dict:
    """Firmware-shaped JSON: dims, temps, position, filament flag, fault bitmask."""
    simulate_temp_drift()
    uptime = (time.time() - state["boot_time"]) / 3600
    return {
        "status": {
            "time_since_boot": round(uptime, 2), # hours since mock started
            "total_time": 1337, # total print hours, fake odometer
            "version": 1.21, # firmware version
            "dimensions": [300, 300, 450], # build volume X,Y,Z in mm
            "model": "Print-A-Pom-MaxPro", # printer model name
        },
        "sensors": {
            "parked": state["parked"], # true if the nozzle is parked at the origin
            "nozzle": round(state["nozzle_temp"], 1), # nozzle temperature in degrees C
            "bed": round(state["bed_temp"], 1), # bed temperature in degrees C
            #  loops each value v and rounds it to 2 decima
            "position": [round(v, 2) for v in state["position"]], # nozzle position X,Y,Z in mm from your HEEL command
            "filament": state["filament"], # true if the filament is present
        },
        "faults": state["faults"], # bitmask of active faults
    }


@app.post("/connect", status_code=200)
def connect() -> dict:
    """Returns the static session token the UI backend will forward on later calls."""
    state["session_token"] = SESSION_TOKEN
    add_log("Client connected")
    return {"session_token": SESSION_TOKEN}


@app.post("/disconnect")
def disconnect(x_session_token: str = Header(None)):
    """Clears server-side session; next /lines will 401 until /connect again."""
    require_token(x_session_token)
    state["session_token"] = None
    add_log("Client disconnected")
    return {"ok": True}


@app.get("/ready")
def ready(timeout: int = 0, x_session_token: str = Header(None)):
    """Always succeeds in the mock; real firmware may block until moves finish."""
    require_token(x_session_token)
    simulate_temp_drift()
    return {"ready": True}


@app.get("/log")
def get_log(amount: int = 10, x_session_token: str = Header(None)):
    require_token(x_session_token)  # Ensure valid session using token from header
    # Return the last `amount` log entries
    return state["log"][-amount:]


@app.post("/lines")
async def run_lines(request: Request, x_session_token: str = Header(None)):
    """Step through P-Code lines, nudge temps/position, append to the fake log."""
    require_token(x_session_token) # check the session token
    body = await request.json() # get the body of the request
    lines = body.get("lines", []) # get the lines from the body

    for line in lines: # loop through the lines
        parts = line.strip().split() # remove whitespace from beginning and end of the line and then
                                     # split the line into parts by whitespace, EX: "SIT 210" -> ["SIT", "210"]
        if not parts:
            continue # if the line is empty, continue to the next line
        cmd = parts[0].upper() # get the command from the first part

        if cmd == "SIT" and len(parts) > 1:
            state["nozzle_target"] = float(parts[1]) # set the nozzle target temperature to the value
            add_log(f"Nozzle target set to {parts[1]}°C") # log the nozzle target temperature

        elif cmd == "DOWN" and len(parts) > 1:
            state["bed_target"] = float(parts[1]) # set the bed target temperature to the value
            add_log(f"Bed target set to {parts[1]}°C") # log the bed target temperature

        elif cmd == "STAY":
            simulate_temp_drift() # simulate the temperature drift towards the target
            add_log(f"Waiting for temps — nozzle {state['nozzle_temp']:.1f}°C / bed {state['bed_temp']:.1f}°C")

        elif cmd == "PAW":
            state["position"][2] = round(state["position"][2] + 5, 2) # lift the nozzle by 5mm
            add_log(f"Lifted nozzle to Z={state['position'][2]}") # log the new Z position

        elif cmd == "PLACE":
            state["position"] = [0.0, 0.0, 0.0] # home the nozzle to the origin
            state["parked"] = True
            add_log("Homed — parked at origin")

        elif cmd == "HEEL" and len(parts) > 1:
            coords = parts[1].split(",") # split the command into X,Y,Z coordinates
            state["position"][0] = float(coords[0]) # set the X coordinate to the value
            state["position"][1] = float(coords[1]) # set the Y coordinate to the value
            if len(coords) > 2: # if the command has a Z coordinate, set it to the value
                state["position"][2] = float(coords[2]) # set the Z coordinate to the value
            state["parked"] = False # set parked to false because the nozzle is not parked at the origin
            add_log(f"Moved to X={state['position'][0]} Y={state['position'][1]} Z={state['position'][2]}")

        elif cmd == "FETCH" and len(parts) > 1:
            amt = float(parts[1]) # set the extrusion amount to the value
            add_log(f"Extruded {amt}mm")

        elif cmd == "SPEAK":
            add_log( # log the current status of the printer
                f"STATUS nozzle={state['nozzle_temp']:.1f}°C bed={state['bed_temp']:.1f}°C " # log the current temperature of the nozzle and bed
                f"pos=[{state['position'][0]},{state['position'][1]},{state['position'][2]}] " # log the current position of the nozzle
                f"faults=0x{state['faults']:02X}" # log the current faults of the printer
            )

        elif cmd == "GOODPUP": # clear the faults of the printer
            state["faults"] = 0 # set the faults to 0
            add_log("Faults cleared") # log the fault clearing

    return {"ok": True, "processed": len(lines)} # return the number of lines processed


if __name__ == "__main__":
    print("=" * 50)
    print("  Mock Print-A-Pom Printer")
    print("  Listening on http://localhost:9000")
    print("  Connect the app to: localhost:9000")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=9000)
