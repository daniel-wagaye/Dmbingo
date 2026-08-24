import { useEffect, useMemo, useState } from 'react';

const PARTICLE_COUNT = 46;
const DURATION_MS = 2600;
const COLORS = ['#ffd24a', '#ff8c00', '#00f2ff', '#34d399', '#ff4d6a', '#ffffff'];

interface Particle {
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  color: string;
  size: number;
  round: boolean;
}

function buildParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => {
    // Spread across the full circle but bias downward so particles settle like falling paper.
    const angle = Math.random() * Math.PI * 2;
    const distance = 90 + Math.random() * 170;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance * 0.7 + 60 + Math.random() * 120,
      rot: (Math.random() * 720 - 360) | 0,
      delay: Math.random() * 260,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      size: 5 + Math.random() * 5,
      round: Math.random() < 0.35,
    };
  });
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * One-shot celebration burst. It unmounts itself once the animation ends so it never loops
 * and never keeps a transparent layer over the modal.
 */
export default function Confetti() {
  const reduced = useMemo(prefersReducedMotion, []);
  const [done, setDone] = useState(reduced);
  const particles = useMemo(() => (reduced ? [] : buildParticles()), [reduced]);

  useEffect(() => {
    if (reduced) return;
    const id = setTimeout(() => setDone(true), DURATION_MS);
    return () => clearTimeout(id);
  }, [reduced]);

  if (done || particles.length === 0) return null;

  return (
    <div className="streak-confetti" aria-hidden="true">
      {particles.map((p, i) => (
        <span
          key={i}
          className={`streak-confetti-piece${p.round ? ' streak-confetti-round' : ''}`}
          style={{
            '--dx': `${p.dx.toFixed(1)}px`,
            '--dy': `${p.dy.toFixed(1)}px`,
            '--rot': `${p.rot}deg`,
            '--size': `${p.size.toFixed(1)}px`,
            background: p.color,
            animationDelay: `${p.delay.toFixed(0)}ms`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
