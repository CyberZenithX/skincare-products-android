import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/mlkit/synthetic-face.json';
import { buildSkinMap, pointInPolygon, polygonCentroid, polygonArea, strongestFinding, type FaceContours, type Pt } from '../src/skinmap';
import { FINDINGS, ZONE_IDS } from '../src/schemas';

const contours = fixture.contours as unknown as FaceContours;
const W = fixture.width;
const H = fixture.height;

const centroid = (pts: Pt[]) => polygonCentroid(pts);

function rotateAll(c: FaceContours, deg: number, pivot: Pt): FaceContours {
  const a = (deg * Math.PI) / 180;
  const r = (p: Pt) => ({
    x: pivot.x + (p.x - pivot.x) * Math.cos(a) - (p.y - pivot.y) * Math.sin(a),
    y: pivot.y + (p.x - pivot.x) * Math.sin(a) + (p.y - pivot.y) * Math.cos(a),
  });
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, (v as Pt[]).map(r)])) as unknown as FaceContours;
}

describe('buildSkinMap', () => {
  const map = buildSkinMap(contours, W, H)!;

  it('builds all 5 zones with real area', () => {
    expect(map).not.toBeNull();
    for (const z of ZONE_IDS) {
      expect(map.zones[z].length).toBeGreaterThanOrEqual(3);
      expect(polygonArea(map.zones[z])).toBeGreaterThan(1000);
    }
  });

  it("puts the person's left cheek on the image right (un-mirrored)", () => {
    expect(centroid(map.zones.left_cheek).x).toBeGreaterThan(500);
    expect(centroid(map.zones.right_cheek).x).toBeLessThan(500);
  });

  it('swaps sides only if the still is mirrored', () => {
    const m = buildSkinMap(contours, W, H, { mirrored: true })!;
    expect(centroid(m.zones.left_cheek).x).toBeLessThan(500);
  });

  it('decides sides from geometry, not ML Kit names', () => {
    const swapped = { ...contours, leftEye: contours.rightEye, rightEye: contours.leftEye };
    const m = buildSkinMap(swapped, W, H)!;
    expect(centroid(m.zones.left_cheek).x).toBeGreaterThan(500);
  });

  it('orders zones top to bottom: forehead, nose, cheeks, chin', () => {
    const y = (z: keyof typeof map.zones) => centroid(map.zones[z]).y;
    expect(y('forehead')).toBeLessThan(y('nose'));
    expect(y('nose')).toBeLessThan(y('chin'));
    expect(y('left_cheek')).toBeLessThan(y('chin'));
    expect(y('forehead')).toBeLessThan(430); // above the brows
  });

  it('keeps zones apart: no zone contains another zone centre', () => {
    for (const a of ZONE_IDS)
      for (const b of ZONE_IDS)
        if (a !== b) expect(pointInPolygon(centroid(map.zones[b]), map.zones[a])).toBe(false);
  });

  it('keeps landmarks out of the wrong zones', () => {
    const noseTip = { x: 500, y: 620 };
    expect(pointInPolygon(noseTip, map.zones.nose)).toBe(true);
    const eyeCentre = { x: 600, y: 480 };
    for (const z of ZONE_IDS) expect(pointInPolygon(eyeCentre, map.zones[z])).toBe(false);
    const mouth = { x: 500, y: 700 };
    for (const z of ZONE_IDS) expect(pointInPolygon(mouth, map.zones[z])).toBe(false);
  });

  it('follows a tilted head', () => {
    const tilted = buildSkinMap(rotateAll(contours, 12, { x: 500, y: 560 }), W, H)!;
    expect(tilted.rollDeg).toBeCloseTo(12, 0);
    // Rotating back the tilted zones should land on the straight ones.
    const a = (-12 * Math.PI) / 180;
    const c = centroid(tilted.zones.left_cheek);
    const back = {
      x: 500 + (c.x - 500) * Math.cos(a) - (c.y - 560) * Math.sin(a),
      y: 560 + (c.x - 500) * Math.sin(a) + (c.y - 560) * Math.cos(a),
    };
    const straight = centroid(map.zones.left_cheek);
    expect(Math.abs(back.x - straight.x)).toBeLessThan(3);
    expect(Math.abs(back.y - straight.y)).toBeLessThan(3);
  });

  it('returns null when contours are missing', () => {
    expect(buildSkinMap({ ...contours, noseBottom: [] }, W, H)).toBeNull();
    expect(buildSkinMap({ ...contours, face: contours.face.slice(0, 5) }, W, H)).toBeNull();
  });
});

describe('strongestFinding', () => {
  it('picks the highest score and ignores zeros', () => {
    const z = { oil: 2, redness: 3, breakouts: 0, dark_spots: 0, dryness: 0, texture: 1, note: '' };
    expect(strongestFinding(z, FINDINGS)).toEqual({ finding: 'redness', score: 3 });
    expect(strongestFinding({ ...z, oil: 0, redness: 0, texture: 0 }, FINDINGS)).toBeNull();
  });
});
