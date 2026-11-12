import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, Screen, Text } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ResultsView } from '@/components/ResultsView';
import { ShareCard } from '@/components/ShareCard';
import { HelperSheet } from '@/components/HelperSheet';
import { currentLanguage } from '@/lib/i18n';
import { loadListings } from '@/lib/products';
import { useNoonFetcher } from '@/lib/noonWebView';
import { clearDraft, scanStore, useScan, type ListingState } from '@/lib/scanStore';
import { saveScan, updateListings } from '@/lib/history';
import { space } from '@/theme';

export default function Results() {
  const { t } = useTranslation();
  const result = useScan((s) => s.result);
  const geometry = useScan((s) => s.geometry);
  const photo = useScan((s) => s.photo);
  const listings = useScan((s) => s.listings);
  const budget = useScan((s) => s.answers.budget_aed);
  const { fetchPage, element: webview } = useNoonFetcher();
  const [share, setShare] = useState(false);
  const [recheck, setRecheck] = useState(false);
  const started = useRef(false);

  const setListing = useCallback((i: number, l: ListingState) => {
    scanStore.set((s) => {
      const next = [...s.listings];
      next[i] = l;
      return { listings: next };
    });
  }, []);

  const load = useCallback(
    async (i: number) => {
      const r = scanStore.get().result;
      if (!r) return;
      setListing(i, { state: 'loading' });
      const l = await loadListings(r, i, currentLanguage(), scanStore.get().answers.budget_aed, fetchPage);
      setListing(i, l);
    },
    [fetchPage, setListing],
  );

  // Kick off listings right away (the map reveal plays meanwhile) and save to history.
  useEffect(() => {
    if (started.current || !result || !geometry) return;
    started.current = true;
    clearDraft();
    const saved = saveScan({ geometry, result, listings: [] }, photo?.base64 ?? null).catch(() => null);
    Promise.all(result.profile.products.map((_, i) => load(i))).then(async () => {
      const entry = await saved;
      if (entry) updateListings(entry.id, scanStore.get().listings);
    });
  }, [result, geometry, photo, load]);

  if (!result || !geometry) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
          <Button title={t('results.newScan')} onPress={() => router.replace('/welcome')} />
        </View>
      </Screen>
    );
  }

  const newScan = () => {
    scanStore.reset(); // drops the in-memory photo
    router.replace('/welcome');
  };

  return (
    <Screen>
      {webview}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md }}>
        <Text variant="title" weight="semibold" style={{ paddingHorizontal: space.sm }}>{t('results.title')}</Text>
        <View style={{ flexDirection: 'row' }}>
          <IconButton label={t('results.share')} onPress={() => setShare(true)}>
            <Icon name="share" />
          </IconButton>
          <IconButton label={t('common.settings')} onPress={() => router.push('/settings')}>
            <Icon name="gear" />
          </IconButton>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.xl, paddingTop: space.md, gap: space.lg }}>
        <ResultsView
          result={result}
          geometry={geometry}
          photoBase64={photo?.base64 ?? null}
          listings={listings}
          reveal
          onRetryListings={load}
          onRecheck={() => setRecheck(true)}
        />
        <Button title={t('results.share')} kind="secondary" icon={<Icon name="share" size={18} />} onPress={() => setShare(true)} />
        <Button title={t('results.newScan')} kind="ghost" onPress={newScan} />
      </ScrollView>
      <ShareCard visible={share} onClose={() => setShare(false)} geometry={geometry} result={result} />
      {recheck && (
        <HelperSheet
          visible
          questionId="skin_feel"
          startWithTest
          onClose={() => setRecheck(false)}
          onDone={(r) => {
            setRecheck(false);
            if (r.source !== 'helper' || !r.value) return;
            scanStore.setAnswers({ skin_feel: r as never });
            scanStore.set({ result: null, listings: [] });
            router.replace('/scan/analyzing');
          }}
        />
      )}
    </Screen>
  );
}
