import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput, type CameraRef } from 'react-native-vision-camera';
import { createFaceDetectorOutput, transformFacesToPreviewCoordinates, type Face } from 'react-native-vision-camera-face-detector';
import { Canvas, Path, Skia, BlurMask, FillType } from '@shopify/react-native-skia';
import { interpolateColor, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, IconButton, Screen, Text } from '@/components/ui';
import { Icon } from '@/components/icons';
import { evaluateGuide, type GuideHint } from '@skinfix/shared';
import { deleteQuietly, preparePhoto } from '@/lib/photo';
import { scanStore } from '@/lib/scanStore';
import { space, usePalette } from '@/theme';

const HOLD_MS = 1000;
const TIPS_KEY = 'tips:seen';

export default function CameraScreen() {
  const { t } = useTranslation();
  const p = usePalette();
  const { hint: initialHint } = useLocalSearchParams<{ hint?: string }>();
  const { width, height } = useWindowDimensions();
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [focused, setFocused] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tips, setTips] = useState(false);
  const [hint, setHint] = useState<GuideHint>('noFace');
  const [error, setError] = useState<string | null>(initialHint === 'noface' ? t('camera.noFaceOnPhoto') : null);
  const cameraRef = useRef<CameraRef | null>(null);
  const okSince = useRef<number | null>(null);
  const capturing = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      capturing.current = false;
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    AsyncStorage.getItem(TIPS_KEY).then((v) => !v && setTips(true));
  }, []);

  // Oval: centred a little above the middle, face-shaped.
  const oval = useMemo(() => {
    const w = Math.min(width * 0.72, 320);
    const h = w * 1.32;
    return { cx: width / 2, cy: height * 0.42, w, h };
  }, [width, height]);

  // ---- glow: neutral → accent as checks pass
  const progress = useSharedValue(0);
  const strokeColor = useDerivedValue(() => interpolateColor(progress.value, [0, 1], ['rgba(255,255,255,0.55)', p.accent]));
  const ovalPath = useMemo(() => {
    return Skia.PathBuilder.Make()
      .addOval(Skia.XYWHRect(oval.cx - oval.w / 2, oval.cy - oval.h / 2, oval.w, oval.h))
      .build();
  }, [oval]);
  const maskPath = useMemo(() => {
    return Skia.PathBuilder.Make()
      .addRect(Skia.XYWHRect(0, 0, width, height))
      .addOval(Skia.XYWHRect(oval.cx - oval.w / 2, oval.cy - oval.h / 2, oval.w, oval.h))
      .setFillType(FillType.EvenOdd) // darken outside the oval only
      .build();
  }, [oval, width, height]);

  // ---- capture
  const photoOutput = usePhotoOutput({ quality: 0.95, qualityPrioritization: 'quality' });

  const finishCapture = useCallback(async (uri: string, mirrored: boolean, source: 'camera' | 'gallery') => {
    setBusy(true);
    try {
      const prepared = await preparePhoto(uri, mirrored, source);
      if (source === 'camera') deleteQuietly(uri);
      scanStore.set({ photo: { base64: prepared.base64, width: prepared.width, height: prepared.height, source }, geometry: null });
      router.push({ pathname: '/scan/check', params: { tmp: prepared.tempUri } });
    } catch {
      setError(t('camera.error'));
      capturing.current = false;
    } finally {
      setBusy(false);
    }
  }, [t]);

  const capture = useCallback(async () => {
    if (capturing.current) return;
    capturing.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      const file = await photoOutput.capturePhotoToFile({ enableShutterSound: false }, {});
      const uri = file.filePath.startsWith('file://') ? file.filePath : `file://${file.filePath}`;
      await finishCapture(uri, file.isMirrored, 'camera');
    } catch {
      setError(t('camera.error'));
      capturing.current = false;
    }
  }, [photoOutput, finishCapture, t]);

  const pickFromGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
    if (res.canceled || !res.assets[0]) return;
    // Gallery photos are used as-is: we can't know if the phone saved them mirrored.
    await finishCapture(res.assets[0].uri, false, 'gallery');
  };

  // ---- live face checks
  const onFaces = useRef((_faces: Face[]) => {});
  onFaces.current = (faces: Face[]) => {
    if (capturing.current || tips) return;
    const cam = cameraRef.current;
    const view = cam ? transformFacesToPreviewCoordinates(faces, cam) : faces;
    const r = evaluateGuide(view, oval);
    progress.value = withTiming(r.passed / 4, { duration: 180 });
    setHint(r.hint);
    if (r.ok) {
      okSince.current ??= Date.now();
      if (Date.now() - okSince.current >= HOLD_MS) capture();
    } else {
      okSince.current = null;
    }
  };
  const faceOutput = useMemo(
    () =>
      createFaceDetectorOutput({
        onFacesDetected: (f) => onFaces.current(f),
        onError: () => undefined,
        performanceMode: 'fast',
        runContours: false,
        runLandmarks: false,
        runClassifications: false,
        cameraFacing: 'front',
        outputResolution: 'preview',
      }),
    [],
  );

  // ---- states
  if (!hasPermission) {
    return (
      <Screen>
        <View style={{ flex: 1, padding: space.xl, justifyContent: 'center', gap: space.lg }}>
          <Text variant="title" weight="semibold">{t('camera.permissionTitle')}</Text>
          <Text muted>{t('camera.permissionBody')}</Text>
          <Button title={t('camera.permissionButton')} onPress={requestPermission} />
          <Button title={t('camera.gallery')} kind="ghost" onPress={pickFromGallery} />
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {device && (
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={focused && !busy}
          outputs={[photoOutput, faceOutput]}
          resizeMode="cover"
        />
      )}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path path={maskPath} color="rgba(10,9,8,0.55)" />
        <Path path={ovalPath} style="stroke" strokeWidth={8} color={strokeColor} opacity={0.5}>
          <BlurMask blur={10} style="normal" />
        </Path>
        <Path path={ovalPath} style="stroke" strokeWidth={3} color={strokeColor} />
      </Canvas>

      <SafeAreaView style={StyleSheet.absoluteFill} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', padding: space.md }}>
          <IconButton label={t('common.back')} onPress={() => router.back()} style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
            <Icon name="back" color="#fff" />
          </IconButton>
        </View>

        <View style={{ position: 'absolute', top: oval.cy + oval.h / 2 + space.lg, left: space.xl, right: space.xl, alignItems: 'center', gap: space.sm }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 }}>
            <Text weight="medium" color="#fff" center>{t(`camera.${hint}`)}</Text>
          </View>
          {error && <Text variant="small" color="#FFD9CC" center>{error}</Text>}
        </View>

        <View style={{ position: 'absolute', bottom: space.xl, left: space.xl, right: space.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton label={t('camera.gallery')} onPress={pickFromGallery} style={{ backgroundColor: 'rgba(0,0,0,0.35)', width: 52, height: 52, borderRadius: 26 }}>
            <Icon name="gallery" color="#fff" />
          </IconButton>
          <IconButton label={t('camera.manual')} onPress={capture} style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.25)' }}>
            <View />
          </IconButton>
          <View style={{ width: 52 }} />
        </View>
      </SafeAreaView>

      {tips && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', padding: space.lg }]}>
          <Card style={{ gap: space.md }}>
            <Text variant="heading" weight="semibold">{t('tips.title')}</Text>
            {(['light', 'makeup', 'hair'] as const).map((k, i) => (
              <View key={k} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                <Icon name={(['sun', 'sparkle', 'leaf'] as const)[i]!} color={p.accent} />
                <Text style={{ flex: 1 }}>{t(`tips.${k}`)}</Text>
              </View>
            ))}
            <Button
              title={t('tips.gotIt')}
              onPress={() => {
                setTips(false);
                AsyncStorage.setItem(TIPS_KEY, '1');
              }}
            />
          </Card>
        </View>
      )}
    </View>
  );
}
