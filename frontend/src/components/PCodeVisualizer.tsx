'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { Button } from 'primereact/button';
import { Slider } from 'primereact/slider';
import { SelectButton } from 'primereact/selectbutton';
import { motion } from 'framer-motion';
import { parsePCode, buildVisualizerPath, VisualizerPoint } from '@/types/printer';

interface Props {
  /** Raw P-Code text from the selected file (same string the backend would print). */
  content: string | null;
  /** Lines already executed — when set with `totalLines`, scrubs the path to match the job. */
  currentProgress?: number;
  totalLines?: number;
}

type ViewMode = '2D' | 'Layer';

/**
 * Top-down canvas of the parsed toolpath: dashed travel moves, solid extrusion, optional
 * live progress when `currentProgress` / `totalLines` match an active print job.
 * 
 * FYI - has 2 modes: live preview during printing, or manual scrubbing when idle.
 */
export default function PCodeVisualizer({ content, currentProgress, totalLines }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('2D');
  const [animProgress, setAnimProgress] = useState(100);
  const [isAnimating, setIsAnimating] = useState(false);
  const animRef = useRef<number | null>(null);
  const frameRef = useRef(0);

  const points = useMemo(() => {
    if (!content) return [];
    const lines = parsePCode(content); //  strips comments and turns text into {command, args} objects
    return buildVisualizerPath(lines); //  converts P-Code lines into {x,y,z,isTravel,hasExtrude,extrudeAmount} points
  }, [content]);

  /**
 * Maps backend line-based progress to visualizer point index.
 *
 * Backend reports progress as P-Code lines sent, e.g. 23/47.
 * Visualizer only renders HEEL moves, so `points.length` may be << `totalLines`.
 *
 * This approximates: if we're N% through the file, show N% of the visual path.
 * Assumes HEEL moves are roughly evenly distributed among other commands.
 *
 * @example
 * // 23 lines sent out of 47 total, with 12 visual points
 * // (23 / 47) * 12 = 5.87 → 6
 * // Draw points[0] through points[5]
 *
 * @returns Point count to render, or null if not in live-print mode
 */
  const printProgress = useMemo(() => {
    if (!totalLines || !currentProgress) return null;
    return Math.round((currentProgress / totalLines) * points.length);
  }, [currentProgress, totalLines, points.length]);

  /**
 * Determines how many visualizer points to draw on canvas.
 *
 * In live-print mode: uses `printProgress` mapped from backend state.
 * In preview mode: uses `animProgress` slider/animation percentage.
 *
 * @returns Index slice end for `points.slice(0, visibleCount)`
 */
  const visibleCount = useMemo(() => {
    if (printProgress !== null) return printProgress; // in live-print mode, use the mapped progress
    return Math.round((animProgress / 100) * points.length); // in preview mode, use the animation percentage
  }, [animProgress, points.length, printProgress]);

  // Derive bounds
  const bounds = useMemo(() => {
    if (!points.length) return { minX: 0, maxX: 200, minY: 0, maxY: 200 };
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return {
      minX: Math.min(...xs) - 10,
      maxX: Math.max(...xs) + 10,
      minY: Math.min(...ys) - 10,
      maxY: Math.max(...ys) + 10,
    };
  }, [points]);

  /** Paints grid, travel polylines, extrusion segments, and a highlight at the last visible point. */
  const drawCanvas = (visiblePts: VisualizerPoint[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return; // Exit if canvas isn't mounted
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // Exit if 2D context is unavailable

    const W = canvas.width;  // Canvas pixel width
    const H = canvas.height; // Canvas pixel height

    // Clear everything
    ctx.clearRect(0, 0, W, H);

    // Fill background with dark color
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(0, 0, W, H);

    // Draw grid lines (every 25mm from 0 to 300mm)
    ctx.strokeStyle = '#1e2330';
    ctx.lineWidth = 0.5;
    const gridStep = 25;
    // Vertical grid lines
    for (let gx = 0; gx <= 300; gx += gridStep) {
      const cx = toCanvasX(gx, W); // Convert world X to canvas X
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, H);
      ctx.stroke();
    }
    // Horizontal grid lines
    for (let gy = 0; gy <= 300; gy += gridStep) {
      const cy = toCanvasY(gy, H); // Convert world Y to canvas Y
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(W, cy);
      ctx.stroke();
    }

    // Draw axis labels along the bottom and left
    ctx.fillStyle = '#374151';
    ctx.font = '9px monospace';
    // X-axis labels (bottom)
    for (let gx = 0; gx <= 300; gx += gridStep) {
      ctx.fillText(`${gx}`, toCanvasX(gx, W) + 2, H - 2);
    }
    // Y-axis labels (left side)
    for (let gy = 0; gy <= 300; gy += gridStep) {
      ctx.fillText(`${gy}`, 2, toCanvasY(gy, H) - 2);
    }

    // If nothing to render, exit early
    if (!visiblePts.length) return;

    // --- TRAVEL MOVES (dashed gray polyline, no extrusion moves) ---
    ctx.setLineDash([3, 5]); // Dashed line pattern
    ctx.strokeStyle = '#2d3748'; // Light gray color
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    let inTravel = false;
    for (let i = 0; i < visiblePts.length; i++) {
      const p = visiblePts[i];
      const cx = toCanvasX(p.x, W);
      const cy = toCanvasY(p.y, H);
      if (p.isTravel) {
        // If starting travel, move to the travel start point
        if (!inTravel) { 
          ctx.moveTo(cx, cy); 
          inTravel = true; 
        }
        // If already in travel mode, draw to new position
        else ctx.lineTo(cx, cy);
      } else {
        // Not a travel segment, exit current travel path
        inTravel = false;
      }
    }
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash for subsequent drawing

    // --- EXTRUSION PATHS (colored polylines with width based on extrusion) ---
    // Iterate pairs (prev, curr) so we can connect lines
    for (let i = 1; i < visiblePts.length; i++) {
      const prev = visiblePts[i - 1];
      const curr = visiblePts[i];
      // Only draw extrusion if this point is an extrusion segment and not in travel
      if (!curr.hasExtrude || curr.isTravel) continue;

      const amt = curr.extrudeAmount ?? 0.3; // Default to 0.3 if undefined
      // Line width scales with amount, but clamps to [0.5, 3]
      const lw = Math.max(0.5, Math.min(amt * 4, 3));

      // Color gradient: starts orange, gets lighter as we progress, for visual interest
      const progress = i / visiblePts.length;
      const r = 249; // Fixed orange-red base
      const g = Math.round(115 + progress * 100); // More green with progress
      const b = Math.round(22 + progress * 80);   // More blue with progress

      ctx.beginPath();
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(toCanvasX(prev.x, W), toCanvasY(prev.y, H));
      ctx.lineTo(toCanvasX(curr.x, W), toCanvasY(curr.y, H));
      ctx.stroke();
    }

    // --- NOZZLE TIP LOCATION (highlight/glow at the tip of the last visible point) ---
    if (visiblePts.length > 0) {
      const last = visiblePts[visiblePts.length - 1];
      const cx = toCanvasX(last.x, W);
      const cy = toCanvasY(last.y, H);

      // Draw soft glow around the nozzle tip for emphasis
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8);
      gradient.addColorStop(0, 'rgba(249,115,22,0.8)');
      gradient.addColorStop(1, 'rgba(249,115,22,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();

      // Draw the nozzle tip as a white dot
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  /**
   * Converts a world X coordinate to a canvas X coordinate.
   * @param worldX - The X coordinate in the print's world-space units (e.g., mm).
   * @param W - The width of the canvas in pixels.
   * @returns The corresponding X position on the canvas, with 10px padding on each side.
   */
  function toCanvasX(worldX: number, W: number): number {
    const range = bounds.maxX - bounds.minX; // width of the drawing area in world units
    // Map worldX into [0,1] based on bounds, then scale to [10, W-10] for canvas space
    return ((worldX - bounds.minX) / range) * (W - 20) + 10; 
  }

  /**
   * Converts a world Y coordinate to a canvas Y coordinate.
   * This function maps world-space Y (e.g., millimeters) to canvas-space Y (pixels),
   * flipping the axis so world 0 (bottom) maps to canvas H (bottom), and world maxY to canvas 0 (top).
   * Includes 10px padding at the top and bottom.
   *
   * @param worldY - The Y coordinate in the print's world-space units.
   * @param H - The height of the canvas in pixels.
   * @returns The corresponding Y position on the canvas, with 10px padding.
   */
  function toCanvasY(worldY: number, H: number): number {
    const range = bounds.maxY - bounds.minY; // Compute the "height" of the drawing area in world units
    // The formula below does 3 things:
    //   1. (worldY - bounds.minY) / range   --> Normalize to [0,1] within bounds
    //   2. * (H - 20) + 10                 --> Scale/offset to [10, H-10] to add 10px padding
    //   3. H - result                      --> Flip so that higher worldY is visually lower on the canvas
    // This way, world minY is the far bottom (canvas Y near H),
    // world maxY is the far top (canvas Y near 0).
    return H - (((worldY - bounds.minY) / range) * (H - 20) + 10);
  }

  useEffect(() => {
    const visible = points.slice(0, visibleCount);
    drawCanvas(visible);
  }, [points, visibleCount, bounds]);

  const handleAnimate = () => {
    if (isAnimating) {
      cancelAnimationFrame(animRef.current!); // cancel the animation
      setIsAnimating(false);
      return;
    }
    setIsAnimating(true);
    // instead of useState because updating state 300 times would cause 300 re-renders. 
    // Refs don't trigger re-renders, so only the setAnimProgress(pct) causes a render.
    frameRef.current = 0;
    //FYI - requestAnimationFrame fires ∼60 times per second on most displays
    // so 300 frames =  5-second animation at 60fps
    const totalFrames = 300;
    const step = () => {
      frameRef.current++; // increment frame counter
      const pct = Math.min((frameRef.current / totalFrames) * 100, 100);
      setAnimProgress(pct); // triggers re-render + canvas redraw
      if (pct < 100) {
        // store the ID so you can cancel it
        animRef.current = requestAnimationFrame(step); // call myself again next frame
      } else {
        setIsAnimating(false); // done, stop looping
      }
    };
    animRef.current = requestAnimationFrame(step);
  };

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-pom-muted border border-pom-border rounded-lg bg-pom-bg">
        <i className="pi pi-image text-3xl mb-3 opacity-30" />
        <p className="text-sm">Load a P-Code file to visualize</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-3"
    >
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-pom-muted font-mono">
          <span className="w-3 h-0.5 bg-pom-accent inline-block" /> extrude
          <span className="w-3 h-0.5 bg-gray-600 border-dashed border-t inline-block ml-2" /> travel
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-pom-muted text-xs font-mono">{points.length} moves</span>
          <Button
            label={isAnimating ? 'Stop' : 'Animate'}
            icon={`pi pi-${isAnimating ? 'pause' : 'play'}`}
            size="small"
            outlined
            onClick={handleAnimate}
            className="text-xs border-pom-border text-pom-text"
            disabled={printProgress !== null}
          />
        </div>
      </div>

      {/* Canvas */}
      <div className="relative border border-pom-border rounded-lg overflow-hidden bg-pom-bg">
        <canvas
          ref={canvasRef}
          width={600}
          height={500}
          className="w-full h-auto"
          style={{ imageRendering: 'crisp-edges' }}
        />
        {printProgress !== null && (
          <div className="absolute top-2 right-2 bg-pom-bg/80 border border-pom-border rounded px-2 py-1">
            <span className="text-pom-accent text-xs font-mono">
              LIVE · {Math.round((printProgress / points.length) * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Scrubber */}
      {printProgress === null && (
        <div className="flex items-center gap-3">
          <span className="text-pom-muted text-xs font-mono w-8">{Math.round(animProgress)}%</span>
          <Slider
            value={animProgress}
            onChange={e => { setAnimProgress(e.value as number); setIsAnimating(false); }}
            min={0} max={100} step={0.5}
            className="flex-1"
          />
          <span className="text-pom-muted text-xs font-mono">
            {visibleCount}/{points.length}
          </span>
        </div>
      )}
    </motion.div>
  );
}
