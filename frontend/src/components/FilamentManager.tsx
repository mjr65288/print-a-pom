'use client';
import { useState } from 'react';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { Steps } from 'primereact/steps';
import { Message } from 'primereact/message';
import { motion, AnimatePresence } from 'framer-motion';
import printerApi from '@/lib/api';

interface Props {
  disabled: boolean;
  currentNozzleTemp: number;
}

const LOAD_STEPS = [
  { label: 'Heat Nozzle' },
  { label: 'Feed Filament' },
  { label: 'Prime' },
  { label: 'Done' },
];

const UNLOAD_STEPS = [
  { label: 'Heat Nozzle' },
  { label: 'Retract' },
  { label: 'Pull Out' },
  { label: 'Done' },
];

/**
 * Load/unload wizard: heats the nozzle, then calls `/filament` so the backend
 * can run its scripted P-Code sequence in batches.
 */
export default function FilamentManager({ disabled, currentNozzleTemp }: Props) {
  const [action, setAction] = useState<'load' | 'unload' | null>(null);
  const [step, setStep] = useState(0);
  const [nozzleTemp, setNozzleTemp] = useState(210);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const isHotEnough = currentNozzleTemp >= 180;

  const startOperation = async (op: 'load' | 'unload') => {
    setAction(op);
    setStep(0);
    setLoading(true);
    setError(null);
    setDone(false);

    try {
      setStep(1); // heating
      await printerApi.setTemperature(nozzleTemp, undefined);

      setStep(2); // waiting / extruding/retracting
      await printerApi.filament(op, nozzleTemp);

      setStep(3); // done
      setDone(true);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setAction(null);
    setStep(0);
    setDone(false);
    setError(null);
  };

  const stepItems = action === 'load' ? LOAD_STEPS : UNLOAD_STEPS;

  return (
    <div className="space-y-4">
      {disabled && (
        <Message
          severity="warn"
          text="Filament operations locked during printing"
          className="w-full text-xs"
        />
      )}

      {!isHotEnough && !disabled && (
        <Message
          severity="info"
          text={`Nozzle is cold (${currentNozzleTemp}°C). It will be heated before filament operations.`}
          className="w-full text-xs"
        />
      )}

      <div>
        <p className="text-pom-muted text-xs uppercase tracking-widest mb-2">Nozzle Temp for Operation</p>
        <div className="flex items-center gap-2">
          <InputNumber
            value={nozzleTemp}
            onValueChange={e => setNozzleTemp(e.value ?? 210)}
            min={170} max={280} step={5}
            disabled={disabled || loading}
            suffix="°C"
            className="w-28"
          />
          <span className="text-pom-muted text-xs">(min 170°C for most filaments)</span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!action ? (
          <motion.div
            key="buttons"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex gap-3"
          >
            <Button
              label="Load Filament"
              icon="pi pi-arrow-down"
              disabled={disabled || loading}
              onClick={() => startOperation('load')}
              className="flex-1 bg-pom-accent border-pom-accent"
            />
            <Button
              label="Unload Filament"
              icon="pi pi-arrow-up"
              disabled={disabled || loading}
              onClick={() => startOperation('unload')}
              outlined
              className="flex-1 border-pom-border text-pom-text"
            />
          </motion.div>
        ) : (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono uppercase tracking-widest ${action === 'load' ? 'text-pom-success' : 'text-pom-warning'}`}>
                {action === 'load' ? '↓ Loading Filament' : '↑ Unloading Filament'}
              </span>
            </div>

            <Steps
              model={stepItems}
              activeIndex={step}
              className="text-xs"
            />

            <div className="bg-pom-bg border border-pom-border rounded p-3 text-xs font-mono text-pom-muted space-y-1">
              {action === 'load' ? (
                <>
                  <p className={step >= 1 ? 'text-pom-accent' : ''}>1. Setting nozzle to {nozzleTemp}°C...</p>
                  <p className={step >= 2 ? 'text-pom-accent' : ''}>2. Waiting for temp and extruding filament...</p>
                  <p className={step >= 3 ? 'text-pom-success' : ''}>3. Filament loaded ✓</p>
                </>
              ) : (
                <>
                  <p className={step >= 1 ? 'text-pom-accent' : ''}>1. Setting nozzle to {nozzleTemp}°C...</p>
                  <p className={step >= 2 ? 'text-pom-accent' : ''}>2. Waiting for temp and retracting filament...</p>
                  <p className={step >= 3 ? 'text-pom-success' : ''}>3. Filament unloaded – pull it out now ✓</p>
                </>
              )}
            </div>

            {error && (
              <Message severity="error" text={error} className="w-full text-xs" />
            )}

            {done && (
              <div className="space-y-2">
                <Message severity="success" text={`${action === 'load' ? 'Load' : 'Unload'} complete!`} className="w-full" />
                <Button label="Done" icon="pi pi-check" onClick={reset} size="small" severity="success" />
              </div>
            )}

            {loading && (
              <div className="flex items-center gap-2 text-pom-muted text-xs">
                <i className="pi pi-spin pi-spinner" />
                <span>Operation in progress... (this may take a few minutes)</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
