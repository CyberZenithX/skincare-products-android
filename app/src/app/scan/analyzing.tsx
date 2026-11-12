import { useCallback, useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ErrorState, Screen, Text, Button } from '@/components/ui';
import { ScanAnimation, useSkiaPhoto } from '@/components/SkinMap';
import { api, errorKey } from '@/lib/api';
import { currentLanguage } from '@/lib/i18n';
import { scanStore, toAnswers, useScan } from '@/lib/scanStore';
import { space } from '@/theme';

const STATUSES = ['s1', 's2', 's3', 's4'] as const;

export default function Analyzing() {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const photo = useScan((s) => s.photo);
  const geometry = useScan((s) => s.geometry);
  const skPhoto = useSkiaPhoto(photo?.base64);
  const [status, setStatus] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setStatus((s) => (s + 1) % STATUSES.length), 2000);
    return () => clearInterval(id);
  }, []);

  const run = useCallback(async () => {
    const s = scanStore.get();
    const answers = toAnswers(s.answers);
    if (!s.photo || !answers) {
      router.replace('/welcome');
      return;
    }
    setError(null);
    try {
      const result = await api.analyze({ image_base64: s.photo.base64, answers, language: currentLanguage() });
      scanStore.set({ result, listings: result.profile.products.map(() => ({ state: 'loading' as const })) });
      router.replace(result.profile.photo_quality.usable ? '/scan/results' : '/scan/retake');
    } catch (e) {
      // Answers and photo stay in the store, so Retry loses nothing.
      setError(t(errorKey(e)));
    }
  }, [t]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);

  return (
    <Screen>
      <View style={{ flex: 1, padding: space.xl, justifyContent: 'center', alignItems: 'center', gap: space.xl }}>
        {geometry && <ScanAnimation geometry={geometry} photo={skPhoto} width={Math.min(width - space.xl * 2, 360)} />}
        {!error ? (
          <Animated.View key={status} entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
            <Text variant="heading" weight="semibold" center>{t(`analyzing.${STATUSES[status]}`)}</Text>
          </Animated.View>
        ) : (
          <View style={{ alignSelf: 'stretch', gap: space.sm }}>
            <ErrorState message={error} note={t('errors.answersKept')} onRetry={run} retryLabel={t('common.retry')} />
            <Button title={t('common.back')} kind="ghost" onPress={() => router.replace('/scan/questions')} />
          </View>
        )}
      </View>
    </Screen>
  );
}
