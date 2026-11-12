import { Linking, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { PickedListing } from '@skinfix/shared';
import { radius, space, usePalette } from '@/theme';
import { Button, Card, Skeleton, Text } from './ui';
import { Icon } from './icons';

const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(2));

export function ListingCard({ l }: { l: PickedListing }) {
  const { t } = useTranslation();
  const p = usePalette();
  return (
    <Card style={{ flexDirection: 'row', gap: space.md, padding: space.md }}>
      <Image
        source={{ uri: l.image }}
        style={{ width: 84, height: 84, borderRadius: radius.md, backgroundColor: '#fff' }}
        contentFit="contain"
        transition={200}
        accessibilityIgnoresInvertColors
      />
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="small" weight="medium" numberOfLines={2}>{l.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
          <Text weight="bold">{`AED ${fmt(l.price_aed)}`}</Text>
          {l.original_price_aed && <Text variant="tiny" muted style={{ textDecorationLine: 'line-through' }}>{t('results.was', { price: fmt(l.original_price_aed) })}</Text>}
        </View>
        {l.rating !== null && (
          <Text variant="tiny" muted>{`★ ${l.rating.toFixed(1)}${l.rating_count ? ` · ${t('results.reviews', { count: l.rating_count })}` : ''}`}</Text>
        )}
        {l.reason && <Text variant="tiny" muted numberOfLines={2}>{l.reason}</Text>}
        <Button
          title={t('results.openOnNoon')}
          kind="secondary"
          icon={<Icon name="external" size={16} color={p.text} />}
          style={{ minHeight: 40, alignSelf: 'flex-start', paddingHorizontal: space.lg, marginTop: 4 }}
          onPress={() => Linking.openURL(l.url)}
        />
      </View>
    </Card>
  );
}

export function ListingSkeleton() {
  return (
    <Card style={{ flexDirection: 'row', gap: space.md, padding: space.md }}>
      <Skeleton style={{ width: 84, height: 84 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton style={{ height: 14, width: '90%' }} />
        <Skeleton style={{ height: 14, width: '60%' }} />
        <Skeleton style={{ height: 18, width: '35%' }} />
        <Skeleton style={{ height: 36, width: '50%', borderRadius: 18 }} />
      </View>
    </Card>
  );
}
