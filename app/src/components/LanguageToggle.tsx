import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Language } from '@skinfix/shared';
import { setLanguage, currentLanguage } from '@/lib/i18n';
import { saveDraft } from '@/lib/scanStore';
import { radius, usePalette } from '@/theme';
import { Text } from './ui';

/** "English / العربية" pill. Saves any scan in progress before the RTL reload. */
export function LanguageToggle({ route }: { route: string }) {
  const { t } = useTranslation();
  const p = usePalette();
  const lang = currentLanguage();
  const pick = (l: Language) => {
    if (l === lang) return;
    setLanguage(l, () => saveDraft(route)).catch(() => undefined);
  };
  return (
    <View style={{ flexDirection: 'row', backgroundColor: p.surfaceAlt, borderRadius: radius.pill, padding: 3 }}>
      {(['en', 'ar'] as const).map((l) => (
        <Pressable
          key={l}
          accessibilityRole="button"
          accessibilityState={{ selected: l === lang }}
          onPress={() => pick(l)}
          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: l === lang ? p.surface : 'transparent' }}
        >
          <Text variant="small" weight={l === lang ? 'semibold' : 'regular'}>
            {l === 'en' ? t('common.english') : t('common.arabic')}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
