/**
 * Shared types and helpers for the Print-A-Pom UI: status payloads from the
 * backend, fault decoding, P-Code parsing, and a simple XY path for the visualizer.
 */

/** Snapshot from `/api/status` (mirrors the printer JSON plus optional `app_state`). */
export interface PrinterStatus {
  status: {
    time_since_boot: number; // hours
    total_time: number;  // hours accumulated through lifetime
    version: number; // controller version
    dimensions: [number, number, number];  //working volume of a machine WxLxH in mm
    model: string;
  };
  sensors: {
    parked: boolean;
    nozzle: number; // nozzle temperature in degrees C
    bed: number; // nozzle temperature in degrees C
    position: [number, number, number];  // x,y,z position of the nozzle
    filament: boolean; // filament sensor - true if ok, false if missing
  };
  /** Bitmask; use {@link parseFaults} to expand into individual codes. */
  faults: number;
  /** Filled by our FastAPI proxy so the UI can show print progress without extra calls. */
  app_state?: {
    connected: boolean;
    printing: boolean;
    print_progress: number;
    print_total: number;
  };
}

/** One row in the fault legend (codes are powers of two for bitmasking). */
export interface FaultInfo {
  code: number;
  label: string;
  description: string;
}

export const FAULT_CODES: FaultInfo[] = [
  { code: 0x00, label: 'OK', description: 'No faults' },
  { code: 0x01, label: 'OUT_OF_FILAMENT', description: 'Out of filament' },
  { code: 0x02, label: 'OVER_TORQUE', description: 'Over torque – head may be obstructed' },
  { code: 0x04, label: 'AXIS_LIMIT_X', description: 'X axis limit exceeded' },
  { code: 0x08, label: 'AXIS_LIMIT_Y', description: 'Y axis limit exceeded' },
  { code: 0x10, label: 'AXIS_LIMIT_Z', description: 'Z axis limit exceeded' },
  { code: 0x20, label: 'NOZZLE_HEATER_FAULT', description: 'Nozzle heater fault' },
  { code: 0x40, label: 'BED_HEATER_FAULT', description: 'Bed heater fault' },
];

/**
 * Turns a fault bitmask into the list of active faults (skips OK / zero).
 * 
 * example:
 * parseFaults(0x01) // [ { code: 1, label: 'OUT_OF_FILAMENT', description: 'Out of filament' } ]
 * parseFaults(0x03) // [ { code: 1, label: 'OUT_OF_FILAMENT', description: 'Out of filament' }, { code: 2, label: 'OVER_TORQUE', description: 'Over torque – head may be obstructed' } ]
 */
export function parseFaults(faultCode: number): FaultInfo[] {
  if (faultCode === 0) return [];
  // loops through every item in an array and keeps only the ones where you return true
  return FAULT_CODES.filter(f => f.code !== 0 && (faultCode & f.code) !== 0);
}

/** Shape returned by `GET /api/print/progress`. */
export interface PrintProgress {
  printing: boolean;
  progress: number;
  total: number;
  percent: number;
  cancelled: boolean;
}

/** One logical line of P-Code after stripping inline `;` comments. */
export interface PCodeLine {
  raw: string;
  command: string;
  args: string[];
  lineNumber: number;
  isComment: boolean;
  isBlank: boolean;
}

/**
 * Splits file text into parsed lines. Semicolons start inline comments; full-line `;` comments are flagged.
 */
export function parsePCode(content: string): PCodeLine[] {
  return content.split('\n').map((raw, i) => {
    const commentIdx = raw.indexOf(';'); // finds the index of the first semicolon in the string
    const code = commentIdx >= 0 ? raw.slice(0, commentIdx).trim() : raw.trim();
    const isComment = raw.trim().startsWith(';');
    const isBlank = code === '' && !isComment;
    // extract words or non-empty segments from a string by splitting it at whitespace and removing any resulting empty elements
    const parts = code.split(/\s+/).filter(Boolean);
    return {
      raw,
      command: parts[0] || '',
      args: parts.slice(1), // slice the array from the second element to the end
      lineNumber: i + 1,
      isComment,
      isBlank,
    };
  });
}

/** A point on the toolpath derived from HEEL/FETCH/PAW semantics (for the 2D canvas). */
export interface VisualizerPoint {
  x: number;
  y: number;
  z: number;
  isTravel: boolean; // PAW lifted
  hasExtrude: boolean;
  extrudeAmount?: number;
}

/**
 * Walks HEEL/PAW/PLACE and pairs HEEL with a following FETCH when present.
 * This is a lightweight model of the real machine — good enough for preview, not a full simulator.
 */
export function buildVisualizerPath(lines: PCodeLine[]): VisualizerPoint[] {
  const points: VisualizerPoint[] = []; // array to store generated points for the visualizer
  let x = 0, y = 0, z = 0;              // current head position
  let lifted = false;                   // whether the nozzle is lifted (for indicating travel moves)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];                          // current PCode line
    const cmd = line.command.toUpperCase();         // uppercase command for comparison

    if (cmd === 'PAW') {                            // PAW = lift the nozzle
      lifted = true;                                // set the lifted flag
      z += 5;                                       // raise Z by 5 units (arbitrary lift)
    } else if (cmd === 'PLACE') {                   // PLACE = home/reset
      x = 0; y = 0; z = 0; lifted = false;          // reset all positions and lower nozzle
    } else if (cmd === 'HEEL') {                    // HEEL = move the nozzle to a given x,y,z position
      // Parse the coordinates from the first argument (e.g. "10,50,20")
      const coords = line.args[0]?.split(',').map(Number) || [];
      const newX = coords[0] ?? x;                  // use new X if provided, else old
      const newY = coords[1] ?? y;                  // use new Y if provided, else old
      const newZ = coords[2] ?? z;                  // use new Z if provided, else old

      // Look ahead: If the next non-blank non-comment line is FETCH, we treat this move as an extrusion
      let nextFetch: PCodeLine | undefined;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].isBlank && !lines[j].isComment) {      // skip blanks and comments
          if (lines[j].command.toUpperCase() === 'FETCH') {  // found FETCH
            nextFetch = lines[j];
          }
          break;                                             // whether FETCH or not, we stop at first code after HEEL
        }
      }

      // Add the new point to the array
      points.push({
        x: newX,
        y: newY,
        z: newZ,
        isTravel: lifted,                                  // true if nozzle was lifted prior to this
        hasExtrude: !!nextFetch,                           // extrusion if paired FETCH found
        extrudeAmount: nextFetch ? parseFloat(nextFetch.args[0]) : undefined, // extrusion amount from FETCH
      });

      x = newX; y = newY; z = newZ;                        // update head position to new location
      if (coords[2] !== undefined) lifted = false;         // if Z explicitly provided, lower head (ending travel)
    }
  }

  return points; // return the constructed toolpath
}
