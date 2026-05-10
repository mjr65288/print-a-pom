'use client';

/**
 * Main dashboard: connection, live status, manual/filament tabs, print upload,
 * P-Code preview, and log. Polls status and print progress every 2s while connected.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { TabView, TabPanel } from 'primereact/tabview';
import { Button } from 'primereact/button';
import { motion } from 'framer-motion';
import ConnectionPanel from '@/components/ConnectionPanel';
import StatusDisplay from '@/components/StatusDisplay';
import ManualControl from '@/components/ManualControl';
import FilamentManager from '@/components/FilamentManager';
import PrintPanel from '@/components/PrintPanel';
import PCodeVisualizer from '@/components/PCodeVisualizer';
import LogViewer from '@/components/LogViewer';
import printerApi from '@/lib/api';
import { PrinterStatus, PrintProgress } from '@/types/printer';

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [printerIp, setPrinterIp] = useState<string | null>(null);
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [progress, setProgress] = useState<PrintProgress | null>(null);
  const [pcodeContent, setPcodeContent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!connected) return;
    try {
      setStatusLoading(true);
      const resp = await printerApi.getStatus();
      setStatus(resp.data);
    } catch (e) {
      console.error('Status fetch failed:', e);
    } finally {
      setStatusLoading(false);
    }
  }, [connected]);

  const fetchProgress = useCallback(async () => {
    if (!connected) return;
    try {
      const resp = await printerApi.getPrintProgress();
      setProgress(resp.data);
    } catch (e) {
      console.error('Progress fetch failed:', e);
      setProgress(null);
    }
  }, [connected]);

  // Start polling when connected
  useEffect(() => {
    if (connected) {
      fetchStatus();
      fetchProgress();
      pollRef.current = setInterval(() => {
        fetchStatus();
        fetchProgress();
      }, 2000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
      setStatus(null);
      setProgress(null);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [connected, fetchStatus, fetchProgress]);

  const handleConnected = (ip: string) => {
    setPrinterIp(ip);
    setConnected(true);
  };

  const handleDisconnected = () => {
    setPrinterIp(null);
    setConnected(false);
  };

  const isPrinting = progress?.printing ?? false;

  return (
    <div className="min-h-screen bg-pom-bg text-pom-text">
      {/* Header */}
      <header className="border-b border-pom-border bg-pom-surface/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-3 min-w-fit">
            <div>
              <h1 className="font-display text-pom-accent text-sm font-bold tracking-widest">PRINT-A-POM</h1>
              <p className="text-pom-muted text-xs font-mono tracking-widest">CONTROL CENTER</p>
            </div>
          </div>

          <div className="h-6 w-px bg-pom-border" />

          {/* Connection */}
          <ConnectionPanel
            connected={connected}
            printerIp={printerIp}
            onConnected={handleConnected}
            onDisconnected={handleDisconnected}
          />

          {/* Print status in header */}
          {isPrinting && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="ml-auto flex items-center gap-3"
            >
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="w-2 h-2 rounded-full bg-pom-accent"
                />
                <span className="text-pom-accent text-xs font-display font-bold tracking-widest">
                  PRINTING {progress?.percent.toFixed(0)}%
                </span>
              </div>
            </motion.div>
          )}

          {/* Fault indicator */}
          {status && status.faults !== 0 && (
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
              className="ml-auto flex items-center gap-2 text-pom-danger text-xs font-mono"
            >
              <i className="pi pi-exclamation-triangle" />
              FAULT 0x{status.faults.toString(16).toUpperCase().padStart(2, '0')}
              <Button
                label="CLEAR"
                size="small"
                severity="danger"
                outlined
                className="text-xs px-2 py-0.5"
                onClick={async () => {
                  await printerApi.clearFaults();
                  fetchStatus();
                }}
              />
            </motion.div>
          )}
        </div>
      </header>

      {/* Main layout */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-5">

          {/* LEFT COLUMN: Status + Controls */}
          <div className="col-span-12 lg:col-span-4 xl:col-span-3 space-y-5">

            {/* Status Panel */}
            <div className="panel-card">
              <div className="section-title">
                <i className="pi pi-chart-bar text-pom-accent" />
                Machine Status
              </div>
              <StatusDisplay status={status} loading={statusLoading} />
              {connected && (
                <button
                  onClick={fetchStatus}
                  className="mt-3 text-xs text-pom-muted hover:text-pom-accent font-mono flex items-center gap-1 transition-colors"
                >
                  <i className="pi pi-refresh text-[10px]" /> Refresh
                </button>
              )}
            </div>

            {/* Controls Tabs */}
            <div className="panel-card">
              <TabView
                activeIndex={activeTab}
                onTabChange={e => setActiveTab(e.index)}
                className="p-0"
                pt={{
                  panelContainer: { className: 'p-0 pt-4 bg-transparent' },
                  nav: { className: 'border-b border-pom-border bg-transparent' },
                  inkbar: { className: 'bg-pom-accent' },
                }}
              >
                <TabPanel
                  header="Manual"
                  leftIcon="pi pi-sliders-h mr-1"
                  pt={{ headerAction: { className: 'text-xs font-body' } }}
                >
                  <ManualControl disabled={!connected || isPrinting} onCommand={fetchStatus} />
                </TabPanel>

                <TabPanel
                  header="Filament"
                  leftIcon="pi pi-inbox mr-1"
                  pt={{ headerAction: { className: 'text-xs font-body' } }}
                >
                  <FilamentManager
                    disabled={!connected || isPrinting}
                    currentNozzleTemp={status?.sensors.nozzle ?? 0}
                  />
                </TabPanel>
              </TabView>
            </div>
          </div>

          {/* RIGHT COLUMN: Print + Visualizer + Log */}
          <div className="col-span-12 lg:col-span-8 xl:col-span-9 space-y-5">

            {/* Print Panel */}
            <div className="panel-card">
              <div className="section-title">
                <i className="pi pi-play text-pom-accent" />
                Print Control
              </div>
              <PrintPanel
                connected={connected}
                progress={progress}
                onFileSelected={(file, content) => setPcodeContent(content)}
                onPrintStarted={fetchStatus}
              />
            </div>

            {/* P-Code Visualizer */}
            <div className="panel-card">
              <div className="section-title">
                <i className="pi pi-map text-pom-accent" />
                P-Code Visualizer
              </div>
              <PCodeVisualizer
                content={pcodeContent}
                currentProgress={progress?.progress}
                totalLines={progress?.total}
              />
            </div>

            {/* Log Viewer */}
            <div className="panel-card">
              <div className="section-title">
                <i className="pi pi-terminal text-pom-accent" />
                Machine Log
              </div>
              <LogViewer connected={connected} autoRefresh={isPrinting} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-pom-border mt-8 py-4 px-6 text-center">
        <p className="text-xs font-mono">
          MACHINA LABS · Print-A-Pom Control Center · MaxPro Series · P-Code v1.0
        </p>
      </footer>
    </div>
  );
}
