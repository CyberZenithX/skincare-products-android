import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, IconButton, Screen, Text } from '@/components/ui';
import { Icon } from '@/components/icons';
import { SkinMap } from '@/components/SkinMap';
import { ResultsView } from '@/components/ResultsView';
import { listHistory, readPhotoBase64, type HistoryEntry } from '@/lib/history';
import { space } from '@/theme';
import { noonSearchUrl } from '@skinfix/shared';

export default function History() {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  const [open, setOpen] = useState<HistoryEntry | null>(null);
  const [compare, setCompare] = useState(false);

  useEffect(() => {
    listHistory().then(setItems);
  }, []);

  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language === 'ar' ? 'ar-AE' : 'en-AE', { day: 'numeric', month: 'short', year: 'numeric' });

  const header = (title: string, onBack: () => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.md }}>
      <IconButton label={t('common.back')} onPress={onBack}>
        <Icon name="back" />
      </IconButton>
      <Text variant="title" weight="semibold">{title}</Text>
    </View>
  );

  if (open) {
    return (
      <Screen>
        {header(date(open.date), () => setOpen(null))}
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
          <ResultsView result={open.result} geometry={open.geometry} photoBase64={readPhotoBase64(open.photoFile)} listings={open.result.profile.products.map((prod, i) => open.listings[i]?.state === 'ok' ? open.listings[i]! : { state: 'link' as const, search_url: noonSearchUrl(prod.noon_query) })} reveal={false} />
        </ScrollView>
      </Screen>
    );
  }

  if (compare && items && items.length >= 2) {
    const [now, last] = [items[0]!, items[1]!];
    const w = (width - space.xl * 2 - space.md) / 2;
    return (
      <Screen>
        {header(t('history.compare'), () => setCompare(false))}
        <View style={{ flexDirection: 'row', gap: space.md, padding: space.xl }}>
          {[last, now].map((e, i) => (
            <View key={e.id} style={{ gap: space.sm, alignItems: 'center' }}>
              <Text weight="semibold">{i === 0 ? t('history.last') : t('history.now')}</Text>
              <Text variant="tiny" muted>{date(e.date)}</Text>
              <SkinMap geometry={e.geometry} zones={e.result.profile.zones} mode="map" photo={null} width={w} />
              <Chip label={t(`concern.${e.result.profile.main_concern}`)} />
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {header(t('history.title'), () => (router.canGoBack() ? router.back() : router.replace('/welcome')))}
      <FlatList
        data={items ?? []}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: space.xl, gap: space.md }}
        ListEmptyComponent={items ? <Text muted center>{t('history.empty')}</Text> : undefined}
        ListHeaderComponent={items && items.length >= 2 ? <Button title={t('history.compare')} kind="secondary" onPress={() => setCompare(true)} style={{ marginBottom: space.sm }} /> : undefined}
        renderItem={({ item }) => (
          <Pressable onPress={() => setOpen(item)} accessibilityRole="button">
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <SkinMap geometry={item.geometry} zones={item.result.profile.zones} mode="map" photo={null} width={72} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text weight="semibold">{t(`concern.${item.result.profile.main_concern}`)}</Text>
                <Text variant="small" muted>{date(item.date)}</Text>
              </View>
              <Icon name="forward" size={18} />
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
