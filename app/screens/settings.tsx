// screens/Settings.tsx
import React, { useEffect, useState } from 'react';
import {
  View, Text, Switch, StyleSheet, Image, TouchableOpacity, ScrollView,
  Dimensions, Alert, Animated, Modal,
} from 'react-native';
import type { ViewStyle, ImageSourcePropType, LayoutChangeEvent } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useBag } from '../logics/bag/bagContext';
import { useBLE } from '../logics/ble/BLE';
import { useAppLock } from '../logics/security/appLock';
import AsyncStorage from '@react-native-async-storage/async-storage';

import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

const PROFILE_KEY = 'profile:v2';

const { height: screenHeight, width: screenWidth } = Dimensions.get('window');
const scale = (size: number) => (screenWidth / 375) * size;
const verticalScale = (size: number) => (screenHeight / 812) * size;
const moderateScale = (size: number, factor = 0.5) => size + (scale(size) - size) * factor;

const bytesToUtf8 = (bytes: Uint8Array): string => {
  try {
    const pct = Array.from(bytes).map((b) => '%' + b.toString(16).padStart(2, '0')).join('');
    return decodeURIComponent(pct);
  } catch {
    return String.fromCharCode(...Array.from(bytes));
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ===== BatteryIndicator (unchanged) ===== */
const BATTERY_BASE_W = 65;
const BATTERY_BASE_H = 37;
const BATTERY_FILL_LEFT = 20;
const BATTERY_FILL_TOP = 12.5;
const BATTERY_FILL_W = 55;
const BATTERY_FILL_H = 15;

type BatteryIndicatorProps = {
  level: number;
  style?: ViewStyle;
  source?: ImageSourcePropType;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const BatteryIndicator: React.FC<BatteryIndicatorProps> = ({ level, style, source }) => {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const anim = React.useRef(new Animated.Value(clamp01((+level || 0) / 100))).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: clamp01((+level || 0) / 100), duration: 400, useNativeDriver: false }).start();
  }, [level, anim]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - dims.w) > 0.5 || Math.abs(height - dims.h) > 0.5) setDims({ w: width, h: height });
  };

  const sx = dims.w / BATTERY_BASE_W || 0;
  const sy = dims.h / BATTERY_BASE_H || 0;
  const left = BATTERY_FILL_LEFT * sx;
  const top = BATTERY_FILL_TOP * sy;
  const maxW = BATTERY_FILL_W * sx;
  const h = BATTERY_FILL_H * sy;
  const radius = Math.max(1, 5 * sy);

  const fillWidth = anim.interpolate({ inputRange: [0, 1], outputRange: [0, maxW] });
  const color = level > 50 ? '#22c55e' : level > 20 ? '#f59e0b' : '#ef4444';

  return (
    <View style={[{ overflow: 'visible' }, style]} onLayout={onLayout} pointerEvents="none">
      <Image
        source={source || require('../assets/battery.png')}
        style={{ position: 'absolute', left: 0, top: -6, width: '150%', height: '150%' }}
        resizeMode="contain"
      />
      {dims.w > 0 && dims.h > 0 && (
        <Animated.View
          style={{
            position: 'relative',
            left,
            top,
            // @ts-ignore
            width: fillWidth,
            height: h,
            backgroundColor: color,
            borderRadius: radius,
          }}
        />
      )}
    </View>
  );
};
/* ========================================== */

export default function SettingsScreen({ navigation }: any) {
  const { t } = useTranslation();
  const bag = useBag();
  const bagName = bag.bagName;
  const batteryPct = bag.batteryPct;

  const [travelMode, setTravelMode] = useState(false);
  const [lostMode, setLostMode] = useState(false);

  const { status: bleStatus, deviceId, restoreLast, onReceiveBytes, sendText } = useBLE();

  // app lock
  const { enabled: appLockEnabled, setEnabled: setAppLockEnabled, authenticateOnce } = useAppLock();

  // 🔔 Custom OffStrap popup state
  const [popup, setPopup] = useState<{ visible: boolean; title: string; body: string }>({
    visible: false,
    title: '',
    body: '',
  });

  const showPopup = (title: string, body: string) => {
    setPopup({ visible: true, title, body });
  };

  const closePopup = () => {
    setPopup((prev) => ({ ...prev, visible: false }));
  };

  useEffect(() => {
    const unsub = onReceiveBytes((bytes) => {
      const textRaw = bytesToUtf8(bytes).trim();
      if (!textRaw) return;
      const low = textRaw.toLowerCase();

      switch (low) {
        case 'lost_mode_on':
        case 'lost_mode_shown':
          setLostMode(true);
          break;
        case 'lost_off_ack':
        case 'lost_mode_off':
          setLostMode(false);
          break;
        case 'travel_mode_on':
          setTravelMode(true);
          break;
        case 'travel_mode_off':
          setTravelMode(false);
          break;
        case 'fingerprint_started':
          Alert.alert(t('settings.fingerprintStartedTitle'), t('settings.fingerprintStartedBody'));
          break;
        default:
          break;
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [onReceiveBytes, t]);

  useEffect(() => {
    restoreLast();
  }, [restoreLast]);

  // 🔧 Generic BLE command helper
  // showPopupOnFail=true → used for Travel Mode
  // showPopupOnFail=false → used for Lost Mode (no popup, even if BLE is off)
  const sendBleCommand = async (
    command: string,
    opts?: { showPopupOnFail?: boolean },
  ): Promise<boolean> => {
    const showPopupOnFail = opts?.showPopupOnFail ?? true;

    if (!(bleStatus === 'connected' && deviceId)) {
      if (showPopupOnFail) {
        showPopup(t('settings.notConnectedTitle'), t('settings.notConnectedBody'));
      }
      return false;
    }
    try {
      await sendText(command);
      return true;
    } catch {
      if (showPopupOnFail) {
        showPopup(t('settings.cmdFailedTitle'), t('settings.cmdFailedBody'));
      }
      return false;
    }
  };

  // LOST payload helpers
  const readProfileV2 = async (): Promise<{ fullName: string; phone: string }> => {
    try {
      const raw = await AsyncStorage.getItem(PROFILE_KEY);
      const v2 = raw ? JSON.parse(raw) : {};
      const firstName = (v2?.firstName || '').toString().trim();
      const lastName = (v2?.lastName || '').toString().trim();
      const phone = (v2?.phone || '').toString().trim();
      const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
      return { fullName, phone };
    } catch {
      return { fullName: '', phone: '' };
    }
  };

  const MAX_CHAR_BYTES = 64;
  const NAME_PREFIX = 'LOST_NAME|';
  const PHONE_PREFIX = 'LOST_PHONE|';

  const handleLostModeChange = async (value: boolean) => {
    // Lost mode UI toggle should work regardless of BLE
    setLostMode(value);

    if (value) {
      const { fullName, phone } = await readProfileV2();
      const safeName = (fullName || '').replace(/\|/g, ' ').trim();
      const safePhone = (phone || '').replace(/\|/g, ' ').trim();

      const roomForName = Math.max(0, MAX_CHAR_BYTES - NAME_PREFIX.length);
      const roomForPhone = Math.max(0, MAX_CHAR_BYTES - PHONE_PREFIX.length);

      const sendName = (safeName || '').slice(0, roomForName) || 'OWNER';
      const sendPhone = (safePhone || '').slice(0, roomForPhone);

      // 🔕 No popup for Lost mode if BLE is off
      await sendBleCommand('LOST_ON', { showPopupOnFail: false });
      await sleep(80);
      await sendBleCommand(`${NAME_PREFIX}${sendName}`, { showPopupOnFail: false });
      await sleep(80);
      await sendBleCommand(`${PHONE_PREFIX}${sendPhone}`, { showPopupOnFail: false });
    } else {
      await sendBleCommand('LOST_OFF', { showPopupOnFail: false });
    }
  };

  // Travel Mode: only toggle if BLE command succeeds, and popup on BLE issues
  const handleTravelModeChange = async (value: boolean) => {
    const ok = await sendBleCommand(value ? 'travel_on' : 'travel_off', {
      showPopupOnFail: true,
    });
    if (ok) {
      setTravelMode(value);
    }
  };

  const handleFingerprintManager = () => {
    navigation.navigate('FingerprintManager');
  };

  // 🔽 UPDATED: real logout (matches Account screen behavior)
  const handleSignOut = () => {
    Alert.alert(
      t('settings.confirmSignOutTitle'),
      t('settings.confirmSignOutBody'),
      [
        { text: t('settings.cancel'), style: 'cancel' },
        {
          text: t('settings.signOut'),
          style: 'destructive',
          onPress: async () => {
            try {
              // 1) Tell Login to skip silent sign-in once
              await AsyncStorage.setItem('skipSilentOnce', '1');

              // 2) Sign out Firebase
              await auth().signOut();

              // 3) Clear Google session (prevents silent re-login)
              try {
                await GoogleSignin.signOut();
              } catch {}
              try {
                await GoogleSignin.revokeAccess();
              } catch {}

              // 4) Clear lightweight cache if any
              try {
                await AsyncStorage.removeItem('userData');
              } catch {}
            } catch (e: any) {
              Alert.alert('Logout error', e?.message ?? 'Please try again');
            } finally {
              // 5) Reset to Login
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            }
          },
        },
      ],
    );
  };

  // Face ID toggle logic
  const handleAppLockToggle = async () => {
    if (!appLockEnabled) {
      const ok = await authenticateOnce('Enable Face ID for OffStrap');
      if (ok) await setAppLockEnabled(true);
    } else {
      Alert.alert(
        t('settings.turnOffTitle'),
        t('settings.turnOffBody'),
        [
          { text: t('settings.cancel'), style: 'cancel' },
          {
            text: t('settings.turnOff'),
            style: 'destructive',
            onPress: async () => {
              const ok = await authenticateOnce('Disable Face ID');
              if (ok) await setAppLockEnabled(false);
            },
          },
        ],
      );
    }
  };

  return (
    <SafeAreaProvider>
      {/* 🔔 OffStrap-style popup (visually matches AppLockGate) */}
      <Modal
        transparent
        visible={popup.visible}
        animationType="fade"
        onRequestClose={closePopup}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{popup.title}</Text>
            <Text style={styles.modalBody}>{popup.body}</Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={closePopup}
              activeOpacity={0.9}
            >
              <Text style={styles.modalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Heading */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('settings.title')}</Text>
          <Text style={styles.subtitle}>{t('settings.subtitle')}</Text>
        </View>

        {/* Bag card */}
        <View style={styles.cardBag}>
          <View style={styles.bagIconContainer}>
            <View style={styles.bagIconHolder}>
              <Image source={require('../assets/bag.jpeg')} style={styles.bagIcon} />
            </View>
          </View>
          <View style={styles.bagInfoTextContainer}>
            <Text style={styles.bagInfoCenterTitle} numberOfLines={1}>
              {bagName}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                height: 20,
                marginTop: 2,
              }}
            >
              <BatteryIndicator level={batteryPct} style={styles.batIcon} />
              <Text style={styles.bagConnectionText}>{`${batteryPct}%`}</Text>
            </View>
          </View>
        </View>

        {/* Block 1 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.general')}</Text>
          <SettingItem
            icon={require('../assets/account.png')}
            label={t('settings.account')}
            onPress={() => navigation.navigate('Account')}
          />
          <SettingItem
            icon={require('../assets/about.png')}
            label={t('settings.about')}
            onPress={() => navigation.navigate('About')}
          />
          <SettingSwitch
            icon={require('../assets/appsecurity.png')}
            label={t('settings.requireFaceId')}
            value={appLockEnabled}
            onValueChange={handleAppLockToggle}
          />
        </View>

        {/* Block 2 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.modes')}</Text>
          <SettingSwitch
            icon={require('../assets/travel.png')}
            label={t('settings.travelMode')}
            value={travelMode}
            onValueChange={handleTravelModeChange}
          />
          <SettingSwitch
            icon={require('../assets/lost.png')}
            label={t('settings.lostMode')}
            value={lostMode}
            onValueChange={handleLostModeChange}
          />
        </View>

        {/* Block 3 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.preferences')}</Text>
          <TouchableOpacity style={styles.row} onPress={handleFingerprintManager}>
            <Image source={require('../assets/fingerprint.png')} style={styles.icon} />
            <Text style={styles.rowLabel}>{t('settings.fingerprintManager')}</Text>
          </TouchableOpacity>
          <SettingItem
            icon={require('../assets/display.png')}
            label={t('settings.smartDisplay')}
            onPress={() => navigation.navigate('smartScreen')}
          />
          <SettingItem
            icon={require('../assets/notification.png')}
            label={t('settings.notifications')}
            onPress={() => navigation.navigate('Notifications')}
          />
          <SettingItem
            icon={require('../assets/language.png')}
            label={t('settings.languages')}
            onPress={() => navigation.navigate('Languages')}
          />
        </View>

        {/* Block 4 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.session')}</Text>
          <SettingItem
            icon={require('../assets/logout.png')}
            label={t('settings.logout')}
            onPress={handleSignOut}
          />
        </View>
      </ScrollView>
    </SafeAreaProvider>
  );
}

/** Row item with icon + label */
function SettingItem({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
      <Image source={icon} style={styles.icon} />
      <Text style={styles.rowLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Row with a trailing switch */
function SettingSwitch({
  label,
  value,
  onValueChange,
  icon,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  icon: any;
}) {
  return (
    <View style={styles.row}>
      <Image source={icon} style={styles.icon} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#444', true: '#007AFF' }}
        thumbColor={value ? '#fff' : '#f4f3f4'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: screenHeight * 0.05 },
  content: { padding: 20, paddingBottom: 32 },
  header: { marginBottom: 14, alignItems: 'flex-start' },
  title: { color: '#fff', fontSize: 28, fontFamily: 'MontserratAlt1-SemiBold' },
  subtitle: { color: '#bbb', marginTop: 6, fontSize: 15, fontFamily: 'MontserratAlt1-Light' },

  card: {
    backgroundColor: '#0f0f0f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    padding: 8,
    paddingVertical: 10,
    marginTop: 18,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 6,
    paddingHorizontal: 8,
    fontFamily: 'MontserratAlt1-SemiBold',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#101010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginHorizontal: 4,
    marginVertical: 6,
  },
  icon: { marginRight: 12, height: 18, width: 18, resizeMode: 'contain' },
  rowLabel: { color: '#fff', fontSize: 16, fontFamily: 'MontserratAlt1-Regular', flex: 1 },

  cardBag: {
    height: verticalScale(80),
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(15),
    borderRadius: moderateScale(12),
    alignItems: 'center',
    marginTop: 4,
  },
  bagIconContainer: {
    height: moderateScale(50),
    width: moderateScale(50),
    justifyContent: 'center',
    alignItems: 'center',
  },
  bagIconHolder: {
    borderRadius: moderateScale(25),
    overflow: 'hidden',
    backgroundColor: '#abb4c2ff',
    height: '100%',
    width: '100%',
  },
  bagIcon: { resizeMode: 'cover', height: '100%', width: '100%' },
  bagInfoTextContainer: { flex: 1, paddingLeft: scale(10) },
  bagInfoCenterTitle: {
    fontSize: moderateScale(20),
    fontFamily: 'MontserratAlt1-SemiBold',
    color: '#000',
  },
  bagConnectionText: {
    fontSize: moderateScale(16),
    color: '#000',
    paddingHorizontal: 10,
    fontFamily: 'MontserratAlt1-Medium',
  },
  batIcon: {
    height: verticalScale(30),
    width: scale(32),
    resizeMode: 'contain',
    marginTop: 4,
    marginRight: 10,
  },

  // 🔔 Popup styles — visually matching AppLockGate
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)', // same dim as AppLock gate
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    width: '80%',
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontFamily: 'MontserratAlt1-SemiBold',
    textAlign: 'center',
  },
  modalBody: {
    color: '#bbb',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    fontFamily: 'MontserratAlt1-Regular',
  },
  modalButton: {
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#007AFF',
    borderRadius: 12,
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'MontserratAlt1-SemiBold',
  },
});
