// screens/FingerprintSetup.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Pressable,
  Alert,
} from 'react-native';
import LottieView from 'lottie-react-native';
import { useBLE } from '../logics/ble/BLE';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ----- Brand button -----
type BrandButtonProps = {
  title: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  style?: any;
  textStyle?: any;
};
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const BrandButton: React.FC<BrandButtonProps> = ({
  title,
  onPress,
  disabled,
  loading,
  style,
  textStyle,
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const inFlight = useRef(false);

  const pressIn = () =>
    Animated.timing(scale, {
      toValue: 0.97,
      duration: 70,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  const pressOut = () =>
    Animated.timing(scale, {
      toValue: 1,
      duration: 90,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

  const handlePress = async () => {
    if (disabled || loading || inFlight.current) return;
    inFlight.current = true;
    try {
      await onPress();
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Animated.View style={{ transform: [{ scale }], alignSelf: 'center' }}>
      <AnimatedPressable
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={handlePress}
        disabled={disabled || loading}
        style={[
          styles.primary,
          (disabled || loading) && styles.primaryDisabled,
          style,
        ]}
      >
        <Text style={[styles.primaryText, textStyle]} numberOfLines={1}>
          {loading ? 'Please wait…' : title}
        </Text>
      </AnimatedPressable>
    </Animated.View>
  );
};

// ----- Assets -----
import FPAnim from '../assets/FPSanim.json';
import TickAnim from '../assets/TickPlaceholder.json';

enum Phase {
  Idle = 'idle',
  PlayingFP = 'playing_fp',
  PlayingTick = 'playing_tick',
  Done = 'done',
}

type VerifyPhase = 'idle' | 'intro' | 'place' | 'remove' | 'fail' | 'ok';

const FINGERPRINT_DONE_KEY = 'fingerprint:enrolled:v1';

export default function FingerprintSetup({ navigation, route }: any) {
  const { sendText, onReceiveBytes } = useBLE();
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>(Phase.Idle);
  const [progress5, setProgress5] = useState(0);
  const [enrolling, setEnrolling] = useState(false);
  const [hintMode, setHintMode] = useState<'place' | 'remove' | null>(null);
  const [verifyPhase, setVerifyPhase] = useState<VerifyPhase>('idle');

  const [verifyRetries, setVerifyRetries] = useState(0);
  const [awaitDecision, setAwaitDecision] = useState(false);
  const [sendBusy, setSendBusy] = useState<null | 'retry' | 'startover'>(null);

  const completionOnceRef = useRef(false);
  const fpRef = useRef<LottieView>(null);

  // Where did we come from? (FingerprintManager vs Discovery flow)
  const from: 'manager' | 'discovery' =
    route?.params?.from === 'manager' ? 'manager' : 'discovery';

  // Animations
  const startOpacity = useRef(new Animated.Value(0)).current;
  const startTranslateY = useRef(new Animated.Value(10)).current;
  const continueOpacity = useRef(new Animated.Value(0)).current;
  const continueTranslateY = useRef(new Animated.Value(10)).current;

  // Slice math for 5 impressions
  const STOP_AT_RATIO = 0.70;
  const { ip, chunk } = useMemo(() => {
    const start = (FPAnim as any).ip ?? 0;
    const end = (FPAnim as any).op ?? 60;
    const total = end - start;
    const opEff = Math.round(start + total * STOP_AT_RATIO);
    const motionFrames = Math.max(1, opEff - start);
    const oneChunk = motionFrames / 5;
    return { ip: start, chunk: oneChunk };
  }, []);

  const playSlice = (sliceIndex: number) => {
    if (!fpRef.current) return;
    const startF = Math.round(ip + chunk * (sliceIndex - 1));
    const endF = Math.round(ip + chunk * sliceIndex);
    // @ts-ignore
    fpRef.current.play(startF, endF);
  };

  const startEnrollment = async () => {
    try {
      await sendText('FP_ENROLL_START');
      setPhase(Phase.PlayingFP);
      setProgress5(0);
      setEnrolling(false);
      setHintMode(null);
      setVerifyPhase('idle');
      setVerifyRetries(0);
      setAwaitDecision(false);
    } catch {
      // keep hint state if send fails
    }
  };

  const onRetry = async () => {
    try {
      setSendBusy('retry');
      await sendText('FP_VERIFY_RETRY');
      setAwaitDecision(false);
    } finally {
      setSendBusy(null);
    }
  };

  const onStartOver = async () => {
    try {
      setSendBusy('startover');
      await sendText('FP_START_OVER');
      setPhase(Phase.Idle);
      setProgress5(0);
      setEnrolling(false);
      setHintMode(null);
      setVerifyPhase('idle');
      setVerifyRetries(0);
      setAwaitDecision(false);
      completionOnceRef.current = false;
      await AsyncStorage.removeItem(FINGERPRINT_DONE_KEY).catch(() => {});
    } finally {
      setSendBusy(null);
    }
  };

  const markFingerprintCompleted = async () => {
    if (completionOnceRef.current) return;
    completionOnceRef.current = true;

    await AsyncStorage.setItem(FINGERPRINT_DONE_KEY, 'true').catch(() => {});
    const user = auth().currentUser;
    if (user) {
      const now = firestore.FieldValue.serverTimestamp();
      await firestore()
        .collection('users')
        .doc(user.uid)
        .set({ fingerprintEnrolled: true, updatedAt: now }, { merge: true })
        .catch(() => {});
    }
  };

  // BLE notifications
  useEffect(() => {
    const off = onReceiveBytes((bytes) => {
      const text = String.fromCharCode(...bytes).trim();

      // ignore repeats if already done
      if (
        completionOnceRef.current &&
        (text === 'VERIFY_MATCH' || text === 'ENROLL_DONE')
      )
        return;

      if (text.startsWith('VERIFY_RETRY')) {
        const m = text.match(/VERIFY_RETRY\s+(\d)\/3/);
        if (m && m[1])
          setVerifyRetries(Math.max(0, Math.min(3, parseInt(m[1], 10))));
        setVerifyPhase('fail');
        setAwaitDecision(true);
        return;
      }
      if (text === 'VERIFY_AWAIT_DECISION') {
        setVerifyPhase('fail');
        setAwaitDecision(true);
        return;
      }
      if (text === 'VERIFY_FAILED_MAX') {
        setVerifyRetries(3);
        setVerifyPhase('fail');
        setAwaitDecision(false);
        return;
      }

      if (text === 'PLACE_FINGER') {
        if (!enrolling) setEnrolling(true);
        if (verifyPhase === 'idle') setHintMode('place');
      } else if (text === 'REMOVE_FINGER') {
        if (!enrolling) setEnrolling(true);
        if (verifyPhase === 'idle') setHintMode('remove');
        setProgress5((prev) => {
          const next = Math.min(5, prev + 1);
          if (next <= 5) {
            if (phase !== Phase.PlayingFP) setPhase(Phase.PlayingFP);
            playSlice(next);
          }
          if (next === 5) {
            setHintMode(null);
            setVerifyPhase('intro');
          }
          return next;
        });
      } else if (text === 'ENROLL_DONE') {
        if (verifyPhase === 'idle') setVerifyPhase('intro');
      } else if (text === 'VERIFY_PLACE') {
        setVerifyPhase('place');
        setAwaitDecision(false);
      } else if (text === 'VERIFY_REMOVE') {
        setVerifyPhase('remove');
        setAwaitDecision(false);
      } else if (text === 'VERIFY_NO_MATCH') {
        setVerifyPhase('fail');
        setAwaitDecision(true);
      } else if (text === 'VERIFY_MATCH') {
        markFingerprintCompleted().catch(() => {});
        setVerifyPhase('ok');
        setAwaitDecision(false);
        setVerifyRetries(0);
        setHintMode(null);
        setPhase(Phase.PlayingTick);
      } else if (text === 'Idle') {
        setPhase(Phase.Idle);
        setProgress5(0);
        setEnrolling(false);
        setHintMode(null);
        setVerifyPhase('idle');
        setVerifyRetries(0);
        setAwaitDecision(false);
        completionOnceRef.current = false;
      }
    });
    return off;
  }, [onReceiveBytes, phase, enrolling, verifyPhase]);

  // Animations
  useEffect(() => {
    if (phase === Phase.Idle) {
      startOpacity.setValue(0);
      startTranslateY.setValue(10);
      Animated.parallel([
        Animated.timing(startOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(startTranslateY, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [phase, startOpacity, startTranslateY]);

  useEffect(() => {
    if (phase === Phase.Done) {
      continueOpacity.setValue(0);
      continueTranslateY.setValue(10);
      Animated.parallel([
        Animated.timing(continueOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(continueTranslateY, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [phase, continueOpacity, continueTranslateY]);

  const renderAnimation = () => {
    if (phase === Phase.PlayingFP) {
      return (
        <LottieView
          ref={fpRef}
          source={FPAnim}
          autoPlay={false}
          loop={false}
          style={styles.animBox}
        />
      );
    }
    if (phase === Phase.PlayingTick) {
      return (
        <View className="animBoxCenter" style={styles.animBoxCenter}>
          <LottieView
            source={TickAnim}
            autoPlay
            loop={false}
            onAnimationFinish={() => {
  if (from === 'manager') {
    Alert.alert(
      t('settings.fingerprintSuccessTitle'),
      t('settings.fingerprintSuccessBody'),
      [
        {
          text: 'Okay',
          onPress: () => {
            if (navigation.canGoBack?.()) {
              navigation.goBack();
              setTimeout(() => {
                if (navigation.canGoBack?.()) {
                  navigation.goBack();
                }
              }, 50);
            }
          },
        },
      ],
      { cancelable: false }
    );
  } else {
    setPhase(Phase.Done);
  }
}}
            style={{ width: 240, height: 240 }}
          />
        </View>
      );
    }
    return <View style={styles.animBox} />;
  };

  const renderHint = () => {
    if (verifyPhase !== 'idle' && verifyPhase !== 'ok') {
      return (
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.verifyTitle}>Verify your fingerprint</Text>
          {verifyPhase === 'intro' && (
            <Text style={styles.hintTextBig}>
              Follow the prompts to verify the saved finger
            </Text>
          )}
          {verifyPhase === 'place' && (
            <Text style={styles.hintTextBig}>
              <Text style={styles.highlight}>Place and Hold</Text> the same
              finger
            </Text>
          )}
          {verifyPhase === 'remove' && (
            <Text style={styles.hintTextBig}>
              <Text style={styles.highlight}>Remove</Text> your finger
            </Text>
          )}
          {verifyPhase === 'fail' && (
            <Text style={styles.failText}>
              We couldn’t verify that finger. You can retry or start over.
            </Text>
          )}
        </View>
      );
    }
    if (!enrolling) {
      return (
        <Text style={styles.hintTextIntro}>
          We’ll guide you through short scans to save your fingerprint on the
          bag.
        </Text>
      );
    }
    if (hintMode === 'place') {
      return (
        <Text style={styles.hintTextBig}>
          {progress5 === 0 ? (
            <>
              <Text style={styles.highlight}>Place and Hold</Text> your finger
              on the sensor
            </>
          ) : (
            <>
              <Text style={styles.highlight}>Place and Hold your finger</Text>{' '}
              in a different angle
            </>
          )}
        </Text>
      );
    }
    if (hintMode === 'remove') {
      return (
        <Text style={styles.hintTextBig}>
          <Text style={styles.highlight}>Remove</Text> your finger
        </Text>
      );
    }
    return null;
  };

  const renderBottomAction = () => {
    const show = verifyPhase === 'fail' || awaitDecision;
    if (!show || verifyPhase === 'ok') return null;

    const showStartOver = verifyRetries >= 2;
    const title = showStartOver
      ? 'Start over'
      : `Retry (${Math.min(verifyRetries + 1, 3)}/3)`;
    const onPress = showStartOver ? onStartOver : onRetry;
    const busy =
      showStartOver ? sendBusy === 'startover' : sendBusy === 'retry';

    return (
      <View style={styles.bottomActionWrap}>
        <BrandButton
          title={title}
          onPress={onPress}
          loading={busy}
          disabled={sendBusy !== null}
          style={{ width: '70%', height: 50 }}
        />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleWrap}>
        <Text style={styles.title}>Setup Fingerprint Recognition</Text>
      </View>
      <View style={styles.hintWrap}>{renderHint()}</View>
      <View style={styles.content}>
        <View style={styles.animationWrap}>{renderAnimation()}</View>
        {enrolling && verifyPhase === 'idle' && (
          <Text style={styles.counterBelow}>{progress5}/5</Text>
        )}
        {phase === Phase.Idle && (
          <Animated.View
            style={{
              opacity: startOpacity,
              transform: [{ translateY: startTranslateY }],
              alignSelf: 'center',
              width: '100%',
              alignItems: 'center',
            }}
          >
            <BrandButton title="Start Enrollment" onPress={startEnrollment} />
          </Animated.View>
        )}
      </View>
      {renderBottomAction()}

      {/* Welcome overlay ONLY for discovery flow */}
      {from !== 'manager' && phase === Phase.Done && (
        <Animated.View
          style={[
            styles.centerOverlay,
            {
              opacity: continueOpacity,
              transform: [{ translateY: continueTranslateY }],
            },
          ]}
        >
          <BrandButton
            title="Welcome to OffStrap!"
            onPress={async () => {
              await markFingerprintCompleted().catch(() => {});
              navigation.replace('Dashboard');
            }}
            style={{ width: '80%', height: 54 }}
            textStyle={styles.primaryTextLarge}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  titleWrap: {
    position: 'absolute',
    top: '8%',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontFamily: 'MontserratAlt1-SemiBold',
    textAlign: 'center',
  },
  hintWrap: {
    position: 'absolute',
    top: '20%',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  hintTextIntro: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    fontFamily: 'MontserratAlt1-Light',
  },
  hintTextBig: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
    fontFamily: 'MontserratAlt1-SemiBold',
  },
  verifyTitle: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 6,
    fontFamily: 'MontserratAlt1-SemiBold',
    textAlign: 'center',
  },
  failText: {
    color: '#ff6b6b',
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
    fontFamily: 'MontserratAlt1-Medium',
  },
  highlight: { color: '#00e0ff', fontFamily: 'MontserratAlt1-SemiBold' },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  animationWrap: { marginBottom: 12 },
  animBox: { width: 240, height: 240 },
  animBoxCenter: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBelow: {
    marginTop: 8,
    marginBottom: 6,
    color: '#fff',
    fontSize: 16,
    fontFamily: 'MontserratAlt1-SemiBold',
  },
  primary: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
    width: '70%',
  },
  primaryDisabled: { backgroundColor: '#333' },
  primaryText: {
    color: '#000',
    fontSize: 16,
    fontFamily: 'MontserratAlt1-SemiBold',
  },
  primaryTextLarge: {
    color: '#000',
    fontSize: 18,
    fontFamily: 'MontserratAlt1-SemiBold',
  },
  centerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomActionWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '30%',
    alignItems: 'center',
  },
});