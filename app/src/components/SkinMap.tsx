import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image as SkImage,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  RoundedRect,
  Skia,
  vec,
  type SkImage as SkImageT,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  FINDINGS,
  ZONE_IDS,
  pointInPolygon,
  polygonCentroid,
  strongestFinding,
  type Pt,
  type Finding,
  type SkinMapGeometry,
  type SkinProfile,
  type ZoneId,
} from '@skinfix/shared';
import { FINDING_COLORS, radius, usePalette } from '@/theme';

export type MapMode = 'map' | 'photo';

/** Crop box around the face (padded), in image pixels. */
export function faceBox(g: SkinMapGeometry, pad = 0.16) {
  const xs = g.lines.face.map((p) => p.x);
  const ys = g.lines.face.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  const x = minX - w * pad;
  const y = minY - h * pad * 0.9;
  return { x, y, w: w * (1 + 2 * pad), h: h * (1 + 1.8 * pad) };
}

function pathOf(pts: Pt[], close: boolean): SkPath {
  const b = Skia.PathBuilder.Make();
  pts.forEach((q, i) => (i === 0 ? b.moveTo(q.x, q.y) : b.lineTo(q.x, q.y)));
  if (close) b.close();
  return b.build();
}

/** Smooth closed path through points (Catmull-Rom → cubic Bézier). */
function smoothClosed(pts: Pt[]): SkPath {
  const n = pts.length;
  if (n < 3) return pathOf(pts, true);
  const p = Skia.PathBuilder.Make();
  p.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    p.cubicTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
  }
  p.close();
  return p.build();
}

export function zoneColor(zone: SkinProfile['zones'][ZoneId]) {
  const s = strongestFinding(zone, FINDINGS);
  if (!s) return null;
  return { color: FINDING_COLORS[s.finding as Finding], alpha: [0, 0.3, 0.48, 0.66][s.score]!, finding: s.finding, score: s.score };
}

export function useSkiaPhoto(base64: string | null | undefined): SkImageT | null {
  return useMemo(() => (base64 ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(base64)) : null), [base64]);
}

interface Props {
  geometry: SkinMapGeometry;
  zones: SkinProfile['zones'] | null;
  mode: MapMode;
  photo: SkImageT | null;
  width: number;
  /** Play the reveal (lines draw in, zones fade in one by one). */
  reveal?: boolean;
  onRevealDone?: () => void;
  selected?: ZoneId | null;
  onZonePress?: (z: ZoneId) => void;
}

export function SkinMap({ geometry: g, zones, mode, photo, width, reveal = false, onRevealDone, selected, onZonePress }: Props) {
  const pal = usePalette();
  const box = useMemo(() => faceBox(g), [g]);
  const scale = width / box.w;
  const height = box.h * scale;

  const paths = useMemo(() => {
    const face = smoothClosed(g.lines.face);
    return {
      face,
      brows: g.lines.brows.map((l) => pathOf(l, false)),
      eyes: g.lines.eyes.map((l) => smoothClosed(l)),
      nose: g.lines.nose.map((l) => pathOf(l, false)),
      lips: g.lines.lips.map((l) => pathOf(l, false)),
      zones: Object.fromEntries(ZONE_IDS.map((z) => [z, smoothClosed(g.zones[z])])) as Record<ZoneId, SkPath>,
      centroids: Object.fromEntries(ZONE_IDS.map((z) => [z, polygonCentroid(g.zones[z])])) as Record<ZoneId, Pt>,
      radii: Object.fromEntries(
        ZONE_IDS.map((z) => {
          const c = polygonCentroid(g.zones[z]);
          return [z, Math.max(...g.zones[z].map((p) => Math.hypot(p.x - c.x, p.y - c.y)))];
        }),
      ) as Record<ZoneId, number>,
    };
  }, [g]);

  // Faint dot mesh inside the face.
  const mesh = useMemo(() => {
    const p = Skia.PathBuilder.Make();
    const step = box.w / 26;
    const r = step * 0.09;
    for (let y = box.y; y < box.y + box.h; y += step)
      for (let x = box.x; x < box.x + box.w; x += step) if (pointInPolygon({ x, y }, g.lines.face)) p.addCircle(x, y, r);
    return p.build();
  }, [g, box]);

  // ---- reveal animation
  const lineEnd = useSharedValue(reveal ? 0 : 1);
  const zoneOpacity = [useSharedValue(reveal ? 0 : 1), useSharedValue(reveal ? 0 : 1), useSharedValue(reveal ? 0 : 1), useSharedValue(reveal ? 0 : 1), useSharedValue(reveal ? 0 : 1)];
  useEffect(() => {
    if (!reveal) return;
    const LINES = 1400;
    const STEP = 260;
    lineEnd.value = withTiming(1, { duration: LINES, easing: Easing.inOut(Easing.cubic) });
    const timers: ReturnType<typeof setTimeout>[] = [];
    ZONE_IDS.forEach((_, i) => {
      zoneOpacity[i]!.value = withDelay(LINES + i * STEP, withTiming(1, { duration: 380 }));
      timers.push(setTimeout(() => Haptics.selectionAsync().catch(() => undefined), LINES + i * STEP));
    });
    timers.push(
      setTimeout(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        onRevealDone?.();
      }, LINES + ZONE_IDS.length * STEP + 200),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  const isMap = mode === 'map';
  const lineColor = isMap ? pal.mapLine : 'rgba(255,255,255,0.85)';
  const lineWidth = (isMap ? 2.2 : 1.6) / scale;

  const transform = [{ scale }, { translateX: -box.x }, { translateY: -box.y }];

  const onPress = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!onZonePress) return;
    const pt = { x: e.nativeEvent.locationX / scale + box.x, y: e.nativeEvent.locationY / scale + box.y };
    const hit = ZONE_IDS.find((z) => pointInPolygon(pt, g.zones[z]));
    if (hit) onZonePress(hit);
  };

  return (
    <Pressable onPress={onPress} accessibilityRole="image" style={{ width, height }}>
      <View style={{ width, height, borderRadius: radius.xl, overflow: 'hidden' }}>
        <Canvas style={{ width, height }}>
          <RoundedRect x={0} y={0} width={width} height={height} r={0}>
            <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={[pal.mapBgTop, pal.mapBgBottom]} />
          </RoundedRect>
          <Group transform={transform}>
            {!isMap && photo && (
              <SkImage image={photo} x={0} y={0} width={g.width} height={g.height} fit="fill" />
            )}
            {isMap && (
              <>
                <Path path={paths.face} color={pal.surface} opacity={0.55} />
                <Path path={mesh} color={pal.mapDot} />
              </>
            )}
            {zones &&
              ZONE_IDS.map((z, i) => {
                const zc = zoneColor(zones[z]);
                return (
                  <ZoneFill
                    key={z}
                    path={paths.zones[z]}
                    center={paths.centroids[z]}
                    r={paths.radii[z]}
                    color={zc?.color ?? null}
                    alpha={zc ? (isMap ? zc.alpha : zc.alpha * 0.8) : isMap ? 0.06 : 0}
                    neutral={pal.mapLine}
                    opacity={zoneOpacity[i]!}
                    blur={6 / scale}
                  />
                );
              })}
            {selected && (
              <Path path={paths.zones[selected]} style="stroke" strokeWidth={3 / scale} color={pal.accent}>
                <BlurMask blur={2 / scale} style="solid" />
              </Path>
            )}
            <Lines paths={paths} color={lineColor} width={lineWidth} end={lineEnd} glow={isMap ? pal.accent : null} scale={scale} />
          </Group>
        </Canvas>
      </View>
    </Pressable>
  );
}

function ZoneFill({
  path,
  center,
  r,
  color,
  alpha,
  neutral,
  opacity,
  blur,
}: {
  path: SkPath;
  center: Pt;
  r: number;
  color: string | null;
  alpha: number;
  neutral: string;
  opacity: SharedValue<number>;
  blur: number;
}) {
  const c = Skia.Color(color ?? neutral);
  const inner = Skia.Color([c[0]!, c[1]!, c[2]!, alpha]);
  const outer = Skia.Color([c[0]!, c[1]!, c[2]!, alpha * 0.35]);
  return (
    <Group opacity={opacity}>
      <Path path={path}>
        <RadialGradient c={vec(center.x, center.y)} r={r} colors={[inner, outer]} />
        <BlurMask blur={blur} style="normal" />
      </Path>
    </Group>
  );
}

function Lines({
  paths,
  color,
  width,
  end,
  glow,
  scale,
}: {
  paths: { face: SkPath; brows: SkPath[]; eyes: SkPath[]; nose: SkPath[]; lips: SkPath[] };
  color: string;
  width: number;
  end: SharedValue<number>;
  glow: string | null;
  scale: number;
}) {
  const all = [paths.face, ...paths.brows, ...paths.eyes, ...paths.nose, ...paths.lips];
  return (
    <>
      {glow &&
        all.map((p, i) => (
          <Path key={`g${i}`} path={p} style="stroke" strokeWidth={width * 3} color={glow} opacity={0.18} end={end} strokeCap="round">
            <BlurMask blur={4 / scale} style="normal" />
          </Path>
        ))}
      {all.map((p, i) => (
        <Path key={i} path={p} style="stroke" strokeWidth={width} color={color} end={end} strokeCap="round" strokeJoin="round" />
      ))}
    </>
  );
}

/** Legend: one chip per finding type. */
export function useLegend() {
  return FINDINGS.map((f) => ({ finding: f, color: FINDING_COLORS[f] }));
}

// ---------------------------------------------------------------- analyzing animation

/**
 * The user's photo with a scan line sweeping down; contour points pop in as the
 * line passes and the lines draw themselves after it.
 */
export function ScanAnimation({ geometry: g, photo, width }: { geometry: SkinMapGeometry; photo: SkImageT | null; width: number }) {
  const pal = usePalette();
  const box = useMemo(() => faceBox(g, 0.12), [g]);
  const scale = width / box.w;
  const height = box.h * scale;
  const t = useSharedValue(0);
  useEffect(() => {
    // Sweep down, pause, repeat: driven from JS so the loop restarts cleanly.
    let alive = true;
    const loop = () => {
      if (!alive) return;
      t.value = 0;
      t.value = withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }, () => undefined);
      setTimeout(loop, 3000);
    };
    loop();
    return () => {
      alive = false;
    };
  }, [t]);

  const allPts = useMemo(
    () => [...g.lines.face, ...g.lines.brows.flat(), ...g.lines.eyes.flat(), ...g.lines.nose.flat(), ...g.lines.lips.flat()],
    [g],
  );
  const lines = useMemo(
    () => [smoothClosed(g.lines.face), ...g.lines.brows.map((l) => pathOf(l, false)), ...g.lines.eyes.map(smoothClosed), ...g.lines.nose.map((l) => pathOf(l, false)), ...g.lines.lips.map((l) => pathOf(l, false))],
    [g],
  );

  const scanY = useDerivedValue(() => box.y + t.value * box.h);
  const dots = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    const r = 2.6 / scale;
    for (let i = 0; i < allPts.length; i++) {
      const q = allPts[i]!;
      if (q.y <= scanY.value) p.addCircle(q.x, q.y, r);
    }
    return p.build();
  });
  const lineEnd = useDerivedValue(() => Math.min(1, Math.max(0, t.value * 1.15 - 0.1)));
  const lineRect = useDerivedValue(() => Skia.XYWHRect(box.x, scanY.value - 2 / scale, box.w, 4 / scale));
  const glowRect = useDerivedValue(() => Skia.XYWHRect(box.x, scanY.value - 40 / scale, box.w, 40 / scale));

  return (
    <View style={{ width, height, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: pal.surfaceAlt }}>
      <Canvas style={{ width, height }}>
        <Group transform={[{ scale }, { translateX: -box.x }, { translateY: -box.y }]}>
          {photo && <SkImage image={photo} x={0} y={0} width={g.width} height={g.height} fit="fill" opacity={0.92} />}
          {lines.map((p, i) => (
            <Path key={i} path={p} style="stroke" strokeWidth={1.6 / scale} color="rgba(255,255,255,0.9)" end={lineEnd} strokeCap="round" />
          ))}
          <Path path={dots} color={pal.accent} />
          <RoundedRectFromRect rect={glowRect} colors={['rgba(240,138,93,0)', 'rgba(240,138,93,0.35)']} />
          <RoundedRectFromRect rect={lineRect} colors={[pal.accent, pal.accent]} />
        </Group>
      </Canvas>
    </View>
  );
}

function RoundedRectFromRect({ rect, colors }: { rect: SharedValue<ReturnType<typeof Skia.XYWHRect>>; colors: string[] }) {
  const start = useDerivedValue(() => vec(0, rect.value.y));
  const endV = useDerivedValue(() => vec(0, rect.value.y + rect.value.height));
  return (
    <Rect rect={rect}>
      <LinearGradient start={start} end={endV} colors={colors} />
    </Rect>
  );
}

export { Circle };
