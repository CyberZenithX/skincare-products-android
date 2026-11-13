// Shown instead of a blank screen when a screen throws while rendering.
// Kept free of i18n, fonts and theme hooks so it still works if those are what broke.
// The error text is shown on purpose: it's what a tester screenshots for the fix.

import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { router } from 'expo-router';

export function CrashScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const dark = useColorScheme() === 'dark';
  const fg = dark ? '#F3EEE8' : '#1E1B18';
  const bg = dark ? '#151413' : '#F6F1EA';
  const button = (label: string, onPress: () => void, filled: boolean) => (
    <Pressable
      onPress={onPress}
      style={{ paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: filled ? '#B5603F' : 'transparent', borderWidth: filled ? 0 : 1, borderColor: fg }}
    >
      <Text style={{ color: filled ? '#fff' : fg, fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: bg, padding: 24, paddingTop: 72, gap: 16 }}>
      <Text style={{ color: fg, fontSize: 22, fontWeight: '700' }}>Something went wrong</Text>
      <Text style={{ color: fg, opacity: 0.75, fontSize: 15 }}>حدث خطأ. Please screenshot this and send it to the developer.</Text>
      <ScrollView style={{ maxHeight: 260, borderRadius: 12, backgroundColor: dark ? '#26231F' : '#EBE3D8' }} contentContainerStyle={{ padding: 12 }}>
        <Text selectable style={{ color: fg, fontSize: 13, fontFamily: 'monospace' }}>
          {`${error?.name ?? 'Error'}: ${error?.message ?? String(error)}\n\n${(error?.stack ?? '').split('\n').slice(0, 8).join('\n')}`}
        </Text>
      </ScrollView>
      {button('Try again', () => void retry(), true)}
      {button('Back to start', () => router.replace('/welcome'), false)}
    </View>
  );
}
