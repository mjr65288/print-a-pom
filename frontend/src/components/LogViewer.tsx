'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { motion, AnimatePresence } from 'framer-motion';
import printerApi from '@/lib/api';

interface Props {
  connected: boolean;
  /** When true (e.g. while printing), poll the log on a slow interval so the tail stays fresh. */
  autoRefresh?: boolean;
}

interface LogLine {
  id: number;
  text: string;
  ts: number;
}

export default function LogViewer({ connected, autoRefresh = false }: Props) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  const fetchLogs = async () => {
    if (!connected) return; // Don't hit the API if printer isn't connected
    try {
      setLoading(true);
      const resp = await printerApi.getLog(20); // GET /log?amount=20
      const lines: string[] = Array.isArray(resp.data) ? resp.data : resp.data?.lines || [];
      const newEntries = lines.map(l => ({ id: idRef.current++, text: l, ts: Date.now() }));
      // FYI - logs state never exceeds 100 + newEntries.length. After the next poll, it gets trimmed again.
      setLogs(prev => [...prev.slice(-100), ...newEntries]); // Keep last 100 log entries
    } catch {
      /* keep old lines if the fetch fails */
    } finally {
      setLoading(false);
    }
  };

  /** SPEAK asks the firmware to emit a status line — handy to force something into the log. */
  const addSpeak = async () => {
    if (!connected) return;
    try {
      await printerApi.sendCommand('SPEAK');
      setTimeout(fetchLogs, 500);
    } catch (e) {
      console.error('SPEAK failed:', e);
    }
  };

  // Scroll to bottom on new logs
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Auto-refresh during printing
  useEffect(() => {
    if (!autoRefresh || !connected) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, connected]);

  const getLineColor = (text: string) => {
    if (text.includes('fault') || text.includes('FAULT') || text.includes('ERROR')) return 'text-pom-danger';
    if (text.includes('SPEAK') || text.includes('status')) return 'text-pom-info';
    if (text.includes('temperature') || text.includes('nozzle') || text.includes('SIT')) return 'text-pom-accent';
    if (text.includes('OK') || text.includes('ready') || text.includes('done')) return 'text-pom-success';
    return 'text-pom-muted';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          label="Fetch Log"
          icon="pi pi-refresh"
          size="small"
          outlined
          disabled={!connected || loading}
          onClick={fetchLogs}
          loading={loading}
          className="text-xs border-pom-border text-pom-text"
        />
        <Button
          label="SPEAK"
          icon="pi pi-microphone"
          size="small"
          outlined
          disabled={!connected}
          onClick={addSpeak}
          className="text-xs border-pom-border text-pom-muted"
        />
        <Button
          label="Clear"
          icon="pi pi-trash"
          size="small"
          outlined
          severity="secondary"
          onClick={() => setLogs([])}
          className="text-xs ml-auto"
        />
      </div>

      <div className="bg-black/60 border border-pom-border rounded-lg h-48 overflow-y-auto font-mono text-xs p-3 space-y-0.5">
        {logs.length === 0 ? (
          <p className="text-pom-border italic">No log entries. Click &quot;Fetch Log&quot; to retrieve machine output.</p>
        ) : (
          <AnimatePresence>
            {logs.map(log => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                className={`leading-relaxed ${getLineColor(log.text)}`}
              >
                <span className="text-pom-border mr-2 select-none">›</span>
                {log.text}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
