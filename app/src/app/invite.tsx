import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Screen, Text } from '@/components/ui';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Icon } from '@/components/icons';
import { api, ApiError, errorKey } from '@/lib/api';
import { setInvite } from '@/lib/secure';
import { font, radius, space, usePalette } from '@/theme';

export default function Invite() {
  const { t } = useTranslation();
  const p = usePalette();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.verify(code);
      await setInvite(code);
      router.replace(router.canGoBack() ? '/settings' : '/welcome');
    } catch (e) {
      setError(e instanceof ApiError && e.kind === 'unauthorized' ? t('invite.invalid') : t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, padding: space.xl }}>
        <View style={{ alignItems: 'flex-end' }}>
          <LanguageToggle route="/invite" />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={30} color={p.accent} />
          </View>
          <Text variant="display" weight="semibold">{t('invite.title')}</Text>
          <Text muted>{t('invite.subtitle')}</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder={t('invite.placeholder')}
            placeholderTextColor={p.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={submit}
            style={{
              fontFamily: font('medium'),
              fontSize: 18,
              color: p.text,
              backgroundColor: p.surface,
              borderColor: error ? p.danger : p.border,
              borderWidth: 1.5,
              borderRadius: radius.lg,
              paddingHorizontal: space.lg,
              height: 58,
              textAlign: 'left',
            }}
          />
          {error && <Text variant="small" color={p.danger}>{error}</Text>}
        </View>
        <Button title={busy ? t('invite.checking') : t('invite.button')} onPress={submit} loading={busy} disabled={!code.trim()} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
