// screens/notification.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  Dimensions,
  Switch,
  Pressable,
  Platform,
  Alert,
  Modal,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useBLE } from '../logics/ble/BLE';

const { height: screenHeight } = Dimensions.get('window');

/* ========= storage keys ========= */
const K_NOTIFY_BLE_ENABLED   = 'settings:notifyBleEnabled:v1';
const K_NOTIFY_BLE_DELAY     = 'settings:notifyBleDelay:v1';
const K_TAMPER_THRESHOLD     = 'settings:tamperThreshold:v1';
const K_BATTERY_THRESHOLD    = 'settings:batteryThreshold:v1';

/* ========= types ========= */
type TamperKey = '3' | '5' | '10';
type BleDelayKey = 'immediate' | '5m' | '15m' | '1h' | '8h';
type BatteryKey = '5' | '10' | '20';

/* ========= labels ========= */
const TAMPER_LABEL: Record<TamperKey, string> = {
  '3': '3 mismatches',
  '5': '5 mismatches',
  '10': '10 mismatches',
};

const BLEDELAY_LABEL: Record<BleDelayKey, string> = {
  immediate: 'Immediately',
  '5m': 'After 5 minutes',
  '15m': 'After 15 minutes',
  '1h': 'After 1 hour',
  '8h': 'After 8 hours',
};

const BATTERY_LABEL: Record<BatteryKey, string> = {
  '5': '5%',
  '10': '10%',
  '20': '20%',
};

/* ========= cycle helpers ========= */
const nextTamper: Record<TamperKey, TamperKey> = {
  '3': '5',
  '5': '10',
  '10': '3',
};

const nextBleDelay: Record<BleDelayKey, BleDelayKey> = {
  immediate: '5m',
  '5m': '15m',
  '15m': '1h',
  '1h': '8h',
  '8h': 'immediate',
};

const nextBattery: Record<BatteryKey, BatteryKey> = {
  '5': '10',
  '10': '20',
  '20': '5',
};

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const { status: bleStatus, deviceId } = useBLE(); // ✅ need status + id

  const [loaded, setLoaded] = useState(false);
  const [baseNotifyBleEnabled, setBaseNotifyBleEnabled] = useState(false);
  const [baseBleDelay, setBaseBleDelay] = useState<BleDelayKey>('immediate');
  const [baseTamperThreshold, setBaseTamperThreshold] = useState<TamperKey>('3');
  const [baseBatteryThreshold, setBaseBatteryThreshold] = useState<BatteryKey>('10');

  const [notifyBleEnabled, setNotifyBleEnabled] = useState(false);
  const [bleDelay, setBleDelay] = useState<BleDelayKey>('immediate');
  const [tamperThreshold, setTamperThreshold] = useState<TamperKey>('3');
  const [batteryThreshold, setBatteryThreshold] = useState<BatteryKey>('10');

  const [saving, setSaving] = useState(false);

  // 🔔 OffStrap-style popup (same visual as Travel Mode / AppLock)
  const [popup, setPopup] = useState<{ visible: boolean; title: string; body: string }>({
    visible: false,
    title: '',
    body: '',
  });

  const showPopup = (title: string, body: string) => {
    setPopup({ visible: true, title, body });
  };

  const closePopup = () => {
    setPopup(prev => ({ ...prev, visible: false }));
  };

  // Load prefs
  useEffect(() => {
    (async () => {
      try {
        const [rawEnabled, rawDelay, rawTamper, rawBattery] = await Promise.all([
          AsyncStorage.getItem(K_NOTIFY_BLE_ENABLED),
          AsyncStorage.getItem(K_NOTIFY_BLE_DELAY),
          AsyncStorage.getItem(K_TAMPER_THRESHOLD),
          AsyncStorage.getItem(K_BATTERY_THRESHOLD),
        ]);

        const enabled = rawEnabled === '1';
        const delay = (rawDelay as BleDelayKey) || 'immediate';
        const tamper = (rawTamper as TamperKey) || '3';
        const battery = (rawBattery as BatteryKey) || '10';

        setBaseNotifyBleEnabled(enabled);
        setBaseBleDelay(delay);
        setBaseTamperThreshold(tamper);
        setBaseBatteryThreshold(battery);

        setNotifyBleEnabled(enabled);
        setBleDelay(delay);
        setTamperThreshold(tamper);
        setBatteryThreshold(battery);

        // First-run defaults
        if (rawEnabled === null && rawDelay === null && rawTamper === null && rawBattery === null) {
          await Promise.all([
            AsyncStorage.setItem(K_NOTIFY_BLE_ENABLED, '0'),
            AsyncStorage.setItem(K_NOTIFY_BLE_DELAY, 'immediate'),
            AsyncStorage.setItem(K_TAMPER_THRESHOLD, '3'),
            AsyncStorage.setItem(K_BATTERY_THRESHOLD, '10'),
          ]);
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Dirty check
  const dirty = useMemo(() => {
    if (!loaded) return false;
    return (
      notifyBleEnabled !== baseNotifyBleEnabled ||
      bleDelay !== baseBleDelay ||
      tamperThreshold !== baseTamperThreshold ||
      batteryThreshold !== baseBatteryThreshold
    );
  }, [
    loaded,
    notifyBleEnabled,
    baseNotifyBleEnabled,
    bleDelay,
    baseBleDelay,
    tamperThreshold,
    baseTamperThreshold,
    batteryThreshold,
    baseBatteryThreshold,
  ]);

  const cycleTamper = () => setTamperThreshold(nextTamper[tamperThreshold]);
  const cycleBleDelay = () => setBleDelay(nextBleDelay[bleDelay]);
  const cycleBattery = () => setBatteryThreshold(nextBattery[batteryThreshold]);

  const onSave = async () => {
    if (!dirty || saving) return;

    const isBleConnected = bleStatus === 'connected' && !!deviceId;

    // 🔒 If not connected, show the same popup as Travel Mode & bail
    if (!isBleConnected) {
      showPopup(
        t('settings.notConnectedTitle'),
        t('settings.notConnectedBody'),
      );
      return;
    }

    setSaving(true);
    try {
      await Promise.all([
        AsyncStorage.setItem(K_NOTIFY_BLE_ENABLED, notifyBleEnabled ? '1' : '0'),
        AsyncStorage.setItem(K_NOTIFY_BLE_DELAY, bleDelay),
        AsyncStorage.setItem(K_TAMPER_THRESHOLD, tamperThreshold),
        AsyncStorage.setItem(K_BATTERY_THRESHOLD, batteryThreshold),
      ]);

      setBaseNotifyBleEnabled(notifyBleEnabled);
      setBaseBleDelay(bleDelay);
      setBaseTamperThreshold(tamperThreshold);
      setBaseBatteryThreshold(batteryThreshold);

      // ✅ Connected: show "Saved" message
      Alert.alert(
        t('notifications.savedTitle') || 'Saved',
        t('notifications.savedBody') || 'Your notification preferences have been saved.'
      );
    } catch {
      Alert.alert(
        t('notifications.saveErrorTitle') || 'Couldn’t save',
        t('notifications.saveErrorBody') || 'Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* 🔔 OffStrap-style popup overlay */}
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

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('notifications.title', 'Notifications')}</Text>
          <Text style={styles.subtitle}>
            {t('notifications.subtitle', 'Configure alerts & mutes')}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>
          {t('notifications.alertPrefs', 'Alert Preferences')}
        </Text>

        {/* Tamper attempts threshold */}
        <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={cycleTamper}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowTitle}>
              {t('notifications.tamperThreshold', 'Tamper Alert Threshold')}
            </Text>
            <Text style={styles.rowSub}>
              {t(
                'notifications.tamperThresholdSub',
                'Notify when fingerprint mismatches reach this number'
              )}
            </Text>
            <View style={styles.valuePill}>
              <Text style={styles.valuePillText}>{TAMPER_LABEL[tamperThreshold]}</Text>
            </View>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {/* Battery threshold */}
        <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={cycleBattery}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowTitle}>
              {t('notifications.batteryThreshold', 'Battery Alert Threshold')}
            </Text>
            <Text style={styles.rowSub}>
              {t(
                'notifications.batteryThresholdSub',
                'Notify when your bag’s battery drops to this level'
              )}
            </Text>
            <View style={styles.valuePill}>
              <Text style={styles.valuePillText}>{BATTERY_LABEL[batteryThreshold]}</Text>
            </View>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {/* BLE disconnect switch */}
        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowTitle}>
              {t('notifications.notifyBleDisconnect', 'Notify when Bluetooth Disconnects')}
            </Text>
            <Text style={styles.rowSub}>
              {t(
                'notifications.notifyBleDisconnectSub',
                'Get an alert if your phone loses connection to OffStrap'
              )}
            </Text>
          </View>
          <Switch
            value={notifyBleEnabled}
            onValueChange={setNotifyBleEnabled}
            trackColor={{ false: '#444', true: '#2b6fff' }}
            thumbColor={notifyBleEnabled ? '#fff' : '#f4f3f4'}
          />
        </View>

        {/* BLE delay */}
        <Pressable
          disabled={!notifyBleEnabled}
          style={({ pressed }) => [
            styles.row,
            pressed && styles.pressed,
            !notifyBleEnabled && { opacity: 0.45 },
          ]}
          onPress={cycleBleDelay}
        >
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowTitle}>
              {t('notifications.bleDelay', 'Notify after')}
            </Text>
            <Text style={styles.rowSub}>
              {t(
                'notifications.bleDelaySub',
                'How long to wait before alerting you after a disconnect'
              )}
            </Text>
            <View style={styles.valuePill}>
              <Text style={styles.valuePillText}>{BLEDELAY_LABEL[bleDelay]}</Text>
            </View>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {/* Save button */}
        <Pressable
          onPress={dirty ? onSave : undefined}
          disabled={!dirty || saving}
          style={({ pressed }) => [
            styles.saveBtn,
            (!dirty || saving) && styles.saveBtnDisabled,
            { opacity: pressed && dirty ? 0.95 : 1 },
          ]}
        >
          <Text
            style={[
              styles.saveText,
              (!dirty || saving) && styles.saveTextDisabled,
            ]}
          >
            {saving
              ? t('common.saving') || 'Saving…'
              : t('account.saveChanges') || 'Save Changes'}
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

/* ========================= styles ========================= */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: screenHeight * 0.05 },
  content: { padding: 20, paddingBottom: 32 },
  header: { marginBottom: 14, alignItems: 'flex-start' },
  title: { color: '#fff', fontSize: 28, fontFamily: 'MontserratAlt1-SemiBold' },
  subtitle: { color: '#bbb', marginTop: 6, fontSize: 15, fontFamily: 'MontserratAlt1-Light' },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 8,
    paddingHorizontal: 4,
    fontFamily: 'MontserratAlt1-SemiBold',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#101010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginVertical: 6,
  },
  pressed: { opacity: 0.92 },
  rowTextWrap: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 16, fontFamily: 'MontserratAlt1-Regular' },
  rowSub: { color: '#9aa3b2', fontSize: 13, marginTop: 4, fontFamily: 'MontserratAlt1-Light' },
  valuePill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#17223a',
    borderColor: '#2c3e66',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  valuePillText: { color: '#8ab4ff', fontSize: 13, fontFamily: 'MontserratAlt1-Medium' },
  chevron: { color: '#667799', fontSize: 24, paddingLeft: 10, paddingRight: 2 },

  saveBtn: {
    marginTop: 22,
    height: 54,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.16,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: {
        elevation: 3,
      },
    }),
  },
  saveText: { color: '#000', fontSize: 16, fontFamily: 'MontserratAlt1-SemiBold' },
  saveBtnDisabled: { backgroundColor: '#444', shadowOpacity: 0, elevation: 0 },
  saveTextDisabled: { color: '#aaa' },

  // 🔔 Popup styles (matching Settings & AppLock)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
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
