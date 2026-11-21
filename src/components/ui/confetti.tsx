"use client";

import { useEffect, useRef } from "react";

// A short burst of confetti (M19), drawn on a canvas over the page. No
// library. Skipped for people who ask their device for reduced motion.

const COLOURS = [
  "#1c4d3d",
  "#2f7a5f",
  "#e9b38a",
  "#f2c94c",
  "#7a2e1f",
  "#9ad0b8",
];

export function Confetti({ run }: { run: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!run) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const w = (c.width = window.innerWidth);
    const h = (c.height = window.innerHeight);
    const bits = Array.from({ length: 160 }, (_, i) => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      size: 6 + Math.random() * 6,
      spin: Math.random() * Math.PI,
      turn: (Math.random() - 0.5) * 0.3,
      colour: COLOURS[i % COLOURS.length]!,
    }));
    let frame = 0;
    let id = 0;
    const tick = () => {
      frame += 1;
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.vy += 0.35;
        b.vx *= 0.99;
        b.x += b.vx;
        b.y += b.vy;
        b.spin += b.turn;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin);
        ctx.globalAlpha = Math.max(0, 1 - frame / 180);
        ctx.fillStyle = b.colour;
        ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        ctx.restore();
      }
      if (frame < 180) id = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [run]);
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70]"
    />
  );
}
