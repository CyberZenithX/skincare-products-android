// Skin Map geometry: builds the 5 zone shapes from ML Kit face contours.
//
// Left/right rule: zones are named by the PERSON'S own left and right. In an
// un-mirrored photo of someone facing the camera, the person's left cheek is on
// the RIGHT side of the image (larger x). We decide sides from geometry, not from
// ML Kit's contour names, so a naming mix-up can't swap the cheeks.

import type { ZoneId } from './schemas';

export type Pt = { x: number; y: number };
export type Polygon = Pt[];

/** The ML Kit contours we use, in image pixel coordinates of the un-mirrored still. */
export interface FaceContours {
  face: Pt[];
  leftEyebrowTop: Pt[];
  leftEyebrowBottom: Pt[];
  rightEyebrowTop: Pt[];
  rightEyebrowBottom: Pt[];
  leftEye: Pt[];
  rightEye: Pt[];
  upperLipTop: Pt[];
  upperLipBottom: Pt[];
  lowerLipTop: Pt[];
  lowerLipBottom: Pt[];
  noseBridge: Pt[];
  noseBottom: Pt[];
}

export interface SkinMapGeometry {
  width: number;
  height: number;
  zones: Record<ZoneId, Polygon>;
  /** Lines for the "Map" view line art. */
  lines: { face: Pt[]; brows: Pt[][]; eyes: Pt[][]; nose: Pt[][]; lips: Pt[][] };
  /** Head roll in degrees (positive = clockwise in image). */
  rollDeg: number;
}

/** Area-weighted centroid of a polygon (falls back to the vertex mean when degenerate). */
export function polygonCentroid(poly: Polygon): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) return centroid(poly);
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const centroid = (pts: Pt[]): Pt => ({ x: mean(pts.map((p) => p.x)), y: mean(pts.map((p) => p.y)) });
const rot = (p: Pt, c: Pt, a: number): Pt => {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
};

export function polygonArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function pointInPolygon(pt: Pt, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Sutherland–Hodgman clip of a polygon by the half-plane where keep(p) >= 0 (keep is linear). */
function clip(poly: Polygon, keep: (p: Pt) => number): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    const kc = keep(cur);
    const kp = keep(prev);
    if (kc >= 0) {
      if (kp < 0) out.push(lerp(prev, cur, kp / (kp - kc)));
      out.push(cur);
    } else if (kp >= 0) {
      out.push(lerp(prev, cur, kp / (kp - kc)));
    }
  }
  return out;
}
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Order points around their centroid so a point cloud becomes a simple polygon. */
function sortByAngle(pts: Pt[]): Pt[] {
  const c = centroid(pts);
  return [...pts].sort((p, q) => Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(q.y - c.y, q.x - c.x));
}

const REQUIRED: (keyof FaceContours)[] = [
  'face',
  'leftEye',
  'rightEye',
  'noseBridge',
  'noseBottom',
  'upperLipTop',
  'lowerLipBottom',
];

/**
 * Build zone polygons. Returns null if the contours are too incomplete to place
 * zones honestly (the app then sends the user back to the camera).
 *
 * @param mirrored set true only if the still is mirrored (it should not be).
 */
export function buildSkinMap(
  c: FaceContours,
  width: number,
  height: number,
  opts: { mirrored?: boolean } = {},
): SkinMapGeometry | null {
  for (const k of REQUIRED) if (!c[k] || c[k].length < 2) return null;
  if (c.face.length < 10) return null;
  const brows = [...(c.leftEyebrowTop ?? []), ...(c.rightEyebrowTop ?? [])];
  if (brows.length < 4) return null;

  // Midline from the nose; eyes split by side of the midline.
  const midX = mean([...c.noseBridge, ...c.noseBottom].map((p) => p.x));
  const eyePts = [...c.leftEye, ...c.rightEye];
  const eyeImgLeft = eyePts.filter((p) => p.x < midX);
  const eyeImgRight = eyePts.filter((p) => p.x >= midX);
  if (eyeImgLeft.length < 2 || eyeImgRight.length < 2) return null;

  // Roll angle from the eye centres; work in a face-aligned frame.
  const eA = centroid(eyeImgLeft);
  const eB = centroid(eyeImgRight);
  const roll = Math.atan2(eB.y - eA.y, eB.x - eA.x);
  const pivot = centroid(c.face);
  const align = (pts: Pt[]) => pts.map((p) => rot(p, pivot, -roll));
  const unalign = (pts: Pt[]) => pts.map((p) => rot(p, pivot, roll));

  const oval = sortByAngle(align(c.face));
  const ys = oval.map((p) => p.y);
  const xs = oval.map((p) => p.x);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const H = bottom - top;
  const W = Math.max(...xs) - Math.min(...xs);
  if (H <= 0 || W <= 0) return null;

  const aBrows = align(brows);
  const aEyeL = align(eyeImgLeft);
  const aEyeR = align(eyeImgRight);
  const aNoseBridge = align(c.noseBridge);
  const aNoseBottom = align(c.noseBottom);
  const aLips = align([...c.upperLipTop, ...(c.upperLipBottom ?? []), ...(c.lowerLipTop ?? []), ...c.lowerLipBottom]);
  const aMid = mean([...aNoseBridge, ...aNoseBottom].map((p) => p.x));

  // Forehead: oval above the brows.
  const browY = mean(aBrows.map((p) => p.y));
  const foreheadBottom = browY - 0.02 * H;
  const forehead = clip(oval, (p) => foreheadBottom - p.y);

  // Nose / T-zone centre strip: from between the brows to just under the nostrils.
  const innerL = Math.max(...aEyeL.map((p) => p.x));
  const innerR = Math.min(...aEyeR.map((p) => p.x));
  const topHalf = Math.max(0.04 * W, ((innerR - innerL) / 2) * 0.6);
  const nbMinX = Math.min(...aNoseBottom.map((p) => p.x));
  const nbMaxX = Math.max(...aNoseBottom.map((p) => p.x));
  const nbPad = 0.15 * (nbMaxX - nbMinX) + 0.01 * W;
  const nbY = Math.max(...aNoseBottom.map((p) => p.y));
  const eyeBottom = Math.max(...[...aEyeL, ...aEyeR].map((p) => p.y));
  const noseTop = foreheadBottom + 0.01 * H;
  const noseBottomY = nbY + 0.015 * H;
  const flareY = Math.max(eyeBottom + 0.02 * H, nbY - 0.07 * H);
  const nose: Polygon = [
    { x: aMid - topHalf, y: noseTop },
    { x: aMid + topHalf, y: noseTop },
    { x: aMid + topHalf, y: eyeBottom },
    { x: nbMaxX + nbPad, y: flareY },
    { x: nbMaxX + nbPad * 0.6, y: noseBottomY },
    { x: nbMinX - nbPad * 0.6, y: noseBottomY },
    { x: nbMinX - nbPad, y: flareY },
    { x: aMid - topHalf, y: eyeBottom },
  ];

  // Cheeks: below the eyes, down to just under the mouth corners, outside the nose.
  // Mouth corners: lip points within 1.5% of face width of the leftmost / rightmost lip x.
  const lipMinX = Math.min(...aLips.map((q) => q.x));
  const lipMaxX = Math.max(...aLips.map((q) => q.x));
  const tol = 0.015 * W;
  const mouthCornerY = mean(aLips.filter((p) => p.x <= lipMinX + tol || p.x >= lipMaxX - tol).map((p) => p.y));
  const cheekTop = eyeBottom + 0.03 * H;
  const cheekBottom = mouthCornerY + 0.02 * H;
  const gap = 0.02 * W;
  const band = clip(clip(oval, (p) => p.y - cheekTop), (p) => cheekBottom - p.y);
  const cheekImgLeft = clip(band, (p) => nbMinX - nbPad - gap - p.x);
  const cheekImgRight = clip(band, (p) => p.x - (nbMaxX + nbPad + gap));

  // Chin: below the lower lip, roughly as wide as the mouth plus a margin.
  const lipBottom = Math.max(...align(c.lowerLipBottom).map((p) => p.y));
  const mouthMin = lipMinX;
  const mouthMax = lipMaxX;
  const chinMargin = 0.12 * W;
  let chin = clip(oval, (p) => p.y - (lipBottom + 0.02 * H));
  chin = clip(chin, (p) => p.x - (mouthMin - chinMargin));
  chin = clip(chin, (p) => mouthMax + chinMargin - p.x);

  // Person's left = image right, unless the still is mirrored.
  const [personLeft, personRight] = opts.mirrored ? [cheekImgLeft, cheekImgRight] : [cheekImgRight, cheekImgLeft];

  const zones = {
    forehead: unalign(forehead),
    nose: unalign(nose),
    left_cheek: unalign(personLeft),
    right_cheek: unalign(personRight),
    chin: unalign(chin),
  } satisfies Record<ZoneId, Polygon>;

  for (const z of Object.values(zones)) if (z.length < 3 || polygonArea(z) < 1e-6 * width * height) return null;

  return {
    width,
    height,
    zones,
    lines: {
      face: sortByAngle(c.face),
      brows: [c.leftEyebrowTop, c.leftEyebrowBottom, c.rightEyebrowTop, c.rightEyebrowBottom].filter((l) => l?.length),
      eyes: [c.leftEye, c.rightEye],
      nose: [c.noseBridge, c.noseBottom],
      lips: [c.upperLipTop, c.upperLipBottom, c.lowerLipTop, c.lowerLipBottom].filter((l) => l?.length),
    },
    rollDeg: (roll * 180) / Math.PI,
  };
}

/** Strongest finding per zone, used to colour it. Ties go to the earlier finding in FINDINGS order. */
export function strongestFinding<T extends Record<string, unknown>>(
  scores: T,
  findings: readonly (keyof T & string)[],
): { finding: keyof T & string; score: number } | null {
  let best: { finding: keyof T & string; score: number } | null = null;
  for (const f of findings) {
    const s = Number(scores[f] ?? 0);
    if (s > 0 && (!best || s > best.score)) best = { finding: f, score: s };
  }
  return best;
}
