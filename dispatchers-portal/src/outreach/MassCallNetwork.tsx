import React, { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { callPhase, type OutreachCall, type CallPhase } from "./simulation";

export const PHASE_COLOR: Record<CallPhase, string> = { queued: "#3c4c58", ringing: "#e7b663", live: "#63dfdc", assessed: "#72d99b", handoff: "#c2a0ff", door_check: "#f38c80" };
export const PHASE_LABEL: Record<CallPhase, string> = { queued: "Queued", ringing: "Ringing", live: "Connected", assessed: "Assessed", handoff: "Dispatcher", door_check: "Door check" };

export function MassCallNetwork({ calls, elapsed, selected, onSelect }: { calls: OutreachCall[]; elapsed: number; selected: number; onSelect: (id: number) => void }) {
  const root = useRef<SVGSVGElement>(null);
  const timeline = useRef<gsap.core.Timeline>();
  const rows = Math.ceil(calls.length / 18);
  const position = (id: number) => ({ x: 300 + (id % 18) * 37.8, y: 36 + Math.floor(id / 18) * (306 / Math.max(1, rows - 1)) });

  useLayoutEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = gsap.context(() => {
      const animation = gsap.timeline({ paused: true });
      if (!reduced) {
        calls.forEach(call => {
          const start = call.startsAt / 1000;
          const end = (call.turns.length ? call.turns[call.turns.length - 1].end : call.startsAt + 9000) / 1000;
          animation.fromTo(`#beam-${call.id}`, { strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0, opacity: 0.65, duration: 0.85, ease: "power2.out" }, start);
          animation.to(`#beam-${call.id}`, { opacity: 0.08, duration: 0.6 }, start + 0.85);
          animation.fromTo(`#packet-${call.id}`, { strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: -1, opacity: 0.9, duration: 1.5, ease: "none", repeat: Math.max(0, Math.ceil((end - start) / 1.5) - 1) }, start);
          animation.to(`#packet-${call.id}`, { opacity: 0, duration: 0.2, overwrite: false }, end);
          animation.fromTo(`#house-${call.id}`, { scale: 0.7, transformOrigin: "center" }, { scale: 1, duration: 0.6, ease: "back.out(2)" }, start);
        });
        animation.fromTo(".hub-pulse", { scale: 0.8, opacity: 0.7, transformOrigin: "center" }, { scale: 1.8, opacity: 0, duration: 2.3, repeat: Math.ceil(animation.duration() / 2.3), stagger: 0.75, ease: "power1.out" }, 0);
      }
      timeline.current = animation;
    }, root);
    return () => { context.revert(); timeline.current = undefined; };
  }, [calls]);

  useLayoutEffect(() => { timeline.current?.seek(elapsed / 1000, true); }, [elapsed, calls]);

  return <svg ref={root} className="mass-network" viewBox="0 0 1000 385" aria-label="Outgoing calls to households">
    <defs>
      <pattern id="network-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.65" fill="#57727b" opacity="0.22" /></pattern>
      <radialGradient id="hub-glow"><stop stopColor="#35d6cd" stopOpacity="0.15" /><stop offset="1" stopColor="#35d6cd" stopOpacity="0" /></radialGradient>
    </defs>
    <rect width="1000" height="385" fill="url(#network-grid)" />
    <circle cx="102" cy="188" r="170" fill="url(#hub-glow)" />
    {[0, 1, 2].map(i => <path key={i} d={`M 0 ${80 + i * 140} C 250 ${-50 + i * 120}, 460 ${220 + i * 90}, 1000 ${20 + i * 140}`} fill="none" stroke="#233b43" strokeWidth="1" opacity="0.45" />)}
    {calls.map(call => {
      const { x, y } = position(call.id);
      const d = `M 102 188 C 205 188, ${x - 80} ${y}, ${x} ${y}`;
      return <g key={call.id} aria-hidden="true"><path id={`beam-${call.id}`} d={d} pathLength="1" fill="none" stroke="#67e8dc" strokeWidth="0.7" strokeDasharray="1" strokeDashoffset="1" opacity="0" />
        <path id={`packet-${call.id}`} d={d} pathLength="1" fill="none" stroke="#b7fff3" strokeWidth="1.5" strokeDasharray="0.025 0.975" strokeDashoffset="1" opacity="0" /></g>;
    })}
    <g aria-hidden="true"><circle className="hub-pulse" cx="102" cy="188" r="47" fill="none" stroke="#6ce8dc" opacity="0" /><circle className="hub-pulse" cx="102" cy="188" r="47" fill="none" stroke="#6ce8dc" opacity="0" />
      <circle cx="102" cy="188" r="46" fill="#0c2229" stroke="#3d8e88" /><circle cx="102" cy="188" r="37" fill="#102f35" stroke="#6ce8dc" strokeOpacity="0.3" />
      <path d="M 89 174 Q 85 185 99 198 Q 112 210 119 199 L 111 192 L 105 197 Q 95 192 94 184 L 98 180 Z" fill="none" stroke="#a4fff0" strokeWidth="2.5" strokeLinejoin="round" />
      <text x="102" y="258" textAnchor="middle" fill="#e4f6f3" fontSize="13" letterSpacing="2">DIALEVAC</text><text x="102" y="277" textAnchor="middle" fill="#718e96" fontSize="9" letterSpacing="1.5">OUTREACH HUB</text>
    </g>
    {calls.map(call => {
      const { x, y } = position(call.id);
      const phase = callPhase(call, elapsed);
      const color = PHASE_COLOR[phase];
      return <g key={call.id} id={`house-${call.id}`} role="button" tabIndex={0} aria-label={`Household ${call.id + 1}, ${call.name}, ${PHASE_LABEL[phase]}`} aria-pressed={call.id === selected}
        className="household-node" onClick={() => onSelect(call.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(call.id); } }}>
        <title>{call.name} · {call.address} · {PHASE_LABEL[phase]}</title>
        {call.id === selected && <rect x={x - 15} y={y - 15} width="30" height="30" rx="7" fill="none" stroke="#fff" strokeWidth="1.4" />}
        <rect x={x - 11} y={y - 11} width="22" height="22" rx="5" fill={color} fillOpacity={phase === "queued" ? 0.12 : 0.17} stroke={color} strokeOpacity={phase === "queued" ? 0.5 : 0.85} />
        <path d={`M ${x - 6} ${y} L ${x} ${y - 5} L ${x + 6} ${y} M ${x - 4} ${y - 1} V ${y + 5} H ${x + 4} V ${y - 1} M ${x} ${y + 5} V ${y + 1}`} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
      </g>;
    })}
    <text x="300" y="375" fill="#718e96" fontSize="10" letterSpacing="1">SELECT A HOUSEHOLD TO FOLLOW ITS CONVERSATION</text>
  </svg>;
}
