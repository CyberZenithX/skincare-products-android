import { useState } from 'react';
import { I18nManager, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { usePalette } from '@/theme';

const THUMB = 32;

/** Stepped slider. In RTL the minimum is on the right, like every other control. */
export function BudgetSlider({ min, max, step, value, onChange }: { min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  const p = usePalette();
  const [w, setW] = useState(0);
  const rtl = I18nManager.isRTL;
  const steps = (max - min) / step;
  const frac = (v: number) => (v - min) / (max - min);
  const x = useSharedValue(0);
  const last = useSharedValue(value);

  const onLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width - THUMB;
    setW(width);
    x.value = frac(value) * width;
  };

  const emit = (v: number) => {
    Haptics.selectionAsync().catch(() => undefined);
    onChange(v);
  };

  const update = (absX: number) => {
    'worklet';
    if (w <= 0) return;
    const raw = Math.min(Math.max(absX - THUMB / 2, 0), w);
    const logical = rtl ? w - raw : raw;
    const idx = Math.round((logical / w) * steps);
    const v = min + idx * step;
    x.value = (idx / steps) * w;
    if (v !== last.value) {
      last.value = v;
      runOnJS(emit)(v);
    }
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => update(e.x))
    .onUpdate((e) => update(e.x));

  // x is the logical (min→max) offset; mirror it for RTL.
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: rtl ? w - x.value : x.value }] }));
  const fillStyle = useAnimatedStyle(() => (rtl ? { left: w - x.value + THUMB / 2, right: 0 } : { left: 0, width: x.value + THUMB / 2 }));

  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={onLayout}
        style={{ height: 48, justifyContent: 'center', direction: 'ltr' }}
        accessibilityRole="adjustable"
        accessibilityValue={{ min, max, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const v = e.nativeEvent.actionName === 'increment' ? Math.min(max, value + step) : Math.max(min, value - step);
          x.value = frac(v) * w;
          last.value = v;
          onChange(v);
        }}
      >
        <View style={{ height: 8, borderRadius: 4, backgroundColor: p.surfaceAlt, marginHorizontal: THUMB / 2 }} />
        <Animated.View style={[{ position: 'absolute', height: 8, borderRadius: 4, backgroundColor: p.accent }, fillStyle]} />
        <Animated.View
          style={[
            { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: p.surface, borderWidth: 3, borderColor: p.accent, elevation: 3 },
            thumbStyle,
          ]}
        />
      </View>
    </GestureDetector>
  );
}
