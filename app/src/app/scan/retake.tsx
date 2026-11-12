import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text } from '@/components/ui';
import { Icon } from '@/components/icons';
import { scanStore, useScan } from '@/lib/scanStore';
import { space, usePalette } from '@/theme';

/** Gemini said the photo can't be judged: show its specific tip, keep the answers. */
export default function Retake() {
  const { t } = useTranslation();
  const p = usePalette();
  const q = useScan((s) => s.result?.profile.photo_quality);
  const issue = q?.issue && q.issue !== 'none' ? q.issue : 'other';
  return (
    <Screen>
      <View style={{ flex: 1, padding: space.xl, justifyContent: 'center', gap: space.lg }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sun" size={30} color={p.accent} />
        </View>
        <Text variant="title" weight="semibold">{t('retake.title')}</Text>
        <Text>{t(`retake.${issue}`)}</Text>
        {!!q?.tip && (
          <Card tone="accent">
            <Text weight="medium">{q.tip}</Text>
          </Card>
        )}
      </View>
      <View style={{ padding: space.xl }}>
        <Button
          title={t('retake.button')}
          onPress={() => {
            // Keep the answers; only the photo is replaced.
            scanStore.set({ photo: null, geometry: null, result: null, listings: [], step: 5 });
            router.replace('/scan/camera');
          }}
        />
      </View>
    </Screen>
  );
}
