import { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { Card, IconButton, Screen, Text, Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { LanguageToggle } from '@/components/LanguageToggle';
import { getInvite } from '@/lib/secure';
import { clearHistory, getSavePhotos, setSavePhotos } from '@/lib/history';
import { space, usePalette } from '@/theme';

export default function Settings() {
  const { t } = useTranslation();
  const p = usePalette();
  const [savePhotos, setSave] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    getSavePhotos().then(setSave);
    getInvite().then(setCode);
  }, []);

  const masked = code ? `${code.slice(0, 2)}${'•'.repeat(Math.max(0, code.length - 2))}` : '';

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.md }}>
        <IconButton label={t('common.back')} onPress={() => router.back()}>
          <Icon name="back" />
        </IconButton>
        <Text variant="title" weight="semibold">{t('settings.title')}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.xl, paddingTop: space.sm, gap: space.md }}>
        <Card style={{ gap: space.md }}>
          <Text weight="semibold">{t('settings.language')}</Text>
          <LanguageToggle route="/settings" />
        </Card>

        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text weight="semibold">{t('settings.savePhotos')}</Text>
            <Text variant="small" muted>{t('settings.savePhotosHint')}</Text>
          </View>
          <Switch
            value={savePhotos}
            onValueChange={(v) => {
              setSave(v);
              setSavePhotos(v);
            }}
            trackColor={{ true: p.accent, false: p.border }}
            thumbColor={p.surface}
          />
        </Card>

        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text weight="semibold">{t('settings.invite')}</Text>
            <Text variant="small" muted>{masked}</Text>
          </View>
          <Button title={t('settings.change')} kind="secondary" onPress={() => router.push('/invite')} />
        </Card>

        <Card style={{ gap: space.md }}>
          <Text weight="semibold">{t('settings.clearHistory')}</Text>
          <Button
            title={cleared ? t('settings.cleared') : t('settings.clearHistory')}
            kind="secondary"
            disabled={cleared}
            onPress={() =>
              Alert.alert(t('settings.clearConfirmTitle'), t('settings.clearConfirmBody'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('settings.clear'),
                  style: 'destructive',
                  onPress: async () => {
                    await clearHistory();
                    setCleared(true);
                  },
                },
              ])
            }
          />
        </Card>

        <Text variant="tiny" muted center>{t('settings.version', { version: Constants.expoConfig?.version ?? '' })}</Text>
      </ScrollView>
    </Screen>
  );
}
