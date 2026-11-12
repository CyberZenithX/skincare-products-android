import { useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import type { AnalyzeResponse, SkinMapGeometry } from '@skinfix/shared';
import { radius, space, usePalette } from '@/theme';
import { SkinMap } from './SkinMap';
import { Button, Chip, Text } from './ui';

/** Preview + share: a good-looking card that friends will want to share. Never includes the photo. */
export function ShareCard({ visible, onClose, geometry, result }: { visible: boolean; onClose: () => void; geometry: SkinMapGeometry; result: AnalyzeResponse }) {
  const { t } = useTranslation();
  const p = usePalette();
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const [busy, setBusy] = useState(false);
  const prof = result.profile;
  const ingredients = [...new Set(result.product_display.flatMap((d) => d.key_ingredients))].slice(0, 4);

  const share = async () => {
    setBusy(true);
    try {
      const uri = await captureRef(ref as never, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      /* user cancelled or sharing unavailable */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: space.xl, gap: space.lg }}>
        <View ref={ref} collapsable={false} style={{ backgroundColor: p.bg, borderRadius: radius.xl, padding: space.xl, gap: space.md }}>
          <Text variant="heading" weight="semibold">{t('share.title')}</Text>
          <View style={{ alignItems: 'center' }}>
            <SkinMap geometry={geometry} zones={prof.zones} mode="map" photo={null} width={240} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Chip label={t(`skinType.${prof.skin_type}`)} tone="accent" />
            <Chip label={t(`concern.${prof.main_concern}`)} />
          </View>
          {ingredients.length > 0 && (
            <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
              {ingredients.map((i) => (
                <Chip key={i} label={i} tone="outline" />
              ))}
            </View>
          )}
          <Text variant="tiny" muted>{t('share.footer')}</Text>
        </View>
        <Button title={t('results.share')} onPress={share} loading={busy} />
        <Button title={t('common.close')} kind="ghost" onPress={onClose} style={{ backgroundColor: p.surface }} />
      </View>
    </Modal>
  );
}
