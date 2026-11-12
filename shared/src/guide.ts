// Live camera guide: pure checks on the detected face vs the on-screen oval.
// All coordinates are preview-view pixels.

export interface GuideFace {
  bounds: { x: number; y: number; width: number; height: number };
  yawAngle: number;
  pitchAngle: number;
  rollAngle: number;
}

export interface Oval {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export type GuideHint = 'noFace' | 'multiple' | 'closer' | 'back' | 'center' | 'straight' | 'hold';

export interface GuideResult {
  ok: boolean;
  hint: GuideHint;
  /** 0..4 checks passed (face found, centred, distance, straight): drives the oval glow. */
  passed: number;
}

export const LIMITS = {
  /** Face centre within this fraction of the oval size from the oval centre. */
  centerTol: 0.14,
  /** Face width as a fraction of oval width. */
  minFill: 0.62,
  maxFill: 1.08,
  maxYaw: 12,
  maxPitch: 12,
  maxRoll: 10,
} as const;

export function evaluateGuide(faces: GuideFace[], oval: Oval): GuideResult {
  if (faces.length === 0) return { ok: false, hint: 'noFace', passed: 0 };
  const sorted = [...faces].sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height);
  const f = sorted[0]!;
  const second = sorted[1];
  if (second && second.bounds.width * second.bounds.height > 0.4 * f.bounds.width * f.bounds.height)
    return { ok: false, hint: 'multiple', passed: 0 };

  const fcx = f.bounds.x + f.bounds.width / 2;
  const fcy = f.bounds.y + f.bounds.height / 2;
  const centred = Math.abs(fcx - oval.cx) <= LIMITS.centerTol * oval.w && Math.abs(fcy - oval.cy) <= LIMITS.centerTol * oval.h;
  const fill = f.bounds.width / oval.w;
  const distanceOk = fill >= LIMITS.minFill && fill <= LIMITS.maxFill;
  const straight =
    Math.abs(f.yawAngle) <= LIMITS.maxYaw && Math.abs(f.pitchAngle) <= LIMITS.maxPitch && Math.abs(f.rollAngle) <= LIMITS.maxRoll;

  const passed = 1 + Number(centred) + Number(distanceOk) + Number(straight);
  // Most useful hint first: distance, then position, then angle.
  if (fill < LIMITS.minFill) return { ok: false, hint: 'closer', passed };
  if (fill > LIMITS.maxFill) return { ok: false, hint: 'back', passed };
  if (!centred) return { ok: false, hint: 'center', passed };
  if (!straight) return { ok: false, hint: 'straight', passed };
  return { ok: true, hint: 'hold', passed };
}
