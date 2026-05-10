import axios from 'axios';

/**
 * Axios instance aimed at the Next.js rewrite to FastAPI (`/api/*` → backend).
 * Keeps components free of hardcoded hostnames during local dev.
 */
const api = axios.create({ baseURL: '/api' });

/**
 * Thin wrappers around the Print-A-Pom backend. All paths match `backend/main.py`.
 * Errors bubble as Axios errors with `response.data.detail` when the API returns one.
 */
export const printerApi = {
  connect: (ip: string) => api.post('/connect', { ip }),
  disconnect: () => api.post('/disconnect'),
  getStatus: () => api.get('/status'),
  /** Last `amount` lines from the printer log (default matches a sensible UI chunk). */
  getLog: (amount = 20) => api.get(`/log?amount=${amount}`),

  /** Raw P-Code line(s); blocked by backend while a print job is running. */
  sendCommand: (command: string) => api.post('/command', { command }),
  /** Relative jog: backend reads current position from status then sends HEEL. */
  move: (axis: string, distance: number) => api.post('/move', { axis, distance }),
  extrude: (amount: number) => api.post('/extrude', { amount }),
  setTemperature: (nozzle?: number, bed?: number) =>
    api.post('/temperature', { nozzle, bed }),
  home: () => api.post('/home'),
  clearFaults: () => api.post('/clear-faults'),

  filament: (action: 'load' | 'unload', nozzle_temp = 210) =>
    api.post('/filament', { action, nozzle_temp }),

  printFile: (file: File) => {
    // Create a FormData object to submit the file as multipart/form-data
    const fd = new FormData();
    // Append the file under the field name 'file' (must match backend expectation)
    fd.append('file', file);
    // Send the POST request to /print with the FormData payload and correct headers
    return api.post('/print', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getPrintProgress: () => api.get('/print/progress'),
  cancelPrint: () => api.post('/print/cancel'),
};

export default printerApi;
