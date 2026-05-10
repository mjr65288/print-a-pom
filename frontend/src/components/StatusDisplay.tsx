'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Tag } from 'primereact/tag';
import { Tooltip } from 'primereact/tooltip';
import { PrinterStatus, parseFaults } from '@/types/printer';

interface Props {
  status: PrinterStatus | null;
  loading: boolean;
}

/** Simple horizontal bar; `max` is the scale for the gauge (not necessarily the target temp). */
function GaugeBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="w-full h-1.5 bg-pom-border rounded-full overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
    </div>
  );
}

/** Nozzle/bed card: `target` here is only for the “ready” hint in the UI, not from the machine. */
function TempCard({ label, value, target, icon }: { label: string; value: number; target: number; icon: string }) {
  const isHot = value > 50;
  const isAtTemp = Math.abs(value - target) < 5 && target > 0;
  return (
    <div className="bg-pom-bg border border-pom-border rounded-lg p-3 flex-1 min-w-[120px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-pom-muted text-xs uppercase tracking-widest">{label}</span>
        <i className={`${icon} text-xs ${isHot ? 'text-pom-accent' : 'text-pom-muted'}`} />
      </div>
      <div className="flex items-end gap-1 mb-2">
        <motion.span
          key={value}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-2xl font-display font-bold ${isHot ? 'text-pom-accent' : 'text-pom-text'}`}
        >
          {value}
        </motion.span>
        <span className="text-pom-muted text-sm mb-0.5">°C</span>
        {isAtTemp && (
          <span className="ml-1 text-pom-success text-xs mb-0.5">✓ ready</span>
        )}
      </div>
      <GaugeBar value={value} max={300} color={isHot ? '#f97316' : '#6b7280'} />
    </div>
  );
}

/** Renders the live `/status` payload: model, temps, position, filament, fault chips. */
export default function StatusDisplay({ status, loading }: Props) {
  if (!status) {
    return (
      <div className="flex items-center justify-center h-32 text-pom-muted font-mono text-sm">
        {loading ? (
          <span className="flex items-center gap-2">
            <i className="pi pi-spin pi-spinner" /> Connecting…
          </span>
        ) : (
          <span>No printer connected</span>
        )}
      </div>
    );
  }

  const { sensors, faults, status: info } = status;
  //  parseFaults converts the bitmask into a list of active faults
  const activeFaults = parseFaults(faults);
  const pos = sensors.position; // nozzle position X,Y,Z in mm from your HEEL command

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-4"
      >
        {/* Printer model + version */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-pom-accent text-sm tracking-widest uppercase">
              {info.model}
            </h3>
            <p className="text-pom-muted text-xs font-mono">
              fw v{info.version} · up {info.time_since_boot.toFixed(1)}h · total {info.total_time}h
            </p>
          </div>
          <div className="flex items-center gap-2">
            {sensors.parked && (
              <Tag value="PARKED" severity="info" className="text-xs font-mono" />
            )}
            {sensors.filament ? (
              <Tag value="FILAMENT OK" severity="success" className="text-xs font-mono" />
            ) : (
              <Tag value="NO FILAMENT" severity="danger" className="text-xs font-mono" />
            )}
          </div>
        </div>

        {/* Temperatures */}
        <div className="flex gap-3">
          <TempCard label="Nozzle" value={sensors.nozzle} target={210} icon="pi pi-fire" />
          <TempCard label="Bed" value={sensors.bed} target={50} icon="pi pi-table" />
        </div>

        {/* Nozzle Position */}
        <div className="bg-pom-bg border border-pom-border rounded-lg p-3">
          <p className="text-pom-muted text-xs uppercase tracking-widest mb-2">Nozzle Position</p>
          <div className="grid grid-cols-3 gap-2">
            {['X', 'Y', 'Z'].map((axis, i) => (
              <div key={axis} className="text-center">
                <div className={`text-xs font-mono mb-0.5 ${
                  axis === 'X' ? 'text-red-400' : axis === 'Y' ? 'text-green-400' : 'text-blue-400'
                }`}>{axis}</div>
                <motion.div
                  key={pos[i]}
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="text-lg font-display font-bold text-pom-text"
                >
                  {pos[i].toFixed(1)}
                </motion.div>
                <div className="text-pom-muted text-xs">mm</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-pom-muted font-mono">
            Build volume: {info.dimensions[0]}×{info.dimensions[1]}×{info.dimensions[2]} mm
          </div>
        </div>

        {/* Faults */}
        {activeFaults.length > 0 ? (
          <div className="bg-red-950/40 border border-pom-danger/40 rounded-lg p-3">
            <p className="text-pom-danger text-xs uppercase tracking-widest mb-2 font-mono">
              ⚠ Active Faults
            </p>
            <div className="flex flex-wrap gap-1.5">
              {activeFaults.map(f => (
                <Tooltip key={f.code} target={`.fault-${f.code}`} content={f.description} />
              ))}
              {activeFaults.map(f => (
                <span
                  key={f.code}
                  className={`fault-${f.code} inline-block bg-red-900/60 border border-pom-danger/50 text-pom-danger text-xs font-mono px-2 py-0.5 rounded cursor-help`}
                >
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-pom-success text-xs font-mono">
            <i className="pi pi-check-circle" />
            All systems nominal · fault code 0x00
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
