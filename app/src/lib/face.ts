// Still-photo face contours, using the same ML Kit face detector that powers the
// live camera guide (react-native-vision-camera-face-detector's image detector).
// The plan named @react-native-ml-kit/face-detection; it uses the legacy bridge
// and hasn't been updated for current React Native, so it was swapped for this.
// This file is the only place that knows which library is used.

import type { Contours } from 'react-native-vision-camera-face-detector';
import { buildSkinMap, type FaceContours, type Pt, type SkinMapGeometry } from '@skinfix/shared';

type FaceLib = typeof import('react-native-vision-camera-face-detector');
let detector: ReturnType<FaceLib['createImageFaceDetector']> | null = null;
function getDetector() {
  // Loaded on first use, so a native-module problem surfaces as a caught error here
  // instead of breaking every screen that imports this file.
  const lib = require('react-native-vision-camera-face-detector') as FaceLib;
  detector ??= lib.createImageFaceDetector({ performanceMode: 'accurate', runContours: true, runLandmarks: false });
  return detector;
}

const pts = (a: { x: number; y: number }[] | undefined): Pt[] => (a ?? []).map((p) => ({ x: p.x, y: p.y }));

function toFaceContours(c: Contours): FaceContours {
  return {
    face: pts(c.FACE),
    leftEyebrowTop: pts(c.LEFT_EYEBROW_TOP),
    leftEyebrowBottom: pts(c.LEFT_EYEBROW_BOTTOM),
    rightEyebrowTop: pts(c.RIGHT_EYEBROW_TOP),
    rightEyebrowBottom: pts(c.RIGHT_EYEBROW_BOTTOM),
    leftEye: pts(c.LEFT_EYE),
    rightEye: pts(c.RIGHT_EYE),
    upperLipTop: pts(c.UPPER_LIP_TOP),
    upperLipBottom: pts(c.UPPER_LIP_BOTTOM),
    lowerLipTop: pts(c.LOWER_LIP_TOP),
    lowerLipBottom: pts(c.LOWER_LIP_BOTTOM),
    noseBridge: pts(c.NOSE_BRIDGE),
    noseBottom: pts(c.NOSE_BOTTOM),
  };
}

export type StillResult =
  | { ok: true; geometry: SkinMapGeometry }
  | { ok: false; reason: 'no_face' | 'multiple_faces' | 'incomplete' };

/**
 * Detect contours on the prepared (un-mirrored, resized) JPEG and build the zones.
 * Coordinates are in that image's pixels.
 */
export function detectStill(fileUri: string, width: number, height: number): StillResult {
  const faces = getDetector().detectFaces(fileUri);
  if (faces.length === 0) return { ok: false, reason: 'no_face' };
  // A second, much smaller face (poster, someone behind) is fine; two similar faces are not.
  const sorted = [...faces].sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height);
  const main = sorted[0]!;
  const second = sorted[1];
  if (second && second.bounds.width * second.bounds.height > 0.4 * main.bounds.width * main.bounds.height)
    return { ok: false, reason: 'multiple_faces' };
  if (!main.contours) return { ok: false, reason: 'incomplete' };
  const geometry = buildSkinMap(toFaceContours(main.contours), width, height, { mirrored: false });
  return geometry ? { ok: true, geometry } : { ok: false, reason: 'incomplete' };
}
