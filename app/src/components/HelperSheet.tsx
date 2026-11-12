// "I'm not sure" skin helper. Stateless backend: every call sends the turns so far.
// The backend enforces the 3-clue cap; this sheet never forces a guess on the user.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import type { ClarifyResponse, ClarifyTurn, HelperQuestionId } from '@skinfix/shared';
import { api, errorKey } from '@/lib/api';
import { currentLanguage } from '@/lib/i18n';
import { useScan } from '@/lib/scanStore';
import { radius, space, usePalette } from '@/theme';
import { Button, Card, ConfidenceMeter, OptionCard, ProgressDots, Text } from './ui';
import { Icon } from './icons';

export interface HelperResult {
  value: string | null;
  source: 'helper' | 'unsure';
  confidence: 'low' | 'medium' | 'high';
  also_possible: string | null;
}

const TISSUE_RESULTS = ['none', 'tzone', 'all', 'patchy'] as const;

export function HelperSheet({
  visible,
  questionId,
  startWithTest = false,
  onClose,
  onDone,
}: {
  visible: boolean;
  questionId: HelperQuestionId;
  /** Re-check mode: open straight on the tissue test. */
  startWithTest?: boolean;
  onClose: () => void;
  onDone: (r: HelperResult) => void;
}) {
  const { t } = useTranslation();
  const p = usePalette();
  const photo = useScan((s) => s.photo);
  const [turns, setTurns] = useState<ClarifyTurn[]>([]);
  const [res, setRes] = useState<ClarifyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timerEnd, setTimerEnd] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [askResult, setAskResult] = useState(false);
  const qKey = questionId === 'skin_feel' ? 'q1' : 'q2';

  const call = useCallback(
    async (nextTurns: ClarifyTurn[], force = false) => {
      if (!photo) return;
      setLoading(true);
      setError(null);
      try {
        const r = await api.clarify({ question_id: questionId, image_base64: photo.base64, turns: nextTurns, language: currentLanguage(), force_answer: force });
        setRes(r);
      } catch (e) {
        setError(t(errorKey(e)));
      } finally {
        setLoading(false);
      }
    },
    [photo, questionId, t],
  );

  useEffect(() => {
    if (!visible) return;
    setTurns([]);
    setRes(null);
    setTimerEnd(null);
    setAskResult(false);
    if (startWithTest) {
      setRes({
        status: 'suggest_test',
        clue_number: 1,
        message: t('results.recheckBody'),
        options: [],
        test: { name: t('helper.testName'), steps: [], wait_minutes: 60 },
        answer: null,
      });
    } else call([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!timerEnd) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [timerEnd]);

  const answerClue = (answered: string) => {
    if (!res) return;
    const next = [...turns, { kind: 'clue' as const, asked: res.message, answered }];
    setTurns(next);
    call(next);
  };

  const testDone = (resultLabel: string) => {
    const next = [...turns, { kind: 'test' as const, asked: `${res?.test?.name ?? 'Tissue test'}: where did the tissue pick up oil?`, answered: resultLabel }];
    setTurns(next);
    setAskResult(false);
    setTimerEnd(null);
    call(next);
  };

  const skipTest = () => {
    const next = [...turns, { kind: 'test' as const, asked: res?.test?.name ?? 'Tissue test', answered: 'skipped' }];
    setTurns(next);
    call(next, true);
  };

  const leaveUnsure = () => onDone({ value: null, source: 'unsure', confidence: 'low', also_possible: null });

  const clueTotal = 3;
  const clueIdx = Math.min((res?.clue_number ?? 1) - 1, clueTotal - 1);
  const minsLeft = timerEnd ? Math.max(0, Math.ceil((timerEnd - now) / 60000)) : null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('common.close')} />
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          style={{ backgroundColor: p.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '88%', paddingBottom: space.xl }}
        >
          <View style={{ alignItems: 'center', paddingTop: space.sm }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: p.border }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
            <Text variant="heading" weight="semibold">{t('helper.intro')}</Text>
            {res?.status === 'asking' && (
              <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
                <ProgressDots total={clueTotal} current={clueIdx} />
                <Text variant="tiny" muted>{t('helper.clue', { n: clueIdx + 1, total: clueTotal })}</Text>
              </View>
            )}

            {loading && (
              <Card style={{ alignItems: 'center', gap: space.sm }}>
                <ActivityIndicator color={p.accent} />
                <Text muted variant="small">{t('helper.thinking')}</Text>
              </Card>
            )}

            {!loading && error && (
              <Card style={{ gap: space.md }}>
                <Text>{t('helper.error')}</Text>
                <Text variant="small" muted>{error}</Text>
                <Button title={t('common.retry')} kind="secondary" onPress={() => call(turns)} />
                <Button title={t('helper.leave')} kind="ghost" onPress={leaveUnsure} />
              </Card>
            )}

            {!loading && !error && res?.status === 'asking' && (
              <Animated.View key={res.message} entering={FadeIn.duration(250)} style={{ gap: space.md }}>
                <Text variant="heading">{res.message}</Text>
                {res.options.map((o) => (
                  <OptionCard key={o} label={o} selected={false} onPress={() => answerClue(o)} />
                ))}
                <OptionCard label={t('common.notSure')} selected={false} onPress={() => answerClue('Not sure')} />
              </Animated.View>
            )}

            {!loading && !error && res?.status === 'suggest_test' && (
              <Animated.View entering={FadeIn.duration(250)} style={{ gap: space.md }}>
                <Text>{res.message}</Text>
                <Card style={{ gap: space.sm }}>
                  <Row icon="clock" title={res.test?.name ?? ''} />
                  {(res.test?.steps.length ? res.test.steps : [t('helper.tissue1'), t('helper.tissue2'), t('helper.tissue3'), t('helper.tissue4')]).map((s, i) => (
                    <Text key={i} variant="small">{`${i + 1}. ${s}`}</Text>
                  ))}
                </Card>
                {!askResult && (
                  <>
                    {minsLeft === null ? (
                      <Button title={t('helper.startTimer')} onPress={() => setTimerEnd(Date.now() + (res.test?.wait_minutes ?? 60) * 60_000)} />
                    ) : (
                      <Card tone="alt">
                        <Text center weight="medium">{t('helper.timerLeft', { min: minsLeft })}</Text>
                      </Card>
                    )}
                    <Button title={t('helper.testDone')} kind="secondary" onPress={() => setAskResult(true)} />
                    {!startWithTest && <Button title={t('helper.skip')} kind="ghost" onPress={skipTest} />}
                  </>
                )}
                {askResult && (
                  <View style={{ gap: space.sm }}>
                    <Text weight="semibold">{t('helper.testResultPrompt')}</Text>
                    {TISSUE_RESULTS.map((k) => (
                      <OptionCard key={k} label={t(`helper.testResults.${k}`)} selected={false} onPress={() => testDone(t(`helper.testResults.${k}`, { lng: 'en' }))} />
                    ))}
                  </View>
                )}
              </Animated.View>
            )}

            {!loading && !error && res?.status === 'answered' && res.answer && (
              <Animated.View entering={FadeIn.duration(300)} style={{ gap: space.md }}>
                <Card tone="accent" style={{ gap: space.sm }}>
                  <Text variant="title" weight="semibold">{res.message}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <ConfidenceMeter level={res.answer.confidence} />
                    <Text variant="small" weight="medium">{t(`helper.confidence.${res.answer.confidence}`)}</Text>
                  </View>
                  <Text variant="small">{res.answer.why}</Text>
                  {res.answer.also_possible && (
                    <Text variant="small" muted>{t('helper.alsoPossible', { value: t(`questions.${qKey}.${res.answer.also_possible}`) })}</Text>
                  )}
                  <Text variant="small" muted>{t('helper.whatWouldChange', { text: res.answer.what_would_change_it })}</Text>
                </Card>
                <Button
                  title={t('helper.use')}
                  onPress={() =>
                    onDone({ value: res.answer!.value, source: 'helper', confidence: res.answer!.confidence, also_possible: res.answer!.also_possible })
                  }
                />
                <Button title={t('helper.leave')} kind="ghost" onPress={leaveUnsure} />
              </Animated.View>
            )}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function Row({ icon, title }: { icon: 'clock'; title: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Icon name={icon} color={p.accent} />
      <Text weight="semibold">{title}</Text>
    </View>
  );
}
