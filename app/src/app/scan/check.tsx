import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text } from '@/components/ui';
import { checkExposure, deleteQuietly, type Exposure } from '@/lib/photo';
import { detectStill } from '@/lib/face';
import { scanStore, useScan } from '@/lib/scanStore';
import { radius, space, usePalette } from '@/theme';

/**
 * Photo check: on-device brightness check and face contours on the prepared
 * still. No face → straight back to the camera with a hint (no upload).
 */
export default function Check() {
  const { t } = useTranslation();
  const p = usePalette();
  const { tmp } = useLocalSearchParams<{ tmp?: string }>();
  const photo = useScan((s) => s.photo);
  const { width } = useWindowDimensions();
  const [exposure, setExposure] = useState<Exposure | null>(null);

  useEffect(() => {
    if (!photo) return;
    // Let the screen paint first.
    const id = setTimeout(() => {
      const exp = checkExposure(photo.base64);
      let geometry = null;
      if (tmp) {
        try {
          const r = detectStill(tmp, photo.width, photo.height);
          if (r.ok) geometry = r.geometry;
        } catch {
          /* treated as no face */
        }
      }
      deleteQuietly(tmp); // the prepared file is no longer needed: we keep base64 in memory only
      if (!geometry) {
        scanStore.set({ photo: null });
        router.replace({ pathname: '/scan/camera', params: { hint: 'noface' } });
        return;
      }
      scanStore.set({ geometry });
      setExposure(exp.exposure);
    }, 50);
    return () => clearTimeout(id);
  }, [photo, tmp]);

  if (!photo) return <Screen />;
  const w = width - space.xl * 2;
  const h = (w * photo.height) / photo.width;

  return (
    <Screen>
      <View style={{ flex: 1, padding: space.xl, gap: space.lg }}>
        <Text variant="title" weight="semibold">{t('check.title')}</Text>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Image
            source={{ uri: `data:image/jpeg;base64,${photo.base64}` }}
            style={{ width: w, height: Math.min(h, 520), borderRadius: radius.xl }}
            resizeMode="cover"
          />
          {exposure === null && (
            <View style={{ position: 'absolute', alignItems: 'center', gap: space.sm }}>
              <ActivityIndicator color={p.accent} />
              <Text variant="small" color="#fff">{t('check.checking')}</Text>
            </View>
          )}
        </View>
        {exposure === 'too_dark' && (
          <Card tone="accent">
            <Text weight="medium">{t('check.tooDark')}</Text>
          </Card>
        )}
        {exposure === 'too_bright' && (
          <Card tone="accent">
            <Text weight="medium">{t('check.tooBright')}</Text>
          </Card>
        )}
        <View style={{ gap: space.sm }}>
          <Button
            title={t('check.use')}
            disabled={exposure === null}
            kind={exposure === 'ok' ? 'primary' : 'secondary'}
            onPress={() => router.replace('/scan/questions')}
          />
          <Button
            title={t('check.retake')}
            kind={exposure === 'ok' ? 'ghost' : 'primary'}
            onPress={() => {
              scanStore.set({ photo: null, geometry: null });
              router.replace('/scan/camera');
            }}
          />
        </View>
      </View>
    </Screen>
  );
}
