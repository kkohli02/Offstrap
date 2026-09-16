// logics/notifications/NotificationEngine.tsx
import React, { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBLE } from '../ble/BLE';
import { useBag } from '../bag/bagContext';
import { initLocalNotifications, notifyNow, notifyIn, cancelNotificationById } from './localNotify';
import { useTranslation } from 'react-i18next';

/* ===== persisted keys ===== */
const K_NOTIFY_BLE_ENABLED = 'settings:notifyBleEnabled:v1';
const K_NOTIFY_BLE_DELAY   = 'settings:notifyBleDelay:v1';
const K_TAMPER_THRESHOLD   = 'settings:tamperThreshold:v1';
const K_BATTERY_THRESHOLD  = 'settings:batteryThreshold:v1';

/* ===== types ===== */
type TamperKey   = '3' | '5' | '10';
type BleDelayKey = 'immediate' | '5m' | '15m' | '1h' | '8h';
type BatteryKey  = '5' | '10' | '20';

const delayToMs: Record<BleDelayKey, number> = {
  immediate: 0,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
};

const BLE_DISCO_ID = 'ble_disconnect_pending';

export default function NotificationEngine() {
  const { t } = useTranslation();
  const { status, onReceiveBytes } = useBLE();
  const { batteryPct } = useBag();

  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // user prefs
  const [notifyBleEnabled, setNotifyBleEnabled] = useState(false);
  const [bleDelay, setBleDelay] = useState<BleDelayKey>('immediate');
  const [tamperThreshold, setTamperThreshold] = useState<TamperKey>('3');
  const [batteryThreshold, setBatteryThreshold] = useState<BatteryKey>('10'); // default 10%

  // internals
  const tamperCountRef = useRef(0);

  // === BLE disconnect: send ONCE per disconnected session ===
  const discoNotifiedRef = useRef(false); // ← latch

  // battery state: notify only on downward crossing
  const prevBatteryRef = useRef<number | null>(null);
  const batteryLatchBelowRef = useRef(false);

  // init local notifications
  useEffect(() => { initLocalNotifications(); }, []);

  // load prefs (and refresh when they change)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [rawEnabled, rawDelay, rawTamper, rawBattery] = await Promise.all([
          AsyncStorage.getItem(K_NOTIFY_BLE_ENABLED),
          AsyncStorage.getItem(K_NOTIFY_BLE_DELAY),
          AsyncStorage.getItem(K_TAMPER_THRESHOLD),
          AsyncStorage.getItem(K_BATTERY_THRESHOLD),
        ]);
        if (!mounted) return;

        setNotifyBleEnabled(rawEnabled === '1');
        setBleDelay((rawDelay as BleDelayKey) || 'immediate');
        setTamperThreshold((rawTamper as TamperKey) || '3');
        setBatteryThreshold((rawBattery as BatteryKey) || '10');
      } finally {
        if (mounted) setPrefsLoaded(true);
      }
    })();

    const sub = (AsyncStorage as any)?.addListener?.('change', async () => {
      const [rawEnabled, rawDelay, rawTamper, rawBattery] = await Promise.all([
        AsyncStorage.getItem(K_NOTIFY_BLE_ENABLED),
        AsyncStorage.getItem(K_NOTIFY_BLE_DELAY),
        AsyncStorage.getItem(K_TAMPER_THRESHOLD),
        AsyncStorage.getItem(K_BATTERY_THRESHOLD),
      ]);
      setNotifyBleEnabled(rawEnabled === '1');
      setBleDelay((rawDelay as BleDelayKey) || 'immediate');
      setTamperThreshold((rawTamper as TamperKey) || '3');
      setBatteryThreshold((rawBattery as BatteryKey) || '10');
    });

    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  /* ========= BLE disconnect (send only once until reconnect) ========= */
  useEffect(() => {
    if (!prefsLoaded) return;

    if (status === 'connected') {
      // reconnected → cancel any pending scheduled alert + re-arm latch
      cancelNotificationById(BLE_DISCO_ID);
      discoNotifiedRef.current = false; // ← allow next disconnect to notify again
      return;
    }

    if (status === 'disconnected' && notifyBleEnabled) {
      if (!discoNotifiedRef.current) {
        discoNotifiedRef.current = true; // ← latch so we only send once

        const ms = delayToMs[bleDelay];

        // ---- Delay-specific messages (as requested) ----
        let title = '';
        let body  = '';

        switch (bleDelay) {
          case 'immediate':
            title = 'Bluetooth Disconnected';
            body  = 'Your phone lost connection to OffStrap.';
            break;
          case '5m':
            title = 'Bluetooth has been Disconnected for 5 Minutes';
            body  = 'Your phone has been out of range of OffStrap for 5 minutes.';
            break;
          case '15m':
            title = 'Bluetooth has been Disconnected for 15 Minutes';
            body  = 'Your phone has been out of range of OffStrap for 15 minutes.';
            break;
          case '1h':
            title = 'Bluetooth has been Disconnected for 1 Hour';
            body  = "Keeping Bluetooth disconnected severely reduces your OffStrap's Battery Life";
            break;
          case '8h':
            title = 'Bluetooth has been Disconnected for 8 Hours';
            body  = "Keeping Bluetooth disconnected severely reduces your OffStrap's Battery Life";
            break;
        }

        if (ms === 0) {
          notifyNow(title, body);
        } else {
          notifyIn(ms, title, body, BLE_DISCO_ID);
        }
      }
    }
  }, [status, notifyBleEnabled, bleDelay, prefsLoaded]);

  /* ========= Tamper attempts (VERIFY_NO_MATCH) ========= */
  useEffect(() => {
    if (!prefsLoaded) return;

    return onReceiveBytes((bytes: Uint8Array) => {
      const text = String.fromCharCode(...bytes).trim();

      if (text === 'VERIFY_NO_MATCH') {
        tamperCountRef.current += 1;
        const threshold = parseInt(tamperThreshold, 10);
        if (tamperCountRef.current >= threshold) {
          notifyNow(
            t('notifications.tamperTitle', 'Tamper warning'),
            t('notifications.tamperBody',  'Multiple failed fingerprint attempts detected.')
          );
          tamperCountRef.current = 0;
        }
      } else if (text === 'VERIFY_MATCH' || text === 'ENROLL_DONE' || text === 'Idle') {
        tamperCountRef.current = 0;
      }
    });
  }, [onReceiveBytes, tamperThreshold, prefsLoaded, t]);

  /* ========= Battery threshold (downward crossing only) ========= */
  useEffect(() => {
    if (!prefsLoaded) return;
    if (typeof batteryPct !== 'number' || isNaN(batteryPct)) return;

    const thresholdNum = parseInt(batteryThreshold, 10);
    const prev = prevBatteryRef.current;

    // Only fire when we cross DOWNWARD over the threshold.
    if (
      prev != null &&
      prev > thresholdNum &&
      batteryPct <= thresholdNum &&
      !batteryLatchBelowRef.current
    ) {
      const title = t('notifications.batteryTitle', 'Battery low');
      const body  = t('notifications.batteryBody', 'Your OffStrap battery is at {{pct}}%.', { pct: batteryPct });
      notifyNow(title, body);
      batteryLatchBelowRef.current = true;
    }

    // Re-arm when we rise back above threshold
    if (batteryPct > thresholdNum && batteryLatchBelowRef.current) {
      batteryLatchBelowRef.current = false;
    }

    prevBatteryRef.current = batteryPct;
  }, [batteryPct, batteryThreshold, prefsLoaded, t]);

  return null;
}
