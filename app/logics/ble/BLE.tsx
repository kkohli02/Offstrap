// logics/ble/BLE.tsx
import React,
{
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import {
  Platform,
  PermissionsAndroid,
  AppState,
  AppStateStatus,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import base64 from 'react-native-base64';

// ===== Persisted keys =====
const LAST_DEVICE_KEY = 'ble:lastDeviceId:v1';
const SIMINFO_KEY_PREFIX = 'ble:siminfo:'; // + <bagId or deviceId>

// ===== UUIDs =====
export const NUS_UUID = {
  SERVICE:        '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  RX_CHAR_WRITE:  '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  TX_CHAR_NOTIFY: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
} as const;

export const SECURE_UUID = {
  SERVICE: '8b7a1001-bf5f-4a9a-9955-2a6f8a7f6c01',
  DATA:    '8b7a1002-bf5f-4a9a-9955-2a6f8a7f6c01', // NOTIFY + WRITE
} as const;

export const OFFSTRAP_STATE = {
  SERVICE:    '8b7a0001-bf5f-4a9a-9955-2a6f8a7f6c01',
  STATE_CHAR: '8b7a0003-bf5f-4a9a-9955-2a6f8a7f6c01',
} as const;

// Device Information Service (for Bag ID)
export const DIS_UUID = {
  SERVICE: '0000180a-0000-1000-8000-00805f9b34fb',
  SERIAL:  '00002a25-0000-1000-8000-00805f9b34fb',
} as const;

// Heartbeat Characteristic (NOTIFY) under SECURE service
export const HB_UUID = {
  CHAR: '8b7a10f1-bf5f-4a9a-9955-2a6f8a7f6c01',
} as const;

type BLEStatus = 'unknown' | 'scanning' | 'connecting' | 'connected' | 'disconnected' | 'error';

type ScanHandler = (res: { id: string; name?: string | null; rssi?: number | null; device: Device }) => void;
type BytesHandler = (bytes: Uint8Array) => void;

export type SimInfo = {
  imei?: string;
  imsi?: string;
  iccid?: string;
  operator?: string;
  bagId?: string;
  simId?: string;
};

type Ctx = {
  status: BLEStatus;
  deviceId: string | null;

  startScan: (onDevice: ScanHandler) => Promise<void>;
  stopScan: () => void;
  connect: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;

  restoreLast: () => Promise<void>;
  adopt: (deviceId: string) => Promise<boolean>;
  connectById?: (deviceId: string) => Promise<boolean>;
  reconnect?: () => Promise<void>;

  batteryPct: number | null;
  batteryLabel: string;
  setBatteryLabel: (label: string) => void;
  setBatteryPct: (pct: number | null) => void;

  sendText: (text: string) => Promise<void>;
  sendSecureCommand: (ascii: string) => Promise<void>;
  onReceiveBytes: (fn: BytesHandler) => () => void;

  bagId: string | null;
  refreshBagId: () => Promise<string | null>;

  simInfo: SimInfo | null;
  refreshSimInfo: () => Promise<SimInfo | null>;
};


const BLEContext = createContext<Ctx | null>(null);

// ---------- Android-only background actions (lazy) ----------
let BackgroundActions: any = null;
if (Platform.OS === 'android') {
  try {
    BackgroundActions = require('react-native-background-actions').default;
  } catch (e) {
    console.warn('[BLE] background-actions not available:', e);
  }
}

function stringToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// base64 -> Uint8Array (for heartbeat binary payload)
function b64ToBytes(b64: string): Uint8Array {
  const s = base64.decode(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// ===== Module-scope singleton BleManager + restoration bridge =====
let _manager: BleManager | null = null;
let _onRestoredDevices: null | ((devs: Device[]) => void) = null;

function getBleManager() {
  if (_manager) return _manager;
  _manager = new BleManager({
    restoreStateIdentifier: 'offstrap.ble.restore',
    restoreStateFunction: (restoredState) => {
      const list: Device[] = restoredState?.connectedPeripherals ?? [];
      if (list.length && _onRestoredDevices) {
        _onRestoredDevices(list);
      }
    },
  });
  return _manager;
}

// These will be assigned inside BLEProvider so background task can call back in safely.
let _foregroundQuickReconnect: null | (() => Promise<void>) = null;

export const BLEProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const managerRef = useRef(getBleManager());

  const deviceRef = useRef<Device | null>(null);
  const notifySubsRef = useRef<Subscription[]>([]);
  const disconnSubRef = useRef<Subscription | null>(null);

  const [status, setStatus] = useState<BLEStatus>('unknown');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const mtuRef = useRef<number>(23);
  const rxHandlers = useRef(new Set<BytesHandler>());

  const [batteryPct, _setBatteryPct] = useState<number | null>(100);
  const [batteryLabel, _setBatteryLabel] = useState<string>('100%');

  const setBatteryPct = useCallback((pct: number | null) => {
    if (pct == null) { _setBatteryPct(null); return; }
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    _setBatteryPct(clamped);
    _setBatteryLabel(`${clamped}%`);
  }, []);

  const setBatteryLabel = useCallback((label: string) => {
    _setBatteryLabel(label);
    const m = /\b(\d{1,3})\s*%/.exec(label);
    if (m) {
      const n = parseInt(m[1], 10);
      _setBatteryPct(Math.max(0, Math.min(100, n)));
    } else if (/low/i.test(label)) {
      _setBatteryPct(15);
    }
  }, []);

  const maybeUpdateBatteryFromText = useCallback((text: string) => {
    if (/battery[_\s:-]?low/i.test(text)) { setBatteryLabel('Low'); return; }
    const match = /battery[^0-9]{0,5}(\d{1,3})\s*%?/.exec(text) || /(\d{1,3})\s*%/.exec(text);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n)) setBatteryPct(n);
    }
  }, [setBatteryLabel, setBatteryPct]);

  const [bagId, setBagId] = useState<string | null>(null);

  const [simInfo, setSimInfo] = useState<SimInfo | null>(null);
  const simInfoRef = useRef<SimInfo | null>(null);
  useEffect(() => { simInfoRef.current = simInfo; }, [simInfo]);

  const setConnected = useCallback((d: Device | null) => {
    deviceRef.current = d;
    setDeviceId(d ? d.id : null);
    setStatus(d ? 'connected' : 'disconnected');
  }, []);

  const clearNotify = useCallback(() => {
    for (const sub of notifySubsRef.current) { try { sub.remove(); } catch {} }
    notifySubsRef.current = [];
  }, []);

  const clearDisconnectedSub = useCallback(() => {
    try { disconnSubRef.current?.remove(); } catch {}
    disconnSubRef.current = null;
  }, []);

  const ensurePermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return true;
    const api = Number(Platform.Version) || 0;
    try {
      if (api >= 31) {
        const res = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          res[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
          res[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED &&
          res[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        return res === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch { return false; }
  }, []);

  const refreshBagId = useCallback(async (): Promise<string | null> => {
    const d = deviceRef.current;
    if (!d) return null;
    try {
      const ch = await managerRef.current.readCharacteristicForDevice(d.id, DIS_UUID.SERVICE, DIS_UUID.SERIAL);
      if (!ch?.value) return null;
      const text = base64.decode(ch.value).trim();
      if (text) { setBagId(text); return text; }
      return null;
    } catch (e) {
      console.warn('[BLE] Failed to read DIS Serial Number:', e);
      return null;
    }
  }, []);

  // ===== SIM Info persistence helpers =====
  const makeSimInfoKey = useCallback((idLike: string | null) => {
    const key = idLike && idLike.trim().length ? idLike.trim() : '__unknown__';
    return SIMINFO_KEY_PREFIX + key;
  }, []);

  const loadSimInfoFromStorage = useCallback(async (keyId: string | null): Promise<SimInfo | null> => {
    try {
      const st = await AsyncStorage.getItem(makeSimInfoKey(keyId));
      if (!st) return null;
      const parsed = JSON.parse(st);
      if (parsed && (parsed.imei || parsed.imsi || parsed.iccid || parsed.operator || parsed.simId)) {
        return parsed as SimInfo;
      }
      return null;
    } catch { return null; }
  }, [makeSimInfoKey]);

  const saveSimInfoToStorage = useCallback(async (info: SimInfo, keyId: string | null) => {
    try {
      await AsyncStorage.setItem(makeSimInfoKey(keyId), JSON.stringify(info));
    } catch {}
  }, [makeSimInfoKey]);

  // ---------- JSON stream assembler for SECURE ASCII ----------
  const secureBufRef = useRef<string>("");
  const SECURE_BUF_MAX = 1024;

  function extractOneJsonFromBuffer(buf: string): { obj: any | null; rest: string } {
    let i = buf.indexOf("{");
    if (i < 0) return { obj: null, rest: buf.length > SECURE_BUF_MAX ? "" : buf };

    let depth = 0;
    let inStr = false;
    let esc = false;

    for (let j = i; j < buf.length; j++) {
      const c = buf[j];

      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') { inStr = false; continue; }
        continue;
      } else {
        if (c === '"') { inStr = true; continue; }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            const jsonText = buf.slice(i, j + 1);
            try {
              const obj = JSON.parse(jsonText);
              const rest = buf.slice(j + 1);
              return { obj, rest };
            } catch {
              const next = buf.indexOf("{", i + 1);
              return { obj: null, rest: next >= 0 ? buf.slice(next) : "" };
            }
          }
        }
      }
    }

    const tail = buf.slice(i);
    return { obj: null, rest: tail.length > SECURE_BUF_MAX ? tail.slice(-SECURE_BUF_MAX) : tail };
  }

  // SECURE notify parser: grabs SIM payload JSON and persists
  const handleSecureAscii = useCallback(async (ascii: string) => {
    let obj: any = null;
    try {
      obj = JSON.parse(ascii);
    } catch {
      return;
    }

    const isDigits = (s: string) => /^[0-9]+$/.test(s);
    const hasICCID =
      obj &&
      typeof obj.iccid === "string" &&
      isDigits(obj.iccid) &&
      obj.iccid.length >= 10 &&
      obj.iccid.length <= 22;

    if (!hasICCID) return;

    const info: SimInfo = {
      bagId: String(obj.bagId || ""),
      iccid: String(obj.iccid || ""),
      simId: String(obj.iccid || ""),
    };

    if (info.bagId && info.bagId.length) {
      setBagId(prev => prev || info.bagId!);
    }

    setSimInfo(info);

    const keyId = (info.bagId && info.bagId.length)
      ? info.bagId
      : (deviceRef.current?.id || null);

    await saveSimInfoToStorage(info, keyId);

    try {
      await AsyncStorage.setItem(
        "debug:lastSimProvision",
        JSON.stringify({ ts: Date.now(), keyId, ...info })
      );
    } catch {}

    console.log("[BLE][PROVISION]", JSON.stringify(info));
    console.log("[BLE][PROVISION][SAVED]", { keyId, iccid: info.iccid, bagId: info.bagId });
  }, [saveSimInfoToStorage]);

  const enableNotifications = useCallback(async (d: Device) => {
    clearNotify();

    // STATE (ASCII)
    const subState = managerRef.current.monitorCharacteristicForDevice(
      d.id, OFFSTRAP_STATE.SERVICE, OFFSTRAP_STATE.STATE_CHAR,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const raw = base64.decode(characteristic.value);
        maybeUpdateBatteryFromText(raw);
        const bytes = stringToBytes(raw);
        rxHandlers.current.forEach((fn) => fn(bytes));
      }
    );
    notifySubsRef.current.push(subState);

    // NUS TX (ASCII)
    try {
      const subNus = managerRef.current.monitorCharacteristicForDevice(
        d.id, NUS_UUID.SERVICE, NUS_UUID.TX_CHAR_NOTIFY,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;
          const raw = base64.decode(characteristic.value);
          maybeUpdateBatteryFromText(raw);
          const bytes = stringToBytes(raw);
          rxHandlers.current.forEach((fn) => fn(bytes));
        }
      );
      notifySubsRef.current.push(subNus);
    } catch {}

    // SECURE DATA (ASCII JSON payloads incl. SIM provisioning)
    try {
      const subSecure = managerRef.current.monitorCharacteristicForDevice(
        d.id,
        SECURE_UUID.SERVICE,
        SECURE_UUID.DATA,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;
          const ascii = base64.decode(characteristic.value);

          rxHandlers.current.forEach((fn) => fn(stringToBytes(ascii)));
          console.log("🔐 [SECURE][CHUNK]", ascii);

          secureBufRef.current += ascii;
          if (secureBufRef.current.length > SECURE_BUF_MAX * 2) {
            secureBufRef.current = secureBufRef.current.slice(-SECURE_BUF_MAX);
          }

          while (true) {
            const { obj, rest } = extractOneJsonFromBuffer(secureBufRef.current);
            secureBufRef.current = rest;
            if (!obj) break;

            console.log("🔐 [SECURE][JSON]", obj);
            handleSecureAscii(JSON.stringify(obj));
          }
        }
      );
      notifySubsRef.current.push(subSecure);
    } catch (e) {
      console.warn('[BLE] SECURE DATA subscribe failed:', e);
    }

    // Heartbeat (binary 2 bytes: [counter, flags])
    try {
      const subHb = managerRef.current.monitorCharacteristicForDevice(
        d.id,
        SECURE_UUID.SERVICE,
        HB_UUID.CHAR,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;

          const bytes = b64ToBytes(characteristic.value);
          if (bytes.length < 2) return;

          const counter = bytes[0];
          const flags   = bytes[1];

          console.log('[HB] tick counter=', counter, 'flags=', flags);

          rxHandlers.current.forEach((fn) => fn(bytes));
        }
      );
      console.log('[HB] subscription requested');
      notifySubsRef.current.push(subHb);
    } catch (e) {
      console.warn('[BLE] HB subscribe failed:', e);
    }
  }, [clearNotify, maybeUpdateBatteryFromText, handleSecureAscii]);

  const primeStateRead = useCallback(async (d: Device) => {
    try {
      const ch = await managerRef.current.readCharacteristicForDevice(
        d.id,
        OFFSTRAP_STATE.SERVICE,
        OFFSTRAP_STATE.STATE_CHAR
      );
      if (ch?.value) {
        const raw = base64.decode(ch.value);
        maybeUpdateBatteryFromText(raw);
        const bytes = stringToBytes(raw);
        rxHandlers.current.forEach((fn) => fn(bytes));
      }
    } catch {}
  }, [maybeUpdateBatteryFromText]);

  const lastDeviceIdRef = useRef<string | null>(null);
  const scanningRef = useRef(false);
  const connectingRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef<number>(1200);
  const backoffMax = 15000;

  const bgScanActiveRef = useRef(false);

  const loadLastId = useCallback(async () => {
    try { lastDeviceIdRef.current = (await AsyncStorage.getItem(LAST_DEVICE_KEY)) || null; }
    catch { lastDeviceIdRef.current = null; }
  }, []);

  const stopScanInternal = useCallback(() => {
    if (scanningRef.current || bgScanActiveRef.current) {
      try { managerRef.current.stopDeviceScan(); } catch {}
    }
    scanningRef.current = false;
    bgScanActiveRef.current = false;
    if (scanStopTimerRef.current) { clearTimeout(scanStopTimerRef.current); scanStopTimerRef.current = null; }
  }, []);

  const scanForKnown = useCallback(async () => {
    const ok = await ensurePermissions(); if (!ok) return;
    if (scanningRef.current) return;
    scanningRef.current = true; setStatus('scanning');
    managerRef.current.startDeviceScan(
      [SECURE_UUID.SERVICE, NUS_UUID.SERVICE, OFFSTRAP_STATE.SERVICE],
      { allowDuplicates: false },
      (error, device) => {
        if (error || !device) return;
        const lastId = lastDeviceIdRef.current;
        if (lastId && device.id === lastId) {
          stopScanInternal();
          lastDeviceIdRef.current = device.id;
          AsyncStorage.setItem(LAST_DEVICE_KEY, device.id).catch(() => {});
          connect(device.id).catch(() => scheduleRetry());
        }
      }
    );
    scanStopTimerRef.current = setTimeout(() => { stopScanInternal(); scheduleRetry(); }, 8000);
  }, [connect, ensurePermissions, scheduleRetry, stopScanInternal]);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    const ms = backoffRef.current;
    retryTimerRef.current = setTimeout(() => { kickReconnect(); }, ms);
    backoffRef.current = Math.min(ms * 2, backoffMax);
  }, []);

  const afterConnected: (d: Device) => Promise<void> = useCallback(async (d: Device) => {
    setConnected(d);
    await d.discoverAllServicesAndCharacteristics();

    if (Platform.OS === 'android') {
      try { const dd = await d.requestMTU(247); mtuRef.current = dd?.mtu || 247; }
      catch { mtuRef.current = 23; }
    } else { mtuRef.current = 185 + 3; }

    await enableNotifications(d);
    await primeStateRead(d);

    const id = await refreshBagId();

    const cached = await loadSimInfoFromStorage(id || d.id);
    if (cached) setSimInfo(cached);

    lastDeviceIdRef.current = d.id;
    try { await AsyncStorage.setItem(LAST_DEVICE_KEY, d.id); } catch {}

    clearDisconnectedSub();
    disconnSubRef.current = managerRef.current.onDeviceDisconnected(d.id, () => {
      connectingRef.current = false;
      clearNotify();
      setConnected(null);
      setBagId(null);
      setSimInfo(null);
      scheduleRetry();
    });
  }, [
    enableNotifications,
    setConnected,
    clearDisconnectedSub,
    clearNotify,
    refreshBagId,
    primeStateRead,
    loadSimInfoFromStorage,
    scheduleRetry,
  ]);

  const retrieveKnownDevice = useCallback(async (id: string): Promise<Device | null> => {
    try { const [d1] = await managerRef.current.devices([id]); if (d1) return d1; } catch {}
    try {
      // @ts-ignore
      const list = await (managerRef.current.knownDevices?.([id]) ?? Promise.resolve([]));
      const d2 = Array.isArray(list) ? list[0] : undefined;
      if (d2) return d2;
    } catch {}
    return null;
  }, []);

  const isDeviceConnected = useCallback(async (id: string): Promise<boolean> => {
    try {
      const list = await managerRef.current.connectedDevices([SECURE_UUID.SERVICE, NUS_UUID.SERVICE, OFFSTRAP_STATE.SERVICE]);
      return !!list.find(d => d.id === id);
    } catch { return false; }
  }, []);

  // Public API: filtered scan (foreground)
  const startScan = useCallback(async (onDevice: ScanHandler) => {
    const ok = await ensurePermissions();
    if (!ok) return;
    setStatus('scanning');
    managerRef.current.startDeviceScan(
      [SECURE_UUID.SERVICE, NUS_UUID.SERVICE, OFFSTRAP_STATE.SERVICE],
      null,
      (error, device) => { if (error || !device) return; onDevice({ id: device.id, name: device.name, rssi: device.rssi, device }); }
    );
  }, [ensurePermissions]);

  const stopScan = useCallback(() => {
    try { managerRef.current.stopDeviceScan(); } catch {}
    setStatus((s) => (s === 'scanning' ? 'disconnected' : s));
  }, []);

  const safeCancelConnection = useCallback(async (id?: string | null) => {
    if (!id) return;
    try { await managerRef.current.cancelDeviceConnection(id); } catch {}
  }, []);

  const connect = useCallback(async (id: string) => {
    stopScan();
    setStatus('connecting');
    await safeCancelConnection(id);
    const options: any = Platform.select({ android: { autoConnect: true }, ios: { } });
    const connectPromise = managerRef.current.connectToDevice(id, options);
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('connect timeout')), 10000));
    const d = await Promise.race([connectPromise, timeout]) as Device;
    await afterConnected(d);
  }, [afterConnected, stopScan, safeCancelConnection]);

  const disconnect = useCallback(async () => {
    clearNotify();
    // Do not clear the disconnection subscription here; we still want
    // onDeviceDisconnected to fire and drive reconnect logic.
    const d = deviceRef.current;
    if (d) {
      try { await managerRef.current.cancelDeviceConnection(d.id); } catch {}
    }
    setConnected(null);
    setBagId(null);
    setSimInfo(null);
  }, [clearNotify, setConnected]);

  const restoreLast = useCallback(async () => {
    try {
      const list = await managerRef.current.connectedDevices([SECURE_UUID.SERVICE, NUS_UUID.SERVICE, OFFSTRAP_STATE.SERVICE]);
      if (list?.length) { await afterConnected(list[0]); return; }
      const st = await managerRef.current.state();
      if (st !== State.PoweredOn) setStatus('disconnected');
    } catch {}
  }, [afterConnected]);

  const adopt = useCallback(async (id: string) => {
    try {
      const connected = await managerRef.current.connectedDevices([SECURE_UUID.SERVICE, NUS_UUID.SERVICE, OFFSTRAP_STATE.SERVICE]);
      const already = connected.find((d) => d.id === id);
      if (already) { await afterConnected(already); return true; }
      const [dev] = await managerRef.current.devices([id]);
      if (dev && (await dev.isConnected())) { await afterConnected(dev); return true; }
    } catch {}
    return false;
  }, [afterConnected]);

  const sendSecureCommand = useCallback(async (ascii: string) => {
    const d = deviceRef.current; if (!d) throw new Error('No device');
    try { await d.discoverAllServicesAndCharacteristics(); } catch {}
    const b64 = base64.encode(ascii);
    try {
      await managerRef.current.writeCharacteristicWithResponseForDevice(d.id, SECURE_UUID.SERVICE, SECURE_UUID.DATA, b64);
    } catch (e1) {
      try {
        await managerRef.current.writeCharacteristicWithoutResponseForDevice(d.id, SECURE_UUID.SERVICE, SECURE_UUID.DATA, b64);
      } catch (e2) {
        throw new Error(`Secure write failed: ${String(e2 || e1)}`);
      }
    }
  }, []);

  const sendText = useCallback(async (text: string) => { await sendSecureCommand(text); }, [sendSecureCommand]);
  const onReceiveBytes = useCallback((fn: BytesHandler) => { rxHandlers.current.add(fn); return () => rxHandlers.current.delete(fn); }, []);

  const refreshSimInfo = useCallback(async (): Promise<SimInfo | null> => {
    const keyId = (bagId && bagId.length) ? bagId : (deviceRef.current?.id || null);

    const cached = await loadSimInfoFromStorage(keyId);
    if (cached) {
      setSimInfo(cached);
      return cached;
    }

    try {
      await sendSecureCommand('{"op":"siminfo:get"}');
    } catch {}

    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (simInfoRef.current) return simInfoRef.current;
    }

    return null;
  }, [bagId, loadSimInfoFromStorage, sendSecureCommand]);

  const forceRescanAndConnect = useCallback(async () => {
    const ok = await ensurePermissions(); if (!ok) return;

    stopScanInternal();
    connectingRef.current = false;

    const saved = lastDeviceIdRef.current;
    if (saved) await safeCancelConnection(saved);

    if (scanningRef.current) return;
    scanningRef.current = true;
    setStatus('scanning');

    let bestOffstrap: { id: string; rssi: number; name?: string | null } | null = null;
    let connected = false;

    const consider = (d: Device) => {
      const n = (d.name || '').toLowerCase();
      const looks = n.startsWith('offstrap') || n === 'offstrap' || n === 'offstrap-otp';
      if (!looks) return;
      const rssi = typeof d.rssi === 'number' ? d.rssi! : -200;
      if (!bestOffstrap || rssi > bestOffstrap.rssi) {
        bestOffstrap = { id: d.id, rssi, name: d.name };
      }
    };

    managerRef.current.startDeviceScan(
      null,
      { allowDuplicates: true },
      async (error, device) => {
        if (error || !device || connected) return;

        if (saved && device.id === saved) {
          try {
            managerRef.current.stopDeviceScan();
            scanningRef.current = false;
            setStatus('connecting');
            await safeCancelConnection(device.id);
            const dd = await managerRef.current.connectToDevice(device.id);
            await afterConnected(dd);
            connected = true;
            return;
          } catch {}
        }

        consider(device);
      }
    );

    setTimeout(async () => {
      if (connected) return;
      if (bestOffstrap) {
        try {
          managerRef.current.stopDeviceScan();
          scanningRef.current = false;
          setStatus('connecting');
          await safeCancelConnection(bestOffstrap.id);
          const dd = await managerRef.current.connectToDevice(bestOffstrap.id);
          await afterConnected(dd);
          connected = true;
          return;
        } catch {}
      }
    }, 3500);

    scanStopTimerRef.current = setTimeout(() => {
      if (!connected) {
        stopScanInternal();
        if (!deviceRef.current) setStatus('disconnected');
      }
    }, 10000);
  }, [afterConnected, ensurePermissions, safeCancelConnection, stopScanInternal]);

  const kickReconnect = useCallback(async () => {
    if (connectingRef.current) return;

    if (deviceRef.current) {
      const ok = await isDeviceConnected(deviceRef.current.id);
      if (ok) return;
      setConnected(null);
      setBagId(null);
      setSimInfo(null);
    }

    const lastId = lastDeviceIdRef.current;
    if (lastId) {
      connectingRef.current = true;
      setStatus('connecting');
      try {
        await safeCancelConnection(lastId);
        const options: any = Platform.select({ android: { autoConnect: true }, ios: {} });
        const p = managerRef.current.connectToDevice(lastId, options);
        const d = (await Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error('connect timeout')), 8000))])) as Device;
        connectingRef.current = false;
        await afterConnected(d);
        backoffRef.current = 1200;
        return;
      } catch {
        connectingRef.current = false;
      }
    }
    scanForKnown();
  }, [afterConnected, isDeviceConnected, scanForKnown, setConnected, safeCancelConnection]);

  const foregroundQuickReconnect = useCallback(async () => {
    stopScanInternal();
    connectingRef.current = false;
    backoffRef.current = 1200;

    if (!lastDeviceIdRef.current) { await loadLastId(); }
    const id = deviceRef.current?.id || lastDeviceIdRef.current;

    if (id && await isDeviceConnected(id)) return;

    if (id) {
      const known = await retrieveKnownDevice(id);
      if (known) {
        try {
          await safeCancelConnection(known.id);
          const d = await managerRef.current.connectToDevice(known.id);
          await afterConnected(d);
          return;
        } catch {}
      }
      try {
        await safeCancelConnection(id);
        const d = await managerRef.current.connectToDevice(id);
        await afterConnected(d);
        return;
      } catch {}
    }

    await forceRescanAndConnect();

    if (!deviceRef.current) {
      const ok = await ensurePermissions(); if (!ok) return;
      setStatus('scanning');
      scanningRef.current = true;
      managerRef.current.startDeviceScan(
        [SECURE_UUID.SERVICE, NUS_UUID.SERVICE, OFFSTRAP_STATE.SERVICE],
        { allowDuplicates: false },
        async (error, device) => {
          if (error || !device || deviceRef.current) return;
          try {
            managerRef.current.stopDeviceScan();
            scanningRef.current = false;
            setStatus('connecting');
            await safeCancelConnection(device.id);
            const d = await managerRef.current.connectToDevice(device.id);
            await afterConnected(d);
          } catch {}
        }
      );
      scanStopTimerRef.current = setTimeout(() => {
        stopScanInternal();
        if (!deviceRef.current) setStatus('disconnected');
      }, 7000);
    }
  }, [
    afterConnected, ensurePermissions, forceRescanAndConnect, isDeviceConnected,
    loadLastId, retrieveKnownDevice, safeCancelConnection, stopScanInternal
  ]);

  const beginBackgroundWatch = useCallback(async () => {
    if (deviceRef.current) return;
    if (bgScanActiveRef.current) return;
    const ok = await ensurePermissions(); if (!ok) return;

    bgScanActiveRef.current = true;
    managerRef.current.startDeviceScan(
      [SECURE_UUID.SERVICE],
      { allowDuplicates: false },
      async (error, device) => {
        if (error || !device) return;
        try {
          const p = managerRef.current.connectToDevice(device.id);
          const dd = await Promise.race([
            p,
            new Promise<never>((_, r) => setTimeout(() => r(new Error('bg connect timeout')), 6000)),
          ]) as Device;
          await afterConnected(dd);
        } catch {
          try {
            const dd2 = await managerRef.current.connectToDevice(device.id);
            await afterConnected(dd2);
          } catch {}
        }
      }
    );
  }, [afterConnected, ensurePermissions]);

  const stopBackgroundWatch = useCallback(() => {
    if (!bgScanActiveRef.current) return;
    try { managerRef.current.stopDeviceScan(); } catch {}
    bgScanActiveRef.current = false;
  }, []);

  // expose to background task
  useEffect(() => {
    _foregroundQuickReconnect = foregroundQuickReconnect;
    return () => { _foregroundQuickReconnect = null; };
  }, [foregroundQuickReconnect]);

  const revalidateAndReconnect = useCallback(async () => {
    const currentId = deviceRef.current?.id || lastDeviceIdRef.current;
    if (!currentId) {
      await loadLastId().catch(() => {});
      return kickReconnect();
    }
    const still = await isDeviceConnected(currentId);
    if (still) return;

    setConnected(null);
    setBagId(null);
    setSimInfo(null);
    backoffRef.current = 1200;
    kickReconnect();
  }, [isDeviceConnected, loadLastId, kickReconnect, setConnected]);

  // Register restoration bridge so iOS can hand us devices before React
  useEffect(() => {
    _onRestoredDevices = async (devs: Device[]) => {
      for (const d of devs) {
        try {
          const [full] = await managerRef.current.devices([d.id]);
          await afterConnected(full || d);
        } catch {}
      }
    };
    return () => { _onRestoredDevices = null; };
  }, [afterConnected]);

  useEffect(() => {
    loadLastId();
    let unsubBle: Subscription | null = null;
    let unsubApp: (() => void) | null = null;

    (async () => {
      await loadLastId();

      unsubBle = managerRef.current.onStateChange((st) => {
        if (st === State.PoweredOn) { revalidateAndReconnect(); }
        else if (st === State.PoweredOff) { stopScanInternal(); setStatus('disconnected'); }
      }, true);

      const onApp = (s: AppStateStatus) => {
        if (s === 'background') {
          restoreLast().finally(() => beginBackgroundWatch());
        } else if (s === 'active') {
          stopBackgroundWatch();
          foregroundQuickReconnect();
        }
      };
      const sub = AppState.addEventListener('change', onApp);
      unsubApp = () => sub.remove();

      const st = await managerRef.current.state();
      if (st === State.PoweredOn) { foregroundQuickReconnect(); }
      else { setStatus('disconnected'); }
    })();

    return () => {
      if (unsubBle) try { unsubBle.remove(); } catch {}
      if (unsubApp) try { unsubApp(); } catch {}
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      stopScanInternal();
    };
  }, [
    loadLastId,
    foregroundQuickReconnect,
    revalidateAndReconnect,
    stopScanInternal,
    beginBackgroundWatch,
    stopBackgroundWatch,
    restoreLast,
  ]);

    const value = useMemo<Ctx>(() => ({
    status,
    deviceId,
    startScan,
    stopScan,
    connect,
    disconnect,
    restoreLast,
    adopt,
    connectById: adopt,
    reconnect: foregroundQuickReconnect,
    batteryPct,
    batteryLabel,
    setBatteryLabel,
    setBatteryPct,
    sendText,
    sendSecureCommand,
    onReceiveBytes,
    bagId,
    refreshBagId,
    simInfo,
    refreshSimInfo,
  }), [
    status,
    deviceId,
    startScan,
    stopScan,
    connect,
    disconnect,
    restoreLast,
    adopt,
    foregroundQuickReconnect,
    batteryPct,
    batteryLabel,
    setBatteryLabel,
    setBatteryPct,
    sendText,
    sendSecureCommand,
    onReceiveBytes,
    bagId,
    refreshBagId,
    simInfo,
    refreshSimInfo,
  ]);


  return <BLEContext.Provider value={value}>{children}</BLEContext.Provider>;
};

export function useBLE(): Ctx {
  const ctx = useContext(BLEContext);
  if (!ctx) throw new Error('useBLE must be used inside <BLEProvider>');
  return ctx;
}

// ---------- Android-only background keeper helpers ----------

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function bleKeeperTask({ intervalMs = 120000 }: { intervalMs?: number } = {}) {
  if (Platform.OS !== 'android' || !BackgroundActions) return;
  while (await BackgroundActions.isRunning()) {
    try {
      if (AppState.currentState !== 'active' && _foregroundQuickReconnect) {
        await _foregroundQuickReconnect();
      }
    } catch {}
    await sleep(intervalMs);
  }
}

const bgOptions = {
  taskName: 'OffStrap BLE',
  taskTitle: 'OffStrap is ready nearby',
  taskDesc: 'Keeping connection ready for your bag',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' as const },
  color: '#ffffff',
  parameters: { intervalMs: 120000 },
};

export async function startBleKeeper() {
  if (Platform.OS !== 'android' || !BackgroundActions) return;
  try {
    if (await BackgroundActions.isRunning()) return;
    await BackgroundActions.start(bleKeeperTask, bgOptions);
  } catch (e) {
    console.log('[BLE] startBleKeeper err', e);
  }
}

export async function stopBleKeeper() {
  if (Platform.OS !== 'android' || !BackgroundActions) return;
  try {
    if (!(await BackgroundActions.isRunning())) return;
    await BackgroundActions.stop();
  } catch (e) {
    console.log('[BLE] stopBleKeeper err', e);
  }
}
