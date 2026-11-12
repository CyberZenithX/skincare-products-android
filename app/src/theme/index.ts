import { useColorScheme } from 'react-native';
import type { Finding } from '@skinfix/shared';
import i18n from '@/lib/i18n';

// Calm "skin lab": warm paper light theme, deep charcoal dark theme, one apricot accent.
const light = {
  bg: '#F6F1EA',
  surface: '#FFFDF9',
  surfaceAlt: '#EFE8DE',
  text: '#1F1C19',
  textMuted: '#6E665D',
  border: '#E3DACD',
  accent: '#D9693B',
  accentSoft: '#F6D9C9',
  onAccent: '#FFFFFF',
  danger: '#B3261E',
  success: '#2E7D5B',
  mapBgTop: '#FBF6EF',
  mapBgBottom: '#EADFD1',
  mapLine: '#3A332C',
  mapDot: 'rgba(58,51,44,0.10)',
  skeleton: '#E9E1D6',
};

const dark: typeof light = {
  bg: '#151413',
  surface: '#1F1D1B',
  surfaceAlt: '#2A2724',
  text: '#F3EEE7',
  textMuted: '#A99F94',
  border: '#34302C',
  accent: '#F08A5D',
  accentSoft: '#3D2A20',
  onAccent: '#1A1310',
  danger: '#F2B8B5',
  success: '#7FD1AE',
  mapBgTop: '#211E1B',
  mapBgBottom: '#121110',
  mapLine: '#F3E6D8',
  mapDot: 'rgba(243,230,216,0.10)',
  skeleton: '#2A2724',
};

export type Palette = typeof light;

/**
 * One colour per finding: distinct hues, checked for readability on both the
 * paper and charcoal backgrounds. Same in both themes so the legend never changes meaning.
 */
export const FINDING_COLORS: Record<Finding, string> = {
  oil: '#E9A93A',
  redness: '#E2506D',
  breakouts: '#8C6BEF',
  dark_spots: '#B9784A',
  dryness: '#3E9BDB',
  texture: '#2FB58F',
};

export const radius = { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  display: { fontSize: 30, lineHeight: 38 },
  title: { fontSize: 22, lineHeight: 30 },
  heading: { fontSize: 18, lineHeight: 26 },
  body: { fontSize: 16, lineHeight: 24 },
  small: { fontSize: 14, lineHeight: 20 },
  tiny: { fontSize: 12, lineHeight: 16 },
} as const;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Font family by weight, switching to the Arabic family when the UI is Arabic. */
export function font(weight: 'regular' | 'medium' | 'semibold' | 'bold' = 'regular'): string {
  const ar = i18n.language === 'ar';
  const w = { regular: '400Regular', medium: '500Medium', semibold: '600SemiBold', bold: '700Bold' }[weight];
  return ar ? `IBMPlexSansArabic_${w}` : `IBMPlexSans_${w}`;
}
