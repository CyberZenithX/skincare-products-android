import { describe, expect, it } from 'vitest';
import { evaluateGuide, type GuideFace } from '../src/guide';

const oval = { cx: 200, cy: 300, w: 260, h: 340 };
const face = (o: Partial<GuideFace['bounds']> = {}, angles: Partial<GuideFace> = {}): GuideFace => {
  const width = o.width ?? 220;
  const height = o.height ?? 280;
  return {
    bounds: { x: o.x ?? 200 - width / 2, y: o.y ?? 300 - height / 2, width, height },
    yawAngle: 0,
    pitchAngle: 0,
    rollAngle: 0,
    ...angles,
  };
};

describe('evaluateGuide', () => {
  it('turns green only when centred, close enough and straight', () => {
    expect(evaluateGuide([face()], oval)).toEqual({ ok: true, hint: 'hold', passed: 4 });
  });
  it('asks to come closer or move back', () => {
    expect(evaluateGuide([face({ width: 120, height: 150 })], oval).hint).toBe('closer');
    expect(evaluateGuide([face({ width: 300, height: 380 })], oval).hint).toBe('back');
  });
  it('asks to centre', () => {
    const r = evaluateGuide([face({ x: 10 })], oval);
    expect(r).toMatchObject({ ok: false, hint: 'center' });
  });
  it('asks to look straight for turn, tilt or nod', () => {
    expect(evaluateGuide([face({}, { yawAngle: 20 })], oval).hint).toBe('straight');
    expect(evaluateGuide([face({}, { rollAngle: -15 })], oval).hint).toBe('straight');
    expect(evaluateGuide([face({}, { pitchAngle: 14 })], oval).hint).toBe('straight');
    expect(evaluateGuide([face({}, { yawAngle: 10, rollAngle: 8 })], oval).ok).toBe(true);
  });
  it('handles no face and two similar faces', () => {
    expect(evaluateGuide([], oval)).toMatchObject({ ok: false, hint: 'noFace', passed: 0 });
    expect(evaluateGuide([face(), face({ x: 0, width: 200 })], oval).hint).toBe('multiple');
    // a small face in the background is ignored
    expect(evaluateGuide([face(), face({ x: 0, width: 40, height: 50 })], oval).ok).toBe(true);
  });
});
