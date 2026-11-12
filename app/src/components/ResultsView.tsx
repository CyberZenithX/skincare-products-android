// The results body, shared by the live results screen and reopened history scans.

import { useState } from 'react';
import { Linking, Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown, SlideInDown, ZoomIn } from 'react-native-reanimated';
import { FINDINGS, type AnalyzeResponse, type SkinMapGeometry, type ZoneId } from '@skinfix/shared';
import { FINDING_COLORS, radius, space, usePalette } from '@/theme';
import type { ListingState } from '@/lib/scanStore';
import { currentLanguage } from '@/lib/i18n';
import { SkinMap, useSkiaPhoto, type MapMode } from './SkinMap';
import { Button, Card, Chip, Text } from './ui';
import { ListingCard, ListingSkeleton } from './ListingCard';
import { Icon } from './icons';

export function ResultsView({
  result,
  geometry,
  photoBase64,
  listings,
  reveal,
  onRetryListings,
  onRecheck,
}: {
  result: AnalyzeResponse;
  geometry: SkinMapGeometry;
  photoBase64: string | null;
  listings: ListingState[];
  reveal: boolean;
  onRetryListings?: (i: number) => void;
  onRecheck?: () => void;
}) {
  const { t } = useTranslation();
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<MapMode>('map');
  const [revealed, setRevealed] = useState(!reveal);
  const [zone, setZone] = useState<ZoneId | null>(null);
  const skPhoto = useSkiaPhoto(photoBase64);
  const prof = result.profile;
  const uncertain = prof.confidence !== 'high' || prof.also_possible.length > 0;
  const mapWidth = Math.min(width - space.xl * 2, 380);

  return (
    <View style={{ gap: space.lg }}>
      {/* ---- Skin Map hero */}
      <View style={{ alignItems: 'center', gap: space.md }}>
        <SkinMap
          geometry={geometry}
          zones={prof.zones}
          mode={mode}
          photo={skPhoto}
          width={mapWidth}
          reveal={reveal}
          onRevealDone={() => setRevealed(true)}
          selected={zone}
          onZonePress={setZone}
        />
        {skPhoto && (
          <View style={{ flexDirection: 'row', backgroundColor: p.surfaceAlt, borderRadius: radius.pill, padding: 3 }}>
            {(['map', 'photo'] as const).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === m }}
                onPress={() => setMode(m)}
                style={{ paddingHorizontal: 18, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: mode === m ? p.surface : 'transparent' }}
              >
                <Text variant="small" weight={mode === m ? 'semibold' : 'regular'}>{t(`results.${m}`)}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text variant="tiny" muted center>{t('results.tapZone')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, justifyContent: 'center' }}>
          {FINDINGS.map((f) => (
            <Chip key={f} label={t(`findings.${f}`)} color={FINDING_COLORS[f]} tone="outline" />
          ))}
        </View>
      </View>

      {/* ---- type chips + summary */}
      {revealed && (
        <Animated.View entering={ZoomIn.springify().damping(14)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip label={uncertain ? t('results.mostLikely', { type: t(`skinType.${prof.skin_type}`) }) : t(`skinType.${prof.skin_type}`)} tone="accent" />
          <Chip label={t('results.sensitivity', { level: t(`sensitivityLevel.${prof.sensitivity}`) })} />
          {uncertain && <Chip label={t('results.notFullySure')} tone="outline" />}
        </Animated.View>
      )}
      <Animated.View entering={FadeInDown.delay(reveal ? 2600 : 0)} style={{ gap: space.sm }}>
        <Text>{prof.summary}</Text>
        {uncertain && (
          <Card tone="alt" style={{ gap: space.sm }}>
            {prof.also_possible.length > 0 && (
              <Text variant="small">{t('helper.alsoPossible', { value: prof.also_possible.map((x) => t(`skinType.${x}`)).join(', ') })}</Text>
            )}
            {!!prof.how_to_confirm && <Text variant="small" muted>{prof.how_to_confirm}</Text>}
            {onRecheck && <Button title={t('results.recheck')} kind="secondary" onPress={onRecheck} />}
          </Card>
        )}
        {result.text_language !== currentLanguage() && (
          <Text variant="tiny" muted>{t('results.englishFallback')}</Text>
        )}
      </Animated.View>

      {/* ---- red flags */}
      {prof.red_flags.length > 0 && (
        <Card style={{ gap: space.sm, borderColor: p.danger }}>
          <Text weight="semibold">{t('results.dermTitle')}</Text>
          <Text variant="small" muted>{t('results.dermBody')}</Text>
          {prof.red_flags.map((f, i) => (
            <Text key={i} variant="small">{`• ${f.note}`}</Text>
          ))}
          <Text variant="small" muted>{t('results.dermNoProducts')}</Text>
        </Card>
      )}

      {/* ---- your fix */}
      <Card tone="accent" style={{ gap: 4 }}>
        <Text variant="tiny" weight="semibold" color={p.accent}>{t('results.mainFocus').toUpperCase()}</Text>
        <Text variant="title" weight="semibold">{t(`concern.${prof.main_concern}`)}</Text>
      </Card>

      {prof.products.length === 0 && (
        <Card>
          <Text>{t('results.noProducts')}</Text>
        </Card>
      )}
      {result.adjustments.some((a) => a.action === 'dropped') && <Text variant="tiny" muted>{t('results.adjusted')}</Text>}

      {prof.products.map((prod, i) => {
        const display = result.product_display[i] ?? prod;
        const ls = listings[i] ?? { state: 'loading' as const };
        return (
          <View key={i} style={{ gap: space.md }}>
            <Card style={{ gap: space.md }}>
              <Text variant="heading" weight="semibold">{display.category}</Text>
              <Text>{prod.why}</Text>
              <Section label={t('results.keyIngredients')}>
                {display.key_ingredients.map((k) => (
                  <Chip key={k} label={k} tone="accent" />
                ))}
              </Section>
              {display.avoid_ingredients.length > 0 && (
                <Section label={t('results.avoid')}>
                  {display.avoid_ingredients.map((k) => (
                    <Chip key={k} label={k} tone="outline" />
                  ))}
                </Section>
              )}
              <View style={{ gap: 4 }}>
                <Text variant="tiny" weight="semibold" muted>{t('results.howToUse')}</Text>
                <Text variant="small">{prod.how_to_use}</Text>
              </View>
              {prod.patch_test && (
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                  <Icon name="shield" size={18} color={p.accent} />
                  <Text variant="small" style={{ flex: 1 }}>{t('results.patchTest')}</Text>
                </View>
              )}
            </Card>

            {ls.state === 'loading' && [0, 1, 2].map((k) => <ListingSkeleton key={k} />)}
            {ls.state === 'ok' && ls.listings.map((l) => <ListingCard key={l.id} l={l} />)}
            {ls.state === 'ok' && ls.listings.length < 3 && <Text variant="small" muted>{t('results.noListings')}</Text>}
            {ls.state === 'error' && (
              <Card style={{ gap: space.sm }}>
                <Text variant="small">{t('results.listingsError')}</Text>
                {onRetryListings && <Button title={t('common.retry')} kind="secondary" onPress={() => onRetryListings(i)} />}
              </Card>
            )}
            {ls.state !== 'loading' && (
              <>
                <Button title={t('results.seeMore')} kind="ghost" icon={<Icon name="external" size={16} />} onPress={() => Linking.openURL(ls.search_url)} />
                {ls.state === 'ok' && ls.listings.length > 0 && <Text variant="tiny" muted center>{t('results.pricesNote')}</Text>}
              </>
            )}
          </View>
        );
      })}

      <Text variant="tiny" muted center>{t('results.disclaimer')}</Text>

      <ZoneSheet zone={zone} result={result} onClose={() => setZone(null)} />
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="tiny" weight="semibold" muted>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{children}</View>
    </View>
  );
}

function ZoneSheet({ zone, result, onClose }: { zone: ZoneId | null; result: AnalyzeResponse; onClose: () => void }) {
  const { t } = useTranslation();
  const p = usePalette();
  if (!zone) return null;
  const z = result.profile.zones[zone];
  const found = FINDINGS.filter((f) => z[f] > 0).sort((a, b) => z[b] - z[a]);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <Animated.View entering={SlideInDown.springify().damping(18)} style={{ backgroundColor: p.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.md }}>
        <Text variant="title" weight="semibold">{t(`zones.${zone}`)}</Text>
        {z.note ? <Text>{z.note}</Text> : null}
        {found.length === 0 && !z.note && <Text muted>{t('results.nothingNoticed')}</Text>}
        <View style={{ gap: space.sm }}>
          {found.map((f) => (
            <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: FINDING_COLORS[f] }} />
              <Text style={{ flex: 1 }}>{t(`findings.${f}`)}</Text>
              <Text muted>{t(`levels.${z[f]}`)}</Text>
            </View>
          ))}
        </View>
        <Button title={t('common.close')} kind="secondary" onPress={onClose} />
      </Animated.View>
    </Modal>
  );
}
