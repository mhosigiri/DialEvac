import React from "react";

interface IconProps {
  className?: string;
  size?: number;
}

export const TurnLeftIcon: React.FC<IconProps> = ({ className, size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="9 10 4 15 9 20" />
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
  </svg>
);

export const TurnRightIcon: React.FC<IconProps> = ({ className, size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="15 10 20 15 15 20" />
    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
  </svg>
);

export const StraightIcon: React.FC<IconProps> = ({ className, size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

export const UTurnIcon: React.FC<IconProps> = ({ className, size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="9 10 4 5 9 0" />
    <path d="M20 20v-7a6 6 0 0 0-12 0v7" />
  </svg>
);

export const DestinationIcon: React.FC<IconProps> = ({ className, size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
    <circle cx="12" cy="9" r="2.5" fill="currentColor" />
  </svg>
);

export function getManeuverIcon(instruction: string, size = 28): React.ReactElement {
  // Only the words before the road name describe the maneuver: "Continue on Bright Road" is not a right turn.
  const [maneuver] = instruction.toLowerCase().split(" on ");
  if (maneuver.includes("u-turn")) return <UTurnIcon size={size} />;
  if (/\bleft\b/.test(maneuver)) return <TurnLeftIcon size={size} />;
  if (/\bright\b/.test(maneuver)) return <TurnRightIcon size={size} />;
  if (/\barrive\b/.test(maneuver)) return <DestinationIcon size={size} />;
  return <StraightIcon size={size} />;
}
