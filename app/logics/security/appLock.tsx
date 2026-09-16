// logics/security/appLock.tsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics from 'react-native-biometrics';

const ENABLED_KEY = 'applock:enabled:v1';
const DEFAULT_GRACE_SECONDS = 0;

type Ctx = {
  enabled: boolean;
  setEnabled: (v: boolean) => Promise<void>;
  isLocked: boolean;
  lockNow: () => void;
  unlock: () => void;
  authenticateOnce: (reason?: string) => Promise<boolean>;
  setGraceSeconds: (sec: number) => void;
};

const C = createContext<Ctx | null>(null);

export const AppLockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabledState] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [graceSeconds, setGraceSeconds] = useState<number>(DEFAULT_GRACE_SECONDS);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const lastBackgroundAt = useRef<number | null>(null);

  // load persisted enabled flag
  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem(ENABLED_KEY);
        if (s === '1')
        {
          setEnabledState(true);
          setIsLocked(true);
        }
        
      } catch {}
    })();
  }, []);

  // background/foreground handling
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current;
      appState.current = next;

      if (!enabled) return;

      if (prev.match(/active|inactive/) && next === 'background') {
        lastBackgroundAt.current = Date.now();
      } else if (prev === 'background' && next.match(/active|inactive/)) {
        const now = Date.now();
        const secs = lastBackgroundAt.current ? (now - lastBackgroundAt.current) / 1000 : Infinity;
        if (secs >= graceSeconds) setIsLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled, graceSeconds]);

  const setEnabled = async (v: boolean) => {
    setEnabledState(v);
    try { await AsyncStorage.setItem(ENABLED_KEY, v ? '1' : '0'); } catch {}
    if (!v) setIsLocked(false);
    else setIsLocked(true); // lock immediately on enable
  };

  const lockNow = () => { if (enabled) setIsLocked(true); };
  const unlock = () => setIsLocked(false);

  const authenticateOnce = async (reason?: string) => {
    try {
      const rn = new ReactNativeBiometrics();
      const res = await rn.simplePrompt({ promptMessage: reason || 'Unlock' });
      return !!res.success;
    } catch {
      return false;
    }
  };

  return (
    <C.Provider value={{ enabled, setEnabled, isLocked, lockNow, unlock, authenticateOnce, setGraceSeconds }}>
      {children}
    </C.Provider>
  );
};

export const useAppLock = () => {
  const ctx = useContext(C);
  if (!ctx) throw new Error('useAppLock must be used within AppLockProvider');
  return ctx;
};

// Full-screen overlay shown when locked
export const AppLockGate: React.FC<{ title?: string; subtitle?: string }> = ({
  title = 'Locked',
  subtitle = Platform.OS === 'ios' ? 'Unlock with Face ID' : 'Unlock with biometrics',
}) => {
  const { enabled, isLocked, authenticateOnce, unlock } = useAppLock();
  if (!enabled || !isLocked) return null;

  const onUnlock = async () => {
    const ok = await authenticateOnce('Authenticate to continue');
    if (ok) unlock();
  };

  return (
    <View style={styles.gate}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <TouchableOpacity onPress={onUnlock} activeOpacity={0.9} style={styles.btn}>
          <Text style={styles.btnText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  gate: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999, alignItems: 'center', justifyContent: 'center',
  },
  card: {
    width: '80%', backgroundColor: '#0f0f0f', borderWidth: 1, borderColor: '#222',
    borderRadius: 16, padding: 20, alignItems: 'center',
  },
  title: { color: '#fff', fontSize: 20, fontFamily: 'MontserratAlt1-SemiBold' },
  subtitle: { color: '#bbb', fontSize: 14, marginTop: 8, textAlign: 'center', fontFamily: 'MontserratAlt1-Regular' },
  btn: { marginTop: 18, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: '#007AFF', borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 16, fontFamily: 'MontserratAlt1-SemiBold' },
});
