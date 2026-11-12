import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, IconButton, Screen, Text } from '@/components/ui';
import { Icon } from '@/components/icons';
import { LanguageToggle } from '@/components/LanguageToggle';
import { clearDraft, scanStore } from '@/lib/scanStore';
import { radius, space, usePalette } from '@/theme';

export default function Welcome() {
  const { t } = useTranslation();
  const p = usePalette();

  useEffect(() => {
    // Arriving here means no scan is in progress.
    clearDraft();
  }, []);

  const steps = [
    { icon: 'scan' as const, label: t('welcome.step1') },
    { icon: 'chat' as const, label: t('welcome.step2') },
    { icon: 'sparkle' as const, label: t('welcome.step3') },
  ];

  return (
    <Screen>
      <View style={{ flex: 1, padding: space.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <LanguageToggle route="/welcome" />
          <IconButton label={t('common.settings')} onPress={() => router.push('/settings')}>
            <Icon name="gear" />
          </IconButton>
        </View>

        <View style={{ flex: 1, justifyContent: 'center', gap: space.xl }}>
          <Animated.View entering={FadeInDown.duration(500)}>
            <Text variant="display" weight="semibold">Skin Fix</Text>
            <Text muted style={{ marginTop: space.sm }}>{t('welcome.tagline')}</Text>
          </Animated.View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {steps.map((s, i) => (
              <Animated.View key={s.icon} entering={FadeInDown.delay(150 + i * 120).duration(500)} style={{ alignItems: 'center', gap: space.sm, flex: 1 }}>
                <View style={{ width: 64, height: 64, borderRadius: radius.lg, backgroundColor: i === 2 ? p.accentSoft : p.surface, borderWidth: 1, borderColor: p.border, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={s.icon} size={28} color={i === 2 ? p.accent : p.text} />
                </View>
                <Text variant="small" weight="medium" center>{s.label}</Text>
              </Animated.View>
            ))}
          </View>

          <Animated.View entering={FadeInDown.delay(550).duration(500)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'center' }}>
            <Icon name="shield" size={18} color={p.textMuted} />
            <Text variant="small" muted>{t('welcome.privacy')}</Text>
          </Animated.View>
        </View>

        <View style={{ gap: space.sm }}>
          <Button
            title={t('welcome.start')}
            onPress={() => {
              scanStore.reset();
              router.push('/scan/camera');
            }}
          />
          <Button title={t('welcome.history')} kind="ghost" onPress={() => router.push('/history')} />
        </View>
      </View>
    </Screen>
  );
}
