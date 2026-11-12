import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInRight, FadeInLeft } from 'react-native-reanimated';
import { AVOID, BUDGET, CONDITIONS, MAIN_BOTHER, REACTIVITY, SKIN_FEEL, type AvoidOption, type ConditionOption } from '@skinfix/shared';
import { Button, IconButton, OptionCard, ProgressDots, Screen, Text } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BudgetSlider } from '@/components/BudgetSlider';
import { HelperSheet, type HelperResult } from '@/components/HelperSheet';
import { scanStore, toAnswers, useScan, type HelperAnswer } from '@/lib/scanStore';
import { font, radius, space, usePalette } from '@/theme';

const TOTAL = 6;
const AUTO_ADVANCE_MS = 260;

/** "None" / "Not sure" can't be combined with anything else. */
function toggleMulti<T extends string>(list: T[], v: T, exclusive: readonly T[]): T[] {
  if (list.includes(v)) return list.filter((x) => x !== v);
  if (exclusive.includes(v)) return [v];
  return [...list.filter((x) => !exclusive.includes(x)), v];
}

export default function Questions() {
  const { t } = useTranslation();
  const p = usePalette();
  const step = useScan((s) => s.step);
  const a = useScan((s) => s.answers);
  const [dir, setDir] = useState<1 | -1>(1);
  const [helper, setHelper] = useState<null | 'skin_feel' | 'reactivity'>(null);

  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    scanStore.set({ step: n });
  };
  const back = () => (step === 0 ? router.replace('/scan/camera') : go(step - 1));
  const advance = () => setTimeout(() => go(Math.min(step + 1, TOTAL - 1)), AUTO_ADVANCE_MS);

  const setHelperAnswer = (q: 'skin_feel' | 'reactivity', r: HelperAnswer<string>) => {
    scanStore.setAnswers({ [q]: r } as never);
    setHelper(null);
    advance();
  };

  const userPick = <T extends string>(q: 'skin_feel' | 'reactivity', v: T) => {
    scanStore.setAnswers({ [q]: { value: v, source: 'user', confidence: 'high', also_possible: null } } as never);
    advance();
  };

  const canAnalyze = !!toAnswers(a);
  const Enter = dir === 1 ? FadeInRight : FadeInLeft;

  let body: React.ReactNode;
  switch (step) {
    case 0:
    case 1: {
      const q = step === 0 ? 'skin_feel' : 'reactivity';
      const k = step === 0 ? 'q1' : 'q2';
      const opts = step === 0 ? SKIN_FEEL : REACTIVITY;
      const cur = a[q];
      body = (
        <>
          <Text variant="title" weight="semibold">{t(`questions.${k}.title`)}</Text>
          {opts.map((o) => (
            <OptionCard key={o} label={t(`questions.${k}.${o}`)} selected={cur?.source !== 'unsure' && cur?.value === o} onPress={() => userPick(q, o)} />
          ))}
          <OptionCard label={t(`questions.${k}.unsure`)} selected={cur?.source === 'unsure'} onPress={() => setHelper(q)} icon={<Icon name="chat" size={18} color={p.accent} />} />
          {cur?.source === 'helper' && cur.value && (
            <Text variant="small" muted>{`✓ ${t(`questions.${k}.${cur.value}`)} · ${t(`helper.confidence.${cur.confidence}`)}`}</Text>
          )}
        </>
      );
      break;
    }
    case 2:
      body = (
        <>
          <Text variant="title" weight="semibold">{t('questions.q3.title')}</Text>
          {MAIN_BOTHER.map((o) => (
            <OptionCard key={o} label={t(`questions.q3.${o}`)} selected={a.main_bother === o} onPress={() => (scanStore.setAnswers({ main_bother: o }), advance())} />
          ))}
          <OptionCard label={t('questions.q3.unsure')} selected={a.main_bother === null} onPress={() => (scanStore.setAnswers({ main_bother: null }), advance())} />
        </>
      );
      break;
    case 3:
      body = (
        <>
          <Text variant="title" weight="semibold">{t('questions.q4.title')}</Text>
          <Text variant="small" muted>{t('questions.q4.hint')}</Text>
          {AVOID.map((o) => (
            <OptionCard
              key={o}
              multi
              label={t(`questions.q4.${o}`)}
              selected={a.avoid.includes(o)}
              onPress={() => scanStore.setAnswers({ avoid: toggleMulti<AvoidOption>(a.avoid, o, ['nothing', 'unsure']) })}
            />
          ))}
          {a.avoid.includes('other') && (
            <TextInput
              value={a.avoid_other}
              onChangeText={(v) => scanStore.setAnswers({ avoid_other: v.slice(0, 80) })}
              placeholder={t('questions.q4.otherPlaceholder')}
              placeholderTextColor={p.textMuted}
              style={{ fontFamily: font('regular'), fontSize: 16, color: p.text, backgroundColor: p.surface, borderColor: p.border, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: space.lg, height: 54, textAlign: 'left' }}
            />
          )}
        </>
      );
      break;
    case 4:
      body = (
        <>
          <Text variant="title" weight="semibold">{t('questions.q5.title')}</Text>
          <Text variant="small" muted>{t('questions.q5.reason')}</Text>
          {CONDITIONS.map((o) => (
            <OptionCard
              key={o}
              multi
              label={t(`questions.q5.${o}`)}
              selected={a.conditions.includes(o)}
              onPress={() => scanStore.setAnswers({ conditions: toggleMulti<ConditionOption>(a.conditions, o, ['none', 'unsure']) })}
            />
          ))}
        </>
      );
      break;
    default:
      body = (
        <>
          <Text variant="title" weight="semibold">{t('questions.budget.title')}</Text>
          <Text variant="display" weight="bold" color={p.accent} style={{ marginTop: space.lg }}>
            {t('questions.budget.value', { value: a.budget_aed })}
          </Text>
          <BudgetSlider min={BUDGET.min} max={BUDGET.max} step={BUDGET.step} value={a.budget_aed} onChange={(v) => scanStore.setAnswers({ budget_aed: v })} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="tiny" muted>{t('questions.budget.value', { value: BUDGET.min })}</Text>
            <Text variant="tiny" muted>{t('questions.budget.value', { value: BUDGET.max })}</Text>
          </View>
          <Text variant="small" muted>{t('questions.budget.hint')}</Text>
        </>
      );
  }

  const multiStepDone = step === 3 ? a.avoid.length > 0 && (!a.avoid.includes('other') || a.avoid_other.trim().length > 1) : step === 4 ? a.conditions.length > 0 : true;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingTop: space.sm }}>
        <IconButton label={t('common.back')} onPress={back}>
          <Icon name="back" />
        </IconButton>
        <View style={{ flex: 1 }}>
          <ProgressDots total={TOTAL} current={step} />
        </View>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <Text variant="tiny" muted>{t('questions.progress', { current: step + 1, total: TOTAL })}</Text>
        <Animated.View key={step} entering={Enter.duration(260)} style={{ gap: space.md }}>
          {body}
        </Animated.View>
      </ScrollView>
      {(step >= 3) && (
        <View style={{ padding: space.xl, paddingTop: 0 }}>
          {step < TOTAL - 1 ? (
            <Button title={t('questions.next')} disabled={!multiStepDone} onPress={() => go(step + 1)} />
          ) : (
            <Button title={t('questions.analyze')} disabled={!canAnalyze} onPress={() => router.replace('/scan/analyzing')} />
          )}
        </View>
      )}
      {helper && (
        <HelperSheet
          visible
          questionId={helper}
          onClose={() => setHelper(null)}
          onDone={(r: HelperResult) => setHelperAnswer(helper, r as HelperAnswer<string>)}
        />
      )}
    </Screen>
  );
}
