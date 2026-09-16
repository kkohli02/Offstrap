// logics/bag/bagContext.tsx
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 🔹 Firebase (react-native-firebase)
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

type ProfileV2 = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  batteryPct?: number;
};

type BagContextShape = {
  firstName: string;
  lastName:  string;
  phone:     string;
  bagName: string;
  batteryPct: number;
  setProfile: (partial: Partial<ProfileV2>) => Promise<void>;
  setBatteryPct: (n: number) => Promise<void>;
};

const BagContext = createContext<BagContextShape | null>(null);

// Keys
const PROFILE_KEY   = 'profile:v2';
const LEGACY_V1     = 'bag:ctx:v1';
const LEGACY_V2     = 'bag:ctx:v2';
const MIGRATION_KEY = 'bag:migrated:cleanup:v1';

const clamp = (n: number, lo = 0, hi = 100) =>
  Math.max(lo, Math.min(hi, Math.round(n)));

const possessive = (name?: string) => {
  const s = (name || '').trim();
  if (!s) return 'Your';
  if (/s$/i.test(s)) return `${s}'`;
  return `${s}'s`;
};

const FORCE_BATTERY_TEST = true;
const FORCE_BATTERY_VALUE = 100;

// 🔹 Firestore helpers
const userDocRef = () => {
  const uid = auth().currentUser?.uid;
  if (!uid) return null;
  return firestore().collection('users').doc(uid);
};

// ✅ Write fullName (+ phone if provided) and updatedAt
async function writeProfileToRemote(firstName?: string, lastName?: string, phone?: string) {
  const ref = userDocRef();
  if (!ref) return;

  const update: any = {
    updatedAt: firestore.FieldValue.serverTimestamp(),
  };

  if (firstName !== undefined || lastName !== undefined) {
    const f = (firstName ?? '').trim();
    const l = (lastName  ?? '').trim();
    const fullName = `${f} ${l}`.trim().replace(/\s+/g, ' ');
    update.fullName = fullName;
  }

  if (phone !== undefined) {
    update.phone = (phone ?? '').trim();
  }

  const keys = Object.keys(update).filter(k => k !== 'updatedAt');
  if (keys.length === 0) return;

  await ref.set(update, { merge: true });
}

export const BagProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firstName, setFirstName] = useState<string>('');
  const [lastName,  setLastName]  = useState<string>('');
  const [phone,     setPhone]     = useState<string>('');
  const [batteryPct, _setBatteryPct] = useState<number>(100);

  // Load and migrate
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PROFILE_KEY);
        const prof: ProfileV2 = raw ? JSON.parse(raw) : {};

        if (mounted) {
          setFirstName((prof.firstName || '').trim());
          setLastName((prof.lastName  || '').trim());
          setPhone((prof.phone || '').trim());
          if (typeof prof.batteryPct === 'number') {
            _setBatteryPct(clamp(prof.batteryPct));
          }
        }

        const already = await AsyncStorage.getItem(MIGRATION_KEY);
        if (!already) {
          let migratedBattery: number | undefined = prof.batteryPct;

          const v2Raw = await AsyncStorage.getItem(LEGACY_V2);
          if (v2Raw) {
            try {
              const v2 = JSON.parse(v2Raw);
              if (typeof v2?.batteryPct === 'number') migratedBattery = clamp(v2.batteryPct);
            } catch {}
          }

          if (typeof migratedBattery !== 'number') {
            const v1Raw = await AsyncStorage.getItem(LEGACY_V1);
            if (v1Raw) {
              try {
                const v1 = JSON.parse(v1Raw);
                if (typeof v1?.batteryPct === 'number') migratedBattery = clamp(v1.batteryPct);
              } catch {}
            }
          }

          if (typeof migratedBattery === 'number') {
            const merged: ProfileV2 = { ...prof, batteryPct: migratedBattery };
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
            if (mounted) _setBatteryPct(migratedBattery);
          }

          await AsyncStorage.multiRemove([LEGACY_V1, LEGACY_V2]);
          await AsyncStorage.setItem(MIGRATION_KEY, '1');
        }

        if (FORCE_BATTERY_TEST) {
          const v = clamp(FORCE_BATTERY_VALUE);
          if (mounted) _setBatteryPct(v);
          try {
            const latestRaw = await AsyncStorage.getItem(PROFILE_KEY);
            const latest: ProfileV2 = latestRaw ? JSON.parse(latestRaw) : {};
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ ...latest, batteryPct: v }));
          } catch {}
        }

      } catch {}
    })();

    return () => { mounted = false; };
  }, []);

  // 🔹 Firestore subscriber
  useEffect(() => {
    const ref = userDocRef();
    if (!ref) return;

    const unsub = ref.onSnapshot(async snap => {
      if (!snap.exists) return;
      const data = snap.data() as any;
      if (!data) return;

      if (typeof data.fullName === 'string') {
        const full = data.fullName.trim();
        if (full.length) {
          const parts = full.split(/\s+/);
          const f = parts.shift() || '';
          const l = parts.join(' ');
          setFirstName(f);
          setLastName(l);
          try {
            const raw = await AsyncStorage.getItem(PROFILE_KEY);
            const prev: ProfileV2 = raw ? JSON.parse(raw) : {};
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({
              ...prev,
              firstName: f,
              lastName: l,
            }));
          } catch {}
        }
      }

      if (typeof data.phone === 'string') {
        const p = data.phone.trim();
        setPhone(p);
        try {
          const raw = await AsyncStorage.getItem(PROFILE_KEY);
          const prev: ProfileV2 = raw ? JSON.parse(raw) : {};
          await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ ...prev, phone: p }));
        } catch {}
      }
    });

    return () => unsub();
  }, []);

  // unified profile updater
  const setProfile = useCallback(async (partial: Partial<ProfileV2>) => {
    if (partial.firstName !== undefined) setFirstName((partial.firstName || '').trim());
    if (partial.lastName  !== undefined) setLastName((partial.lastName  || '').trim());
    if (partial.phone     !== undefined) setPhone((partial.phone     || '').trim());

    try {
      const raw = await AsyncStorage.getItem(PROFILE_KEY);
      const prev: ProfileV2 = raw ? JSON.parse(raw) : {};
      const merged: ProfileV2 = { ...prev, ...partial };
      if (typeof merged.batteryPct === 'number') {
        merged.batteryPct = clamp(merged.batteryPct);
      }
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
    } catch {}

    try {
      await writeProfileToRemote(partial.firstName, partial.lastName, partial.phone);
    } catch {}
  }, []);

  const setBatteryPct = useCallback(async (n: number) => {
    const v = clamp(n);
    _setBatteryPct(v);
    try {
      const raw = await AsyncStorage.getItem(PROFILE_KEY);
      const prev: ProfileV2 = raw ? JSON.parse(raw) : {};
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ ...prev, batteryPct: v }));
    } catch {}
  }, []);

  const bagName = useMemo(() => `${possessive(firstName)} Trail 1.0`, [firstName]);

  const value = useMemo<BagContextShape>(() => ({
    firstName,
    lastName,
    phone,
    bagName,
    batteryPct,
    setProfile,
    setBatteryPct,
  }), [firstName, lastName, phone, bagName, batteryPct, setProfile, setBatteryPct]);

  return <BagContext.Provider value={value}>{children}</BagContext.Provider>;
};

export const useBag = (): BagContextShape => {
  const ctx = useContext(BagContext);
  if (!ctx) throw new Error('useBag must be used within <BagProvider>');
  return ctx;
};
