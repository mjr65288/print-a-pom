'use client';
import { useState, useCallback } from 'react';
import { Button } from 'primereact/button';
import { ProgressBar } from 'primereact/progressbar';
import { Tag } from 'primereact/tag';
import { Message } from 'primereact/message';
import { motion, AnimatePresence } from 'framer-motion';
import printerApi from '@/lib/api';
import { PrintProgress } from '@/types/printer';

interface Props {
  connected: boolean;
  progress: PrintProgress | null;
  onFileSelected: (file: File, content: string) => void;
  onPrintStarted: () => void;
}

/** File picker + start/cancel print; reads file text for the visualizer via `onFileSelected`. */
export default function PrintPanel({ connected, progress, onFileSelected, onPrintStarted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Handles the file selected/uploaded by the user.
  const handleFile = async (f: File) => {
    setFile(f);           // Store the selected file in local state
    setError(null);       // Clear any previous error
    const text = await f.text(); // Read the file contents as text (async)
    onFileSelected(f, text);     // Pass the file and its text content for further processing/updating UI
  };

  // Handles a file drop event from the user.
  // This uses useCallback to avoid unnecessary re-renders.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();         // Prevent the browser's default file drop behavior.
    setDragging(false);         // Reset dragging highlight state.
    const f = e.dataTransfer.files[0]; // Get the first file from the dragged files.
    if (f) handleFile(f);       // If a file exists, process it.
  }, []);

  const handlePrint = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      await printerApi.printFile(file);
      onPrintStarted();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Print failed to start');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    try {
      await printerApi.cancelPrint();
    } catch (e) {}
  };

  const isPrinting = progress?.printing ?? false;
  const pct = progress?.percent ?? 0;

  return (
    <div className="space-y-4">
      {/* File Drop Zone */}
      {!isPrinting && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${
            dragging
              ? 'border-pom-accent bg-pom-accent/10'
              : file
              ? 'border-pom-success bg-pom-success/5'
              : 'border-pom-border hover:border-pom-accent/50'
          }`}
          onClick={() => document.getElementById('pcode-upload')?.click()}
        >
          <input
            id="pcode-upload"
            type="file"
            accept=".pcode,.gcode,.txt,.nc"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <AnimatePresence mode="wait">
            {file ? (
              <motion.div
                key="file"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-1"
              >
                <i className="pi pi-file text-2xl text-pom-success" />
                <p className="text-pom-success font-mono text-sm">{file.name}</p>
                <p className="text-pom-muted text-xs">{(file.size / 1024).toFixed(1)} KB</p>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-2"
              >
                <i className="pi pi-upload text-2xl text-pom-muted" />
                <p className="text-pom-muted text-sm">Drop P-Code file here or click to browse</p>
                <p className="text-pom-muted text-xs">.pcode · .gcode · .txt · .nc</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Print controls */}
      {!isPrinting ? (
        <div className="flex gap-2">
          <Button
            label="Start Print"
            icon="pi pi-play"
            disabled={!file || !connected || loading}
            loading={loading}
            onClick={handlePrint}
            className="flex-1 bg-pom-accent border-pom-accent"
          />
          {file && (
            <Button
              icon="pi pi-times"
              tooltip="Clear file"
              onClick={() => { setFile(null); setError(null); }}
              outlined
              severity="secondary"
              size="small"
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="w-2 h-2 rounded-full bg-pom-accent"
              />
              <span className="text-pom-accent font-mono text-sm font-bold">PRINTING</span>
            </div>
            <Tag
              value={`${progress?.progress ?? 0} / ${progress?.total ?? 0} lines`}
              severity="info"
              className="text-xs font-mono"
            />
          </div>

          <ProgressBar
            value={pct}
            className="h-3"
            style={{ background: '#1e2330' }}
          />

          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-pom-muted">{pct.toFixed(1)}% complete</span>
            {file && <span className="text-pom-muted truncate max-w-32">{file.name}</span>}
          </div>

          <Button
            label="Cancel Print"
            icon="pi pi-stop"
            severity="danger"
            outlined
            size="small"
            onClick={handleCancel}
            className="w-full"
          />
        </div>
      )}

      {progress?.cancelled && (
        <Message severity="warn" text="Print cancelled by user" className="w-full text-xs" />
      )}

      {error && (
        <Message severity="error" text={error} className="w-full text-xs" />
      )}

      {!connected && (
        <Message severity="warn" text="Connect to a printer to enable printing" className="w-full text-xs" />
      )}
    </div>
  );
}
