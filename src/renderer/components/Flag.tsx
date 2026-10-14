import { useRef, type PointerEvent } from 'react';
import type { AppState } from '../../shared/schema';

export function FlagArt({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 64 64" className={className} aria-hidden="true" shapeRendering="crispEdges">
    <defs><clipPath id="flag-clip"><path d="M10 10H58V42H10Z" /></clipPath></defs>
    <path fill="#192d62" d="M10 10H58V42H10Z" />
    <g clipPath="url(#flag-clip)">
      <path stroke="#f7f6f1" strokeWidth="8" d="M10 10L58 42M58 10L10 42" />
      <path stroke="#e45a62" strokeWidth="3" d="M10 10L58 42M58 10L10 42" />
      <path fill="#f7f6f1" d="M10 21H58V31H10ZM29 10H39V42H29Z" />
      <path fill="#e45a62" d="M10 24H58V28H10ZM32 10H36V42H32Z" />
      <path fill="#ffffff" opacity=".13" d="M10 10H26V42H10Z" />
    </g>
    <path fill="#c8cfe0" d="M6 7H10V57H6Z" />
    <path fill="#f7f6f1" d="M6 5H10V9H6Z" />
    <path fill="#172a54" d="M2 56H16V60H2Z" />
  </svg>;
}
export function FloatingFlag({ state }: { state: AppState }) {
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const paused = !state.settings.monitoring || !state.settings.onboardingComplete;
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    gesture.current = { x: event.screenX, y: event.screenY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId); window.buddy.drag('start');
  };
  return <main className={`floating ${state.settings.animation ? 'animated' : ''} ${state.settings.animation && state.popup.status === 'loading' ? 'reacting' : ''}`}>
    <button className="flag-hit" title="Drag to move · Click for settings · Right-click for menu" aria-label="English Buddy: drag or open settings" onPointerDown={start}
      onPointerMove={event => { if (!gesture.current) return; if (Math.abs(event.screenX - gesture.current.x) + Math.abs(event.screenY - gesture.current.y) > 4) gesture.current.moved = true; window.buddy.drag('move'); }}
      onPointerUp={event => { if (!gesture.current) return; const moved = gesture.current.moved; gesture.current = null; event.currentTarget.releasePointerCapture(event.pointerId); window.buddy.drag('end'); if (!moved) void window.buddy.openSettings(); }}
      onPointerCancel={() => { gesture.current = null; window.buddy.drag('end'); }}
      onContextMenu={event => { event.preventDefault(); void window.buddy.menu(); }}>
      <FlagArt className="flag-art" />
      <span className="flag-shadow" />
    </button>
    <span className={`flag-status ${paused ? 'paused' : ''}`}><i />{paused ? 'paused' : 'buddy'}</span>
  </main>;
}
