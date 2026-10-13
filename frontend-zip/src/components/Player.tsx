/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Settings,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { StreamManifest } from '../lib/protocol/manifest';
import { StreamSessionState } from '../lib/protocol/sessionManager';

interface PlayerProps {
  manifest: StreamManifest;
  session: StreamSessionState;
  onPlaySegment: (segmentIndex: number) => Promise<void>;
  currentSegmentIndex: number;
  setCurrentSegmentIndex: (index: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onOpenSessionRequested: () => void;
  verifiedMedia: Uint8Array | null;
  verifiedMediaType: string;
}

export const Player: React.FC<PlayerProps> = ({
  manifest,
  session,
  onPlaySegment,
  currentSegmentIndex,
  setCurrentSegmentIndex,
  isPlaying,
  setIsPlaying,
  onOpenSessionRequested,
  verifiedMedia,
  verifiedMediaType,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [verifyingNotice, setVerifyingNotice] = useState<string | null>(null);
  const [mediaPlaybackError, setMediaPlaybackError] = useState(false);
  const mediaUrlRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!verifiedMedia) return;
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
    const mediaCopy = new Uint8Array(verifiedMedia);
    const nextUrl = URL.createObjectURL(new Blob([mediaCopy.buffer as ArrayBuffer], { type: verifiedMediaType }));
    mediaUrlRef.current = nextUrl;
    setMediaUrl(nextUrl);
    setMediaPlaybackError(false);
    return () => {
      URL.revokeObjectURL(nextUrl);
      if (mediaUrlRef.current === nextUrl) mediaUrlRef.current = null;
    };
  }, [verifiedMedia, verifiedMediaType]);

  useEffect(() => {
    if (!videoRef.current) return;
    if (isPlaying) void videoRef.current.play().catch(() => {});
    else videoRef.current.pause();
  }, [isPlaying, mediaUrl]);

  const totalDuration = manifest.totalDurationSec || 10;
  const segmentDuration = totalDuration / manifest.totalSegments;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // High-fidelity cinematic planetary sunrise and crater landscape renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let t = 0;

    const render = () => {
      t += 0.012;
      const w = canvas.width;
      const h = canvas.height;

      // 1. Deep space backdrop with subtle warm cosmic haze
      const spaceGrad = ctx.createRadialGradient(w * 0.7, h * 0.25, 0, w * 0.5, h * 0.5, w);
      spaceGrad.addColorStop(0, '#1c1006');
      spaceGrad.addColorStop(0.3, '#0b0704');
      spaceGrad.addColorStop(0.7, '#040302');
      spaceGrad.addColorStop(1, '#020101');
      ctx.fillStyle = spaceGrad;
      ctx.fillRect(0, 0, w, h);

      // 2. Starfield with atmospheric twinkle
      const starSeed = [
        [0.08, 0.12, 1.2, 0.8], [0.15, 0.28, 0.8, 0.6], [0.22, 0.09, 1.5, 0.9],
        [0.28, 0.22, 0.7, 0.5], [0.35, 0.14, 1.1, 0.7], [0.42, 0.31, 0.9, 0.6],
        [0.48, 0.08, 1.8, 0.95], [0.55, 0.19, 0.8, 0.5], [0.62, 0.11, 1.2, 0.7],
        [0.72, 0.05, 1.4, 0.8], [0.81, 0.16, 0.9, 0.6], [0.89, 0.08, 1.6, 0.9],
        [0.94, 0.24, 0.7, 0.5], [0.12, 0.42, 1.0, 0.6], [0.05, 0.35, 0.8, 0.5]
      ];
      for (const [sx, sy, size, baseAlpha] of starSeed) {
        const alpha = Math.max(0.2, Math.min(1.0, baseAlpha + 0.3 * Math.sin(t * 2 + sx * 10)));
        ctx.fillStyle = `rgba(255, 245, 230, ${alpha})`;
        ctx.fillRect(sx * w, sy * h, size, size);
      }

      // 3. Giant Planet Body (Curving from top-right towards center)
      const planetX = w * 0.74;
      const planetY = -h * 0.22;
      const planetR = w * 0.58;

      ctx.save();
      ctx.beginPath();
      ctx.arc(planetX, planetY, planetR, 0, Math.PI * 2);
      const planetDarkGrad = ctx.createRadialGradient(
        planetX - planetR * 0.2, planetY + planetR * 0.2, planetR * 0.5,
        planetX, planetY, planetR
      );
      planetDarkGrad.addColorStop(0, '#000000');
      planetDarkGrad.addColorStop(0.7, '#070402');
      planetDarkGrad.addColorStop(0.92, '#180e05');
      planetDarkGrad.addColorStop(1, '#2f1a09');
      ctx.fillStyle = planetDarkGrad;
      ctx.fill();
      ctx.restore();

      // 4. Brilliant Planetary Atmospheric Arc (Luminous Golden Rim)
      ctx.save();
      ctx.beginPath();
      ctx.arc(planetX, planetY, planetR, Math.PI * 0.32, Math.PI * 0.85);
      ctx.lineWidth = 16;
      const arcGrad = ctx.createLinearGradient(w * 0.25, h * 0.3, w * 0.8, h * 0.55);
      arcGrad.addColorStop(0, 'rgba(255, 245, 215, 0.98)');
      arcGrad.addColorStop(0.3, 'rgba(245, 175, 75, 0.92)');
      arcGrad.addColorStop(0.7, 'rgba(180, 85, 25, 0.6)');
      arcGrad.addColorStop(1, 'rgba(60, 25, 5, 0)');
      ctx.strokeStyle = arcGrad;
      ctx.shadowColor = '#f5a842';
      ctx.shadowBlur = 45;
      ctx.stroke();
      ctx.restore();

      // Secondary fine razor edge on the atmospheric rim
      ctx.save();
      ctx.beginPath();
      ctx.arc(planetX, planetY, planetR, Math.PI * 0.35, Math.PI * 0.82);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fffbf0';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 15;
      ctx.stroke();
      ctx.restore();

      // 5. Blinding Sun Bloom & Solar Flare on Horizon
      const sunX = w * 0.65;
      const sunY = h * 0.38;
      const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.45);
      sunGrad.addColorStop(0, 'rgba(255, 255, 245, 0.95)');
      sunGrad.addColorStop(0.06, 'rgba(255, 225, 140, 0.85)');
      sunGrad.addColorStop(0.2, 'rgba(235, 145, 50, 0.45)');
      sunGrad.addColorStop(0.5, 'rgba(140, 60, 15, 0.15)');
      sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, w, h);

      // Light streak beam across the terrain
      const streakGrad = ctx.createLinearGradient(sunX, sunY, w * 0.2, h * 0.8);
      streakGrad.addColorStop(0, 'rgba(255, 210, 120, 0.18)');
      streakGrad.addColorStop(0.5, 'rgba(220, 120, 30, 0.08)');
      streakGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = streakGrad;
      ctx.beginPath();
      ctx.moveTo(sunX - 40, sunY);
      ctx.lineTo(w * 0.05, h);
      ctx.lineTo(w * 0.55, h);
      ctx.closePath();
      ctx.fill();

      // 6. Jagged Distant Mountain Ridge (Crater rim silhouette)
      ctx.beginPath();
      ctx.moveTo(0, h * 0.58);
      ctx.lineTo(w * 0.12, h * 0.50);
      ctx.lineTo(w * 0.22, h * 0.54);
      ctx.lineTo(w * 0.34, h * 0.47);
      ctx.lineTo(w * 0.48, h * 0.53);
      ctx.lineTo(w * 0.60, h * 0.44);
      ctx.lineTo(w * 0.72, h * 0.49);
      ctx.lineTo(w * 0.86, h * 0.42);
      ctx.lineTo(w, h * 0.52);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const distGrad = ctx.createLinearGradient(0, h * 0.45, 0, h);
      distGrad.addColorStop(0, '#382210');
      distGrad.addColorStop(0.4, '#231409');
      distGrad.addColorStop(1, '#0e0703');
      ctx.fillStyle = distGrad;
      ctx.fill();

      // Warm rim lighting catching mountain peaks
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 195, 105, 0.5)';
      ctx.stroke();
      ctx.restore();

      // 7. Middle & Fore-Terrain (Barren crater ridges and desert floor)
      ctx.beginPath();
      ctx.moveTo(0, h * 0.69);
      ctx.lineTo(w * 0.15, h * 0.62);
      ctx.lineTo(w * 0.32, h * 0.70);
      ctx.lineTo(w * 0.46, h * 0.60);
      ctx.lineTo(w * 0.62, h * 0.66);
      ctx.lineTo(w * 0.78, h * 0.58);
      ctx.lineTo(w * 0.90, h * 0.65);
      ctx.lineTo(w, h * 0.61);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const foreGrad = ctx.createLinearGradient(0, h * 0.58, 0, h);
      foreGrad.addColorStop(0, '#2b1708');
      foreGrad.addColorStop(0.35, '#170c04');
      foreGrad.addColorStop(1, '#0a0502');
      ctx.fillStyle = foreGrad;
      ctx.fill();

      // Specular crater rims on the ground
      ctx.fillStyle = 'rgba(240, 155, 65, 0.15)';
      for (let c = 0; c < 24; c++) {
        const cx = ((c * 97 + 23) % (w * 0.95)) + w * 0.02;
        const cy = h * 0.72 + ((c * 43) % (h * 0.24));
        const rx = 8 + (c % 7) * 2;
        const ry = 3 + (c % 4);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isPlaying) {
        animId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isPlaying]);

  // Video playback ticker
  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (isPlaying) {
      timer = setInterval(() => {
        setPlaybackTime((prev: number) => {
          const next = prev + 0.25;
          if (next >= totalDuration) {
            setIsPlaying(false);
            return totalDuration;
          }

          const newSegIdx = Math.min(
            manifest.totalSegments - 1,
            Math.floor(next / segmentDuration)
          );
          if (newSegIdx !== currentSegmentIndex) {
            setCurrentSegmentIndex(newSegIdx);
            if (session.status === 'active') {
              onPlaySegment(newSegIdx);
            }
          }

          return next;
        });
      }, 250);
    }

    return () => clearInterval(timer);
  }, [
    isPlaying,
    totalDuration,
    segmentDuration,
    currentSegmentIndex,
    setCurrentSegmentIndex,
    setIsPlaying,
    session.status,
    manifest.totalSegments,
    onPlaySegment,
  ]);

  const handleTogglePlay = async () => {
    if (!isPlaying) {
      if (session.status !== 'active') {
        onOpenSessionRequested();
        return;
      }

      setVerifyingNotice(`Verifying Segment ${currentSegmentIndex}...`);
      try {
        await onPlaySegment(currentSegmentIndex);
        setVerifyingNotice(null);
        setIsPlaying(true);
      } catch {
        setVerifyingNotice(null);
      }
    } else {
      setIsPlaying(false);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = ratio * totalDuration;
    setPlaybackTime(targetTime);

    const targetSegIdx = Math.min(
      manifest.totalSegments - 1,
      Math.floor(targetTime / segmentDuration)
    );
    setCurrentSegmentIndex(targetSegIdx);

    if (session.status === 'active') {
      onPlaySegment(targetSegIdx);
    }
  };

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  const progressPercent = (playbackTime / totalDuration) * 100;

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-2xl overflow-hidden bg-[#0a0805] border border-[#271e16] shadow-[0_12px_45px_rgba(0,0,0,0.9)] group select-none aspect-video flex flex-col justify-between"
    >
      {/* Cinematic Canvas Background */}
      <canvas
        ref={canvasRef}
        width={960}
        height={540}
        className="absolute inset-0 w-full h-full object-cover"
      />
      {mediaUrl && (
        <video
          ref={videoRef}
          key={mediaUrl}
          src={mediaUrl}
          className="absolute inset-0 z-[1] w-full h-full object-cover"
          controls={false}
          autoPlay
          muted={isMuted}
          playsInline
          onError={() => setMediaPlaybackError(true)}
        />
      )}
      {mediaPlaybackError && mediaUrl && (
        <div className="absolute inset-x-5 bottom-20 z-20 rounded-lg bg-black/75 px-3 py-2 text-xs text-amber-200">
          Segment verified, but this browser could not decode the delivered media format.
        </div>
      )}

      {/* Top Header Overlay */}
      <div className="relative z-20 p-5 flex items-start justify-between bg-gradient-to-b from-black/85 via-black/35 to-transparent">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md">
            {manifest.title || 'Monad Keynote HD'}
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5 font-medium">
            {manifest.totalSegments} segments · {manifest.totalDurationSec}s seconds · {manifest.unitPriceUSDC} USDC/segment
          </p>
        </div>

        {/* Brand Badge in Top-Right matching screenshot */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-[#3e2e1e] text-xs font-semibold shadow-md">
          <div className="w-4 h-4 rounded-full bg-[#d89a4e] flex items-center justify-center text-black">
            <Play className="w-2 h-2 fill-current ml-[1px]" />
          </div>
          <span className="text-white tracking-tight">StreamPay</span>
        </div>
      </div>

      {/* Verification Overlay */}
      {verifyingNotice && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-xs">
          <div className="px-5 py-3 rounded-2xl bg-[#18130e]/95 border border-[#5a4023] shadow-2xl flex items-center gap-3 text-sm text-[#e8b56f]">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="font-medium">{verifyingNotice}</span>
          </div>
        </div>
      )}

      {/* Verified Status Pill on bottom right */}
      <div className="relative z-10 px-5 flex justify-end">
        {session.status === 'active' && session.verificationLogs.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-black/50 backdrop-blur-md border border-[#2e2317] text-[11px] text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="font-mono">Merkle & SHA-256 Verified</span>
          </div>
        )}
      </div>

      {/* Bottom Video Controls Bar */}
      <div className="relative z-20 px-5 pb-3.5 pt-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent flex flex-col gap-2.5">
        {/* Timeline Slider Track */}
        <div
          onClick={handleSeek}
          className="w-full h-1.5 hover:h-2 bg-neutral-800/90 rounded-full overflow-hidden cursor-pointer relative transition-all group/bar"
        >
          {/* Segment ticks overlay */}
          <div className="absolute inset-0 flex">
            {manifest.segments.map((_: unknown, i: number) => (
              <div
                key={i}
                className="h-full border-r border-black/50"
                style={{ width: `${100 / manifest.totalSegments}%` }}
              />
            ))}
          </div>

          {/* Filled progress bar in warm gold */}
          <div
            className="h-full bg-gradient-to-r from-[#c9944d] to-[#e6b168] rounded-full relative transition-[width] duration-150"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between text-neutral-300">
          <div className="flex items-center gap-4">
            {/* Play/Pause Button */}
            <button
              onClick={handleTogglePlay}
              className="text-white hover:text-[#e8b56f] transition-colors focus:outline-none cursor-pointer"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            {/* Timestamps */}
            <div className="text-xs font-mono font-medium tracking-wider text-neutral-300">
              <span>{formatTime(playbackTime)}</span>
              <span className="text-neutral-500 mx-1.5">/</span>
              <span className="text-neutral-400">{formatTime(totalDuration)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3.5">
            {/* Volume toggle */}
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>

            {/* Fullscreen button */}
            <button
              onClick={handleFullscreen}
              className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
              title="Fullscreen"
            >
              <Maximize className="w-4 h-4" />
            </button>

            {/* Settings button */}
            <button
              className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
              title="Quality & Audio"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
