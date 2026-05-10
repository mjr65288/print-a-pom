'use client';
import { useState } from 'react';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { Slider } from 'primereact/slider';
import { Divider } from 'primereact/divider';
import { motion } from 'framer-motion';
import printerApi from '@/lib/api';

interface Props {
  /** When true (e.g. during print), all actions are blocked — matches backend 409 rules. */
  disabled: boolean;
  /** Optional refresh after a successful command (parent usually re-fetches status). */
  onCommand?: () => void;
}

function JogButton({ icon, label, onClick, disabled }: {
  icon: string; label: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <Button
      icon={`pi pi-${icon}`}
      tooltip={label}
      tooltipOptions={{ position: 'top' }}
      onClick={onClick}
      disabled={disabled}
      size="small"
      outlined
      className="w-10 h-10 border-pom-border text-pom-text hover:border-pom-accent hover:text-pom-accent"
    />
  );
}

/**
 * Jogs, home, PAW lift, extrude/retract, and temperature sliders. Maps to P-Code
 * (HEEL, PLACE, FETCH, SIT, DOWN, etc.) via the backend, not raw TCP.
 */
export default function ManualControl({ disabled, onCommand }: Props) {
  const [step, setStep] = useState<number>(10);
  const [extrudeAmt, setExtrudeAmt] = useState<number>(5);
  const [nozzleTemp, setNozzleTemp] = useState<number>(210);
  const [bedTemp, setBedTemp] = useState<number>(60);
  const [loading, setLoading] = useState(false);
  const [lastCmd, setLastCmd] = useState<string | null>(null);

  /** Runs an API call, shows a short “last command” hint, then lets parent pull fresh status. */
  /**
   * Executes an asynchronous operation, sets loading and last command state for UI feedback,
   * and optionally triggers a parent refresh callback after completion.
   *
   * @param {() => Promise<unknown>} fn - The asynchronous function to execute.
   * @param {string} label - A short description of the command, displayed as a hint in the UI.
   */
  const run = async (fn: () => Promise<unknown>, label: string) => {
    setLoading(true);
    setLastCmd(label);
    try {
      await fn();
      onCommand?.(); // call the parent's onCommand callback to refresh the status if it exists
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  
  /**
   * Moves the printer head along a given axis by the currently selected step size and direction.
   * Calls the printer API to perform the move and sets last command for UI feedback.
   *
   * @param {string} axis - The axis to move ('x', 'y', or 'z').
   * @param {1 | -1} dir - Direction of movement (1 for positive, -1 for negative).
   */
  const move = (axis: string, dir: 1 | -1) =>
    run(() => printerApi.move(axis, step * dir), `${axis.toUpperCase()}${dir > 0 ? '+' : '-'}${step}mm`);

  const steps = [0.1, 1, 5, 10, 25, 50];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: disabled ? 0.4 : 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      {disabled && (
        <div className="flex items-center gap-2 text-pom-warning text-xs font-mono bg-yellow-950/40 border border-pom-warning/30 rounded p-2">
          <i className="pi pi-lock" />
          Manual control locked during print
        </div>
      )}

      {/* Step size selector */}
      <div>
        <p className="text-pom-muted text-xs uppercase tracking-widest mb-2">Step Size</p>
        <div className="flex gap-1.5 flex-wrap">
          {steps.map(s => (
            <button
              key={s}
              onClick={() => setStep(s)}
              disabled={disabled}
              className={`px-2.5 py-1 text-xs font-mono rounded border transition-all ${
                step === s
                  ? 'bg-pom-accent border-pom-accent text-white'
                  : 'bg-transparent border-pom-border text-pom-muted hover:border-pom-accent hover:text-pom-accent'
              }`}
            >
              {s}mm
            </button>
          ))}
        </div>
      </div>

      {/* XY Jog */}
      <div>
        <p className="text-pom-muted text-xs uppercase tracking-widest mb-2">XY Movement</p>
        <div className="grid grid-cols-3 gap-1 w-fit mx-auto">
          <div />
          <JogButton icon="arrow-up" label={`Y+ ${step}mm`} onClick={() => move('y', 1)} disabled={disabled || loading} />
          <div />
          <JogButton icon="arrow-left" label={`X- ${step}mm`} onClick={() => move('x', -1)} disabled={disabled || loading} />
          <button
            onClick={() => run(() => printerApi.home(), 'HOME')}
            disabled={disabled || loading}
            className="w-10 h-10 rounded border border-pom-border text-pom-muted text-xs hover:border-pom-accent hover:text-pom-accent transition-all"
          >
            ⌂
          </button>
          <JogButton icon="arrow-right" label={`X+ ${step}mm`} onClick={() => move('x', 1)} disabled={disabled || loading} />
          <div />
          <JogButton icon="arrow-down" label={`Y- ${step}mm`} onClick={() => move('y', -1)} disabled={disabled || loading} />
          <div />
        </div>
      </div>

      {/* Z Jog */}
      <div>
        <p className="text-pom-muted text-xs uppercase tracking-widest mb-2">Z Movement</p>
        <div className="flex gap-2">
          <JogButton icon="sort-amount-up" label={`Z+ ${step}mm`} onClick={() => move('z', 1)} disabled={disabled || loading} />
          <JogButton icon="sort-amount-down" label={`Z- ${step}mm`} onClick={() => move('z', -1)} disabled={disabled || loading} />
          <Button
            label="Lift (PAW)"
            icon="pi pi-arrow-up"
            size="small"
            outlined
            disabled={disabled || loading}
            onClick={() => run(() => printerApi.sendCommand('PAW'), 'PAW')}
            className="text-xs border-pom-border text-pom-text"
          />
        </div>
      </div>

      <Divider className="border-pom-border my-2" />

      {/* Extrude */}
      <div>
        <p className="text-pom-muted text-xs uppercase tracking-widest mb-2">Extrusion</p>
        <div className="flex items-center gap-2">
          <InputNumber
            value={extrudeAmt}
            onValueChange={e => setExtrudeAmt(e.value ?? 5)}
            min={0.1} max={200} step={1}
            disabled={disabled}
            size={4}
            className="w-20"
            suffix=" mm"
          />
          <Button
            label="Extrude"
            icon="pi pi-arrow-down"
            size="small"
            disabled={disabled || loading}
            onClick={() => run(() => printerApi.extrude(extrudeAmt), `FETCH ${extrudeAmt}`)}
            className="bg-pom-accent border-pom-accent text-xs"
          />
          <Button
            label="Retract"
            icon="pi pi-arrow-up"
            size="small"
            outlined
            disabled={disabled || loading}
            onClick={() => run(() => printerApi.extrude(-extrudeAmt), `FETCH -${extrudeAmt}`)}
            className="border-pom-border text-pom-text text-xs"
          />
        </div>
      </div>

      <Divider className="border-pom-border my-2" />

      {/* Temperatures */}
      <div>
        <p className="text-pom-muted text-xs uppercase tracking-widest mb-3">Temperatures</p>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-pom-text text-xs">Nozzle: <span className="text-pom-accent font-mono">{nozzleTemp}°C</span></label>
            </div>
            <Slider
              value={nozzleTemp}
              onChange={e => setNozzleTemp(e.value as number)}
              min={0} max={280} step={5}
              disabled={disabled}
              className="w-full"
            />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-pom-text text-xs">Bed: <span className="text-blue-400 font-mono">{bedTemp}°C</span></label>
            </div>
            <Slider
              value={bedTemp}
              onChange={e => setBedTemp(e.value as number)}
              min={0} max={120} step={5}
              disabled={disabled}
              className="w-full"
            />
          </div>
          <Button
            label="Set Temperatures"
            icon="pi pi-fire"
            size="small"
            disabled={disabled || loading}
            onClick={() => run(() => printerApi.setTemperature(nozzleTemp, bedTemp), `SIT ${nozzleTemp} / DOWN ${bedTemp}`)}
            className="w-full bg-pom-accent border-pom-accent text-xs"
          />
        </div>
      </div>

      {lastCmd && (
        <p className="text-pom-muted text-xs font-mono">
          Last: <span className="text-pom-accent">{lastCmd}</span>
        </p>
      )}
    </motion.div>
  );
}
