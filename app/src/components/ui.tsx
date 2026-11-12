import { useEffect, type ReactNode } from 'react';
import {
  ActivityIndicator,
  I18nManager,
  Pressable,
  Text as RNText,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { font, radius, space, type, usePalette } from '@/theme';

// ---------------------------------------------------------------- text

type Variant = keyof typeof type;
export function Text({
  variant = 'body',
  weight = 'regular',
  muted,
  color,
  center,
  style,
  ...rest
}: TextProps & { variant?: Variant; weight?: Parameters<typeof font>[0]; muted?: boolean; color?: string; center?: boolean }) {
  const p = usePalette();
  return (
    <RNText
      {...rest}
      style={[
        type[variant],
        { fontFamily: font(weight), color: color ?? (muted ? p.textMuted : p.text), writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr' },
        center && { textAlign: 'center' },
        !center && { textAlign: 'left' }, // 'left' flips to start automatically in RTL
        style as StyleProp<TextStyle>,
      ]}
    />
  );
}

// ---------------------------------------------------------------- layout

export function Screen({ children, style, edges = ['top', 'bottom'] }: { children?: ReactNode; style?: StyleProp<ViewStyle>; edges?: ('top' | 'bottom')[] }) {
  const p = usePalette();
  return <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: p.bg }, style]}>{children}</SafeAreaView>;
}

export function Card({ children, style, tone = 'surface' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'surface' | 'alt' | 'accent' }) {
  const p = usePalette();
  const bg = tone === 'alt' ? p.surfaceAlt : tone === 'accent' ? p.accentSoft : p.surface;
  return (
    <View style={[{ backgroundColor: bg, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: tone === 'surface' ? p.border : 'transparent' }, style]}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- buttons

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  icon,
  style,
  haptic = true,
}: {
  title: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
}) {
  const p = usePalette();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const bg = kind === 'primary' ? p.accent : kind === 'secondary' ? p.surfaceAlt : 'transparent';
  const fg = kind === 'primary' ? p.onAccent : p.text;
  const off = disabled || loading;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPressIn={() => (scale.value = withSpring(0.97, { damping: 18 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 18 }))}
      onPress={() => {
        if (off) return;
        if (haptic) Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={[
        {
          minHeight: 54,
          borderRadius: radius.pill,
          paddingHorizontal: space.xl,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: space.sm,
          backgroundColor: bg,
          opacity: off && !loading ? 0.45 : 1,
        },
        anim,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      {!loading && <Text weight="semibold" color={fg}>{title}</Text>}
    </AnimatedPressable>
  );
}

export function IconButton({ onPress, children, label, style }: { onPress: () => void; children: ReactNode; label: string; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={() => {
        Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.surfaceAlt : 'transparent' },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------- chips

export function Chip({ label, color, tone = 'neutral', style }: { label: string; color?: string; tone?: 'neutral' | 'accent' | 'outline'; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const bg = tone === 'accent' ? p.accentSoft : tone === 'outline' ? 'transparent' : p.surfaceAlt;
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: bg, borderWidth: tone === 'outline' ? 1 : 0, borderColor: p.border, alignSelf: 'flex-start' },
        style,
      ]}
    >
      {color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />}
      <Text variant="small" weight="medium">{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- option card

export function OptionCard({
  label,
  selected,
  onPress,
  icon,
  multi,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: ReactNode;
  multi?: boolean;
}) {
  const p = usePalette();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
      onPressIn={() => (scale.value = withSpring(0.98, { damping: 16 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 16 }))}
      onPress={() => {
        Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          minHeight: 64,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderRadius: radius.lg,
          backgroundColor: selected ? p.accentSoft : p.surface,
          borderWidth: 1.5,
          borderColor: selected ? p.accent : p.border,
        },
        anim,
      ]}
    >
      {icon && <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>}
      <Text weight="medium" style={{ flex: 1 }}>{label}</Text>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: multi ? 6 : 11,
          borderWidth: 2,
          borderColor: selected ? p.accent : p.border,
          backgroundColor: selected ? p.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && <View style={{ width: 8, height: 8, borderRadius: multi ? 2 : 4, backgroundColor: p.onAccent }} />}
      </View>
    </AnimatedPressable>
  );
}

// ---------------------------------------------------------------- progress

export function ProgressDots({ total, current }: { total: number; current: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: total, now: current + 1 }}>
      {Array.from({ length: total }, (_, i) => (
        <Dot key={i} active={i === current} done={i < current} color={p.accent} idle={p.border} />
      ))}
    </View>
  );
}

function Dot({ active, done, color, idle }: { active: boolean; done: boolean; color: string; idle: string }) {
  const w = useSharedValue(active ? 22 : 8);
  useEffect(() => {
    w.value = withSpring(active ? 22 : 8, { damping: 16 });
  }, [active, w]);
  const s = useAnimatedStyle(() => ({ width: w.value }));
  return <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: active || done ? color : idle }, s]} />;
}

export function ConfidenceMeter({ level }: { level: 'low' | 'medium' | 'high' }) {
  const p = usePalette();
  const n = level === 'low' ? 1 : level === 'medium' ? 2 : 3;
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i <= n ? p.accent : p.border }} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- skeleton

export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1);
  }, [o]);
  const s = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ backgroundColor: p.skeleton, borderRadius: radius.md }, s, style]} />;
}

// ---------------------------------------------------------------- error state

export function ErrorState({ message, onRetry, retryLabel, note }: { message: string; onRetry: () => void; retryLabel: string; note?: string }) {
  return (
    <Card style={{ gap: space.md, alignItems: 'center' }}>
      <Text center weight="medium">{message}</Text>
      {note && <Text center variant="small" muted>{note}</Text>}
      <Button title={retryLabel} onPress={onRetry} kind="secondary" />
    </Card>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export type { PressableProps };
