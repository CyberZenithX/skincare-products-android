// Small line icons drawn with Skia so we don't pull in an icon font.
// Directional icons flip in RTL; nothing else does.

import { I18nManager } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { usePalette } from '@/theme';

type IconName =
  | 'back'
  | 'forward'
  | 'gear'
  | 'close'
  | 'scan'
  | 'chat'
  | 'sparkle'
  | 'gallery'
  | 'shield'
  | 'share'
  | 'drop'
  | 'sun'
  | 'leaf'
  | 'dot'
  | 'clock'
  | 'external';

const PATHS: Record<IconName, string> = {
  back: 'M15 5 L8 12 L15 19',
  forward: 'M9 5 L16 12 L9 19',
  close: 'M6 6 L18 18 M18 6 L6 18',
  gear: 'M12 8.5 A3.5 3.5 0 1 0 12 15.5 A3.5 3.5 0 1 0 12 8.5 Z M12 2.5 L12 5 M12 19 L12 21.5 M2.5 12 L5 12 M19 12 L21.5 12 M5.3 5.3 L7.1 7.1 M16.9 16.9 L18.7 18.7 M5.3 18.7 L7.1 16.9 M16.9 7.1 L18.7 5.3',
  scan: 'M4 8 L4 4 L8 4 M16 4 L20 4 L20 8 M20 16 L20 20 L16 20 M8 20 L4 20 L4 16 M8 12 L16 12',
  chat: 'M4 5 H20 V16 H10 L5 20 V16 H4 Z',
  sparkle: 'M12 3 L13.8 10.2 L21 12 L13.8 13.8 L12 21 L10.2 13.8 L3 12 L10.2 10.2 Z',
  gallery: 'M4 5 H20 V19 H4 Z M4 15 L9 10 L14 15 L16 13 L20 17 M15.5 8.5 A1 1 0 1 0 15.6 8.5',
  shield: 'M12 3 L19 6 V11 C19 15.5 16 19 12 21 C8 19 5 15.5 5 11 V6 Z',
  share: 'M12 15 V3 M7.5 7.5 L12 3 L16.5 7.5 M5 12 V20 H19 V12',
  drop: 'M12 3 C12 3 6 10 6 14 A6 6 0 0 0 18 14 C18 10 12 3 12 3 Z',
  sun: 'M12 8 A4 4 0 1 0 12 16 A4 4 0 1 0 12 8 Z M12 2 V4 M12 20 V22 M2 12 H4 M20 12 H22',
  leaf: 'M5 19 C5 10 10 5 20 4 C19 14 14 19 5 19 Z M5 19 L13 11',
  dot: 'M12 9 A3 3 0 1 0 12 15 A3 3 0 1 0 12 9 Z',
  clock: 'M12 3 A9 9 0 1 0 12 21 A9 9 0 1 0 12 3 Z M12 7 V12 L15 14',
  external: 'M14 4 H20 V10 M20 4 L11 13 M18 14 V20 H4 V6 H10',
};

const DIRECTIONAL = new Set<IconName>(['back', 'forward']);

export function Icon({ name, size = 22, color, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = usePalette();
  const path = Skia.Path.MakeFromSVGString(PATHS[name])!;
  const flip = I18nManager.isRTL && DIRECTIONAL.has(name);
  return (
    <Canvas style={{ width: size, height: size, transform: flip ? [{ scaleX: -1 }] : undefined }}>
      <Path
        path={path}
        style="stroke"
        strokeWidth={strokeWidth}
        strokeCap="round"
        strokeJoin="round"
        color={color ?? p.text}
        transform={[{ scale: size / 24 }]}
      />
    </Canvas>
  );
}
