/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

interface StreamPayLogoProps {
  size?: number;
  showText?: boolean;
  showBadge?: boolean;
  variant?: '3d' | 'vector';
  className?: string;
  onClick?: () => void;
}

export const StreamPayLogo: React.FC<StreamPayLogoProps> = ({
  size = 36,
  showText = true,
  showBadge = false,
  variant = '3d',
  className = '',
  onClick,
}) => {
  const [imageLoaded, setImageLoaded] = useState(true);

  return (
    <div
      onClick={onClick}
      className={`group inline-flex items-center gap-3 select-none transition-all ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
    >
      {/* Logo Icon Mark */}
      <div
        className="relative flex items-center justify-center shrink-0 rounded-xl overflow-hidden transition-all duration-300 group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(245,176,65,0.45)]"
        style={{
          width: `${size}px`,
          height: `${size}px`,
        }}
      >
        {variant === '3d' && imageLoaded ? (
          <div className="relative w-full h-full rounded-xl overflow-hidden border border-[#d89a4e]/50 bg-[#0c0a08] shadow-[0_0_14px_rgba(216,154,78,0.25)]">
            <img
              src="/logo-3d.jpg"
              alt="StreamPay Logo"
              className="w-full h-full object-cover scale-105 transition-transform duration-500 group-hover:scale-110"
              onError={() => setImageLoaded(false)}
            />
            {/* Ambient gold glow overlay on hover */}
            <div className="absolute inset-0 bg-gradient-to-tr from-[#d89a4e]/0 via-transparent to-[#f5b041]/15 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        ) : (
          /* High-Precision Vector SVG Logo */
          <svg
            viewBox="0 0 64 64"
            className="w-full h-full rounded-xl border border-[#d89a4e]/40 drop-shadow-[0_0_12px_rgba(217,155,77,0.35)]"
            fill="none"
          >
            <defs>
              <linearGradient id="sp-gold-grad" x1="10%" y1="10%" x2="90%" y2="90%">
                <stop offset="0%" stop-color="#FFF3C4" />
                <stop offset="30%" stop-color="#F5B041" />
                <stop offset="70%" stop-color="#D4831E" />
                <stop offset="100%" stop-color="#8E4F0B" />
              </linearGradient>
              <linearGradient id="sp-monad-rim" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#A78BFA" />
                <stop offset="50%" stop-color="#836EF9" />
                <stop offset="100%" stop-color="#4C1D95" />
              </linearGradient>
              <linearGradient id="sp-core-glow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#FFFFFF" />
                <stop offset="40%" stop-color="#FEF08A" />
                <stop offset="100%" stop-color="#F59E0B" />
              </linearGradient>
            </defs>

            <rect width="64" height="64" rx="14" fill="#0C0A08" />

            {/* Monad Rim Edge */}
            <path
              d="M 18,14 L 46,31 C 47.5,31.9 47.5,34.1 46,35 L 18,52 C 16.3,53 14,51.8 14,49.8 L 14,16.2 C 14,14.2 16.3,13 18,14 Z"
              stroke="url(#sp-monad-rim)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              opacity="0.8"
            />

            {/* Play Arrow Chamfer */}
            <path
              d="M 19,16 L 45,31.5 C 46,32.2 46,33.8 45,34.5 L 19,50 C 17.8,50.8 16,49.8 16,48.3 L 16,17.7 C 16,16.2 17.8,15.2 19,16 Z"
              fill="#1e140a"
              stroke="url(#sp-gold-grad)"
              strokeWidth="1.5"
            />

            {/* S-Stream Loop */}
            <path
              d="M 28,19 C 32,14.5 40,15 44,20 C 47.5,24.5 45.5,30 40,32.5 L 33,35 C 28.5,37 26.5,41.5 28.5,45.5 C 30.5,49.5 36.5,50.5 41,47.5"
              fill="none"
              stroke="url(#sp-gold-grad)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Glowing Core Stream Line */}
            <path
              d="M 28,19 C 32,14.5 40,15 44,20 C 47.5,24.5 45.5,30 40,32.5 L 33,35 C 28.5,37 26.5,41.5 28.5,45.5 C 30.5,49.5 36.5,50.5 41,47.5"
              fill="none"
              stroke="url(#sp-core-glow)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* Typography Lockup */}
      {showText && (
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-1.5 leading-none">
            <span className="text-white font-extrabold text-xl tracking-tight">Stream</span>
            <span className="text-[#e5a454] font-extrabold text-xl tracking-tight">Pay</span>
            {showBadge && (
              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[#d89a4e] bg-[#22170c] border border-[#53391b] px-1.5 py-0.5 rounded-sm ml-1">
                MONAD
              </span>
            )}
          </div>
          <span className="text-[10px] text-[#8e7e6e] font-medium tracking-wide">
            Sub-Cent Pay-Per-Second
          </span>
        </div>
      )}
    </div>
  );
};
