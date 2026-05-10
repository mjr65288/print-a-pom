'use client';
import { useState } from 'react';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { motion } from 'framer-motion';
import printerApi from '@/lib/api';

interface Props {
  connected: boolean;
  printerIp: string | null;
  onConnected: (ip: string) => void;
  onDisconnected: () => void;
}

export default function ConnectionPanel({ connected, printerIp, onConnected, onDisconnected }: Props) {
  const [ip, setIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      await printerApi.connect(ip);
      onConnected(ip);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await printerApi.disconnect();
      onDisconnected();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Disconnect failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-4 flex-wrap"
    >
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <motion.div
          animate={connected ? { scale: [1, 1.3, 1] } : {}}
          transition={{ repeat: Infinity, duration: 2 }}
          className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-pom-success shadow-[0_0_8px_#22c55e]' : 'bg-pom-muted'}`}
        />
        <Tag
          value={connected ? `ONLINE · ${printerIp}` : 'OFFLINE'}
          severity={connected ? 'success' : 'danger'}
          className="text-xs font-mono tracking-widest"
        />
      </div>

      {!connected ? (
        <div className="flex items-center gap-2">
          <InputText
            value={ip}
            onChange={e => setIp(e.target.value)}
            placeholder="Enter printer IP address"
            className="w-48 font-mono text-sm"
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
          />
          <Button
            label="Connect"
            icon="pi pi-link"
            loading={loading}
            onClick={handleConnect}
            size="small"
            className="bg-pom-accent border-pom-accent hover:bg-orange-600"
          />
        </div>
      ) : (
        <Button
          label="Disconnect"
          icon="pi pi-times-circle"
          loading={loading}
          onClick={handleDisconnect}
          size="small"
          severity="danger"
          outlined
        />
      )}

      {error && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-pom-danger text-xs font-mono"
        >
          ⚠ {error}
        </motion.span>
      )}
    </motion.div>
  );
}
