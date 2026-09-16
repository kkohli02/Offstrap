// screens/dashboard.tsx
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { BleManager } from 'react-native-ble-plx';
import {
  AppState,
  View,
  Text,
  StyleSheet,
  Dimensions,
  PanResponder,
  Animated,
  TouchableOpacity,
  Image,
  Alert,
  Modal,
  TouchableWithoutFeedback,
  Linking,
} from 'react-native';
import { InteractionManager } from 'react-native';
import type { ViewStyle, ImageSourcePropType, LayoutChangeEvent } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import LottieView from 'lottie-react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import lockAnimation from '../assets/lockLottie.json';

// BLE + Bag contexts
import { useBLE } from '../logics/ble/BLE';
import { useBag } from '../logics/bag/bagContext';
const DEFAULT_ZOOM = 15; // consistent zoom level across all map actions


/* ======================= BatteryIndicator ======================= */
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

const { height: screenHeight, width: screenWidth } = Dimensions.get('window');
const scale = (size: number) => (screenWidth / 375) * size;
const verticalScale = (size: number) => (screenHeight / 812) * size;
const moderateScale = (size: number, factor = 0.5) => size + (scale(size) - size) * factor;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const BatteryIndicatorInner: React.FC<BatteryIndicatorProps> = ({ level, style, source }) => {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const anim = useRef(new Animated.Value(clamp01((+level || 0) / 100))).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: clamp01((+level || 0) / 100), duration: 400, useNativeDriver: false }).start();
  }, [level, anim]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - dims.w) > 0.5 || Math.abs(height - dims.h) > 0.5) setDims({ w: width, h: height });
  }, [dims.w, dims.h]);

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

const BatteryIndicator = React.memo(BatteryIndicatorInner);
/* ========================================================================== */

// ---- Lock animation frame/duration ----
const LOCK_START_FRAME = 0;
const LOCK_END_FRAME = 60;
const LOCK_ANIM_DURATION_MS = 1000;
const LOCK_WAIT_MS = 5000;

// ⭐ RSSI → distance estimate (tunable)
const estimateDistanceMeters = (rssi: number, txPowerAt1m = -65, n = 2.2) => {
  if (!Number.isFinite(rssi)) return NaN;
  const exp = (txPowerAt1m - rssi) / (10 * n);
  const d = Math.pow(10, exp);
  return Math.max(0, Math.min(d, 50)) * 0.5;
};
const distanceLabel = (m: number) => {
  if (!Number.isFinite(m)) return 'unknown';
  if (m < 0.7) return 'very close';
  if (m < 2.0) return 'nearby';
  if (m < 5.0) return 'in the area';
  return 'far away';
};

// Bytes -> UTF-8 text
const bytesToUtf8 = (bytes: Uint8Array): string => {
  try {
    const pct = Array.from(bytes).map((b) => '%' + b.toString(16).padStart(2, '0')).join('');
    return decodeURIComponent(pct);
  } catch {
    return String.fromCharCode(...Array.from(bytes));
  }
};

// ⭐ Bag location persistence
const BAG_LAST_LOC_KEY = 'offstrap:lastBagLocation:v1';

// Small helper: distance between two lat/lon in meters (rough)
const toRad = (d: number) => (d * Math.PI) / 180;
const distMeters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const R = 6371e3;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

// ⭐ Open Google Maps directions to a coordinate
const openGoogleMaps = (coord: { latitude: number; longitude: number }) => {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${coord.latitude},${coord.longitude}`;
  Linking.openURL(url).catch((err) => console.error('Failed to open Google Maps', err));
};

type NetworkBoxProps = { strength: 0 | 1 | 2 | 3 | 4; type?: string };
const NetworkBoxInner: React.FC<NetworkBoxProps> = ({ strength, type = '4G' }) => {
  const { t } = useTranslation();
  const colorFor = (i: number) => {
    if (i >= strength) return '#8A8A8A';
    if (strength === 1) return '#ff5252';
    if (strength === 2) return '#ff9800';
    return '#00FF00';
  };

  return (
    <View style={[styles.button, styles.primaryButton, styles.primaryButtonLeft]}>
      <View style={styles.netBox}>
        <View style={styles.netBars} accessibilityLabel={`signal-${strength}`}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.netBar,
                { height: verticalScale(7) + i * verticalScale(10) * 0.85, backgroundColor: colorFor(i) },
              ]}
            />
          ))}
        </View>
        <View style={{ flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.netTitle}>{t('dashboard.network')}</Text>
            {strength === 0 && <Text style={styles.netNo}>  {t('dashboard.noSignal')}</Text>}
          </View>
          <Text style={styles.netType}>{type}</Text>
        </View>
      </View>
    </View>
  );
};

const NetworkBox = React.memo(NetworkBoxInner);

const Dashboard: React.FC<any> = ({ navigation }) => {
  const { t } = useTranslation();
  const { status: bleStatus, deviceId, restoreLast, onReceiveBytes, sendText, adopt, reconnect } = useBLE();
  const { bagName, batteryPct, setBatteryPct } = useBag();
  const route = useRoute<any>();

  const [isExpanded, setIsExpanded] = useState(false);
  const [networkType] = useState('4G');
  const [networkStrength] = useState<0 | 1 | 2 | 3 | 4>(4);
  const [isLocked, setIsLocked] = useState(true);

  // ⭐ Alarm UI state (for the secondary button)
  const [alarmActive, setAlarmActive] = useState(false);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ⭐ Track modal state
  const [trackOpen, setTrackOpen] = useState(false);
  const [buzzOn, setBuzzOn] = useState(false);

  // RSSI smoothing
  const WINDOW = 10;
  const POLL_MS = 250;
  const rssiBufRef = useRef<number[]>([]);
  const [rssiAvg, setRssiAvg] = useState<number | null>(null);
  const [rssiCount, setRssiCount] = useState(0);

  // Arrival & close timer
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [arrived, setArrived] = useState(false);

  const mgrRef = useRef<BleManager | null>(null);
  const [osConnected, setOsConnected] = useState(false);
  const [osDeviceId, setOsDeviceId] = useState<string | null>(null);

  const lockAnimationRef = useRef<LottieView>(null);
  const reverseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseDoneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lockLabelOverride, setLockLabelOverride] = useState<string | null>(null);

  const mapDimProgress = useRef(new Animated.Value(0)).current;
  const mapDimOpacity = mapDimProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45], extrapolate: 'clamp' });

  // ⭐ NEW: user gps vs bag (last saved) gps
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [bagLocation, setBagLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [bagLocLoaded, setBagLocLoaded] = useState(false); // to animate camera once we know where to start

  useEffect(() => {
    mgrRef.current = new BleManager();
    return () => {
      try { mgrRef.current?.destroy(); } catch {}
      mgrRef.current = null;
    };
  }, []);

  const isBleConnected = bleStatus === 'connected' && !!deviceId;
  const isActuallyConnected = isBleConnected || osConnected;

    useEffect(() => {
    const fromSettings = (route?.params as any)?.fromSettings;

    if (fromSettings && bleStatus !== 'connected' && reconnect) {
      reconnect().catch(() => {});
    }

    if (fromSettings && navigation?.setParams) {
      navigation.setParams({ fromSettings: undefined });
    }
  }, [route?.params, bleStatus, reconnect, navigation]);

  const checkOsConnected = useCallback(async () => {
    try {
      const mgr = mgrRef.current;
      if (!mgr) return;
      const list = await mgr.connectedDevices(['6e400001-b5a3-f393-e0a9-e50e24dcca9e']);
      if (list && list.length > 0) {
        const dev = list[0];
        setOsConnected(true);
        setOsDeviceId(dev.id);
        if (!isBleConnected && adopt) adopt(dev.id);
      } else {
        setOsConnected(false);
        setOsDeviceId(null);
      }
    } catch {}
  }, [isBleConnected, adopt]);

  // Load last saved bag location on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(BAG_LAST_LOC_KEY);
        if (raw) {
          const json = JSON.parse(raw);
          if (json && typeof json.latitude === 'number' && typeof json.longitude === 'number') {
            setBagLocation({ latitude: json.latitude, longitude: json.longitude });
          }
        }
      } catch {}
      setBagLocLoaded(true);
    })();
  }, []);

  // Helper to persist bag location (throttled by distance)
  const persistBagLocation = useCallback(async (loc: { latitude: number; longitude: number }) => {
    try {
      await AsyncStorage.setItem(
        BAG_LAST_LOC_KEY,
        JSON.stringify({ ...loc, ts: Date.now() })
      );
    } catch {}
  }, []);

  // If BLE is connected and we have a fresh userLocation, update bagLocation (only if moved > ~15m)
  useEffect(() => {
    if (!isActuallyConnected || !userLocation) return;
    if (!bagLocation) {
      setBagLocation(userLocation);
      persistBagLocation(userLocation);
      return;
    }
    const d = distMeters(bagLocation, userLocation);
    if (d > 15) {
      setBagLocation(userLocation);
      persistBagLocation(userLocation);
    }
  }, [isActuallyConnected, userLocation, bagLocation, persistBagLocation]);

  useEffect(() => {
    restoreLast();
    checkOsConnected();
    let n = 0;
    const warm = setInterval(() => {
      checkOsConnected();
      if (++n >= 4) clearInterval(warm);
    }, 1500);
    return () => clearInterval(warm);
  }, [restoreLast, checkOsConnected]);

  useFocusEffect(useCallback(() => { checkOsConnected(); restoreLast(); }, [checkOsConnected, restoreLast]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { checkOsConnected(); restoreLast(); }
    });
    return () => sub.remove();
  }, [checkOsConnected, restoreLast]);

  const connectionLabel = useMemo(
    () => (isActuallyConnected ? t('dashboard.connected') : t('dashboard.disconnected')),
    [isActuallyConnected, t]
  );
  const bluetoothIcon = useMemo(
    () => (isActuallyConnected ? require('../assets/bluetooth.png') : require('../assets/bluetoothOFF.png')),
    [isActuallyConnected]
  );

  const handleBleDataReceived = useCallback((data: string) => {
    switch (data.toLowerCase()) {
      case 'battery_low':
        setBatteryPct(15);
        break;
      case 'unlocked':
        setIsLocked(false);
        break;
      case 'locked':
        setIsLocked(true);
        break;
      default:
        if (data.startsWith('battery=')) {
          const n = parseInt(data.split('=')[1], 10);
          if (!Number.isNaN(n)) setBatteryPct(n);
        }
        break;
    }
  }, [setBatteryPct]);

  useEffect(() => {
    const maybeUnsub = onReceiveBytes((bytes) => {
      const text = bytesToUtf8(bytes).trim();
      if (text) handleBleDataReceived(text);
    });
    return typeof maybeUnsub === 'function' ? maybeUnsub : undefined;
  }, [onReceiveBytes, handleBleDataReceived]);

  const sendBleCommand = useCallback(async (command: string) => {
    if (!isBleConnected && osConnected && osDeviceId && adopt) {
      adopt(osDeviceId);
      Alert.alert(t('dashboard.connectingTitle'), t('dashboard.connectingBody'));
      return;
    }
    if (!isBleConnected) {
      Alert.alert(t('dashboard.notConnectedTitle'), t('dashboard.notConnectedBody'));
      return;
    }
    try {
      await sendText(command);
    } catch {
      Alert.alert(t('dashboard.cmdFailedTitle'), t('dashboard.cmdFailedBody'));
    }
  }, [isBleConnected, osConnected, osDeviceId, adopt, sendText, t]);

  // Ensure lock animation shows first frame (closed) on mount
  const ensureLockAtStart = useCallback(() => {
    const inst = lockAnimationRef.current;
    if (!inst) return;
    inst.reset();
    requestAnimationFrame(() => inst.play(LOCK_START_FRAME, LOCK_START_FRAME));
    setLockLabelOverride(null);
  }, []);

  useEffect(() => {
    ensureLockAtStart();
    return () => {
      if (reverseTimeoutRef.current) clearTimeout(reverseTimeoutRef.current);
      if (reverseDoneTimeoutRef.current) clearTimeout(reverseDoneTimeoutRef.current);
      reverseTimeoutRef.current = null;
      reverseDoneTimeoutRef.current = null;
      // Cleanup alarm auto-reset timer on unmount
      if (alarmTimerRef.current) {
        clearTimeout(alarmTimerRef.current);
        alarmTimerRef.current = null;
      }
    };
  }, [ensureLockAtStart]);

  // On press: play forward then reverse
  const playForwardThenReverse = useCallback(async () => {
    const inst = lockAnimationRef.current;
    if (!inst) return;

    try { await sendBleCommand('unlock'); } catch {}

    if (reverseTimeoutRef.current) clearTimeout(reverseTimeoutRef.current);
    if (reverseDoneTimeoutRef.current) clearTimeout(reverseDoneTimeoutRef.current);
    reverseTimeoutRef.current = null;
    reverseDoneTimeoutRef.current = null;

    setLockLabelOverride(t('dashboard.unlocked'));

    inst.reset();
    requestAnimationFrame(() => {
      inst.play(LOCK_START_FRAME, LOCK_END_FRAME);

      reverseTimeoutRef.current = setTimeout(() => {
        inst.play(LOCK_END_FRAME, LOCK_START_FRAME);

        reverseDoneTimeoutRef.current = setTimeout(() => {
          setLockLabelOverride(t('dashboard.locked'));
          requestAnimationFrame(() => inst.play(LOCK_START_FRAME, LOCK_START_FRAME));
        }, LOCK_ANIM_DURATION_MS);
      }, LOCK_WAIT_MS);
    });
  }, [sendBleCommand, t]);

  // Map
  const mapRef = useRef<MapView>(null);
  const didCenterOnStart = useRef(false);
  const [mapRegion] = useState({
    latitude: 37.78825,
    longitude: -122.4324,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });
  const customMapStyle = useMemo(() => [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }], []);

  // Center once we know a starting point (prefer bagLocation, else userLocation)
  useFocusEffect(
  useCallback(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      if (didCenterOnStart.current || !bagLocLoaded) return;
      const target = bagLocation || userLocation;
      if (target) {
        didCenterOnStart.current = true;
        mapRef.current?.animateCamera(
  { center: target, zoom: DEFAULT_ZOOM, heading: 0, pitch: 0 },
  { duration: 250 }
);

      }
    });
    return () => task.cancel?.();
  }, [bagLocLoaded, bagLocation, userLocation])
);

  // Helpers
  const resetTrackState = useCallback(() => {
    rssiBufRef.current = [];
    setRssiAvg(null);
    setRssiCount(0);
    setArrived(false);
  }, []);

  // Close tracking
  const closeTracking = useCallback(() => {
    setTrackOpen(false);
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    sendBleCommand('TRACK_STOP');
    if (buzzOn) {
      setBuzzOn(false);
      sendBleCommand('ALARM_OFF');
    }
    resetTrackState();
  }, [buzzOn, sendBleCommand, resetTrackState]);

  // Toggle buzzer (tracking modal)
  const toggleBuzz = useCallback(() => {
    if (buzzOn) {
      setBuzzOn(false);
      sendBleCommand('ALARM_OFF');
    } else {
      setBuzzOn(true);
      sendBleCommand('ALARM_ON');
    }
  }, [buzzOn, sendBleCommand]);

  // RSSI sampling for tracking modal
  useEffect(() => {
    let timer: any;
    let mounted = true;

    const poll = async () => {
      if (!trackOpen || !isBleConnected || !mgrRef.current || !deviceId || arrived) return;
      try {
        const reading = await mgrRef.current.readRSSIForDevice(deviceId);
        const val = (reading as any)?.rssi;
        if (mounted && typeof val === 'number') pushRssi(val);
      } catch {}
    };

    if (trackOpen && !arrived) {
      poll();
      timer = setInterval(poll, POLL_MS);
    }
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [trackOpen, isBleConnected, deviceId, arrived]);

  const pushRssi = useCallback((val: number) => {
    if (arrived) return;
    const buf = rssiBufRef.current.slice();
    buf.push(val);
    while (buf.length > WINDOW) buf.shift();
    rssiBufRef.current = buf;
    setRssiCount(buf.length);
    if (buf.length === WINDOW) {
      const sum = buf.reduce((a, b) => a + b, 0);
      setRssiAvg(sum / WINDOW);
    } else {
      setRssiAvg(null);
    }
  }, [arrived]);

  const dMeters = useMemo(() => (rssiAvg == null ? NaN : estimateDistanceMeters(rssiAvg)), [rssiAvg]);
  useEffect(() => {
    if (!trackOpen) return;
    if (rssiAvg == null) return;
    const nowArrived = Number.isFinite(dMeters) && dMeters < 0.50;
    if (nowArrived && !arrived) {
      setArrived(true);
      if (buzzOn) {
        setBuzzOn(false);
        sendBleCommand('ALARM_OFF');
      }
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        closeTracking();
      }, 5000);
    }
  }, [trackOpen, dMeters, rssiAvg, arrived, buzzOn, sendBleCommand, closeTracking]);

  // When alarmActive becomes true (user pressed "Alarm"), auto-reset UI after 30s.
  useEffect(() => {
    if (alarmActive) {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
      alarmTimerRef.current = setTimeout(() => {
        // Do NOT send ALARM_OFF here; Arduino already turns it off after 30s.
        setAlarmActive(false);
      }, 30_000);
    } else {
      // If turned off early, clear any pending auto-reset timer
      if (alarmTimerRef.current) {
        clearTimeout(alarmTimerRef.current);
        alarmTimerRef.current = null;
      }
    }
  }, [alarmActive]);

  return (
    <View style={styles.container}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialCamera={{
  center: bagLocation || userLocation || { latitude: 28.6139, longitude: 77.2090 }, // fallback (Delhi)
  zoom: DEFAULT_ZOOM,
  pitch: 0,
  heading: 0,
}}
        customMapStyle={customMapStyle}
        showsUserLocation
        showsMyLocationButton
        showsCompass
        showsScale
        pitchEnabled
        rotateEnabled
        zoomEnabled
        scrollEnabled
        onUserLocationChange={(evt) => {
          const c = evt.nativeEvent.coordinate;
          if (!c) return;
          const u = { latitude: c.latitude, longitude: c.longitude };
          setUserLocation(u);

          // If connected, treat phone's GPS as bag location (and persist with threshold)
          if (isActuallyConnected) {
            if (!bagLocation || distMeters(bagLocation, u) > 15) {
              setBagLocation(u);
              persistBagLocation(u);
            }
          }
        }}
      >
        {bagLocation && (
          <Marker
            coordinate={bagLocation}
            title={bagName}
            description={`${connectionLabel}`}
            pinColor="#ff6b35"
            onPress={() => openGoogleMaps(bagLocation)}
          >
            <View style={styles.customMarker}>
              <Image source={require('../assets/bag.jpeg')} style={styles.markerIcon} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Dim the map as the sheet expands */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000', opacity: mapDimOpacity }]}
      />

      {/* MAP CONTROLS */}
      <View style={styles.mapControls}>
        <TouchableOpacity
          style={styles.mapControlButton}
          onPress={() => {
  const target = bagLocation || userLocation;
  if (!target) return;
  mapRef.current?.animateCamera(
  { center: target, zoom: DEFAULT_ZOOM, heading: 0, pitch: 0 },
  { duration: 350 }
);
}}
        >
          <Image style={styles.mapButtonIcon} source={require('../assets/mapCenter.png')} />
        </TouchableOpacity>
      </View>

      {/* BOTTOM SHEET */}
      <BottomSheet
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}
        isLocked={isLocked}
        batteryPct={batteryPct}
        bagName={bagName}
        bluetoothIcon={bluetoothIcon}
        connectionLabel={connectionLabel}
        networkStrength={networkStrength}
        networkType={networkType}
        toggleLockAnimation={() => {}}
        navigation={navigation}
        lockAnimationRef={lockAnimationRef}
        debug={{ bleStatus, deviceId, osConnected, osDeviceId, isActuallyConnected }}
        onProgress={(v: number) => mapDimProgress.setValue(v)}
        playForwardThenReverse={playForwardThenReverse}
        lockLabelOverride={lockLabelOverride}
        sendBleCommand={sendBleCommand}
        onOpenTrack={() => {
          setBuzzOn(false);
          resetTrackState();
          setTrackOpen(true);
          sendBleCommand('TRACK_PING');
        }}
        alarmActive={alarmActive}
        setAlarmActive={setAlarmActive}
      />

      {/* ⭐ Tracking modal */}
      <TrackModal
        visible={trackOpen}
        ready={rssiCount >= WINDOW}
        distanceMeters={dMeters}
        arrived={arrived}
        buzzerOn={buzzOn}
        onToggleBuzz={toggleBuzz}
        onClose={closeTracking}
      />
    </View>
  );
};

const BottomSheet = (props: any) => {
  const { t } = useTranslation();
  const {
    isExpanded, setIsExpanded, isLocked, batteryPct, bagName, bluetoothIcon, connectionLabel,
    networkStrength, networkType, navigation, lockAnimationRef, debug, onProgress,
    playForwardThenReverse, lockLabelOverride,
    sendBleCommand,
    onOpenTrack,
    alarmActive,
    setAlarmActive,
  } = props;

  const collapsedHeight = screenHeight * 0.38;
  const expandedHeight = screenHeight * 0.56;
  const dragRange = expandedHeight - collapsedHeight;

  const sheetProgress = useRef(new Animated.Value(0)).current;
  const expOpacity = sheetProgress.interpolate({ inputRange: [0.0, 0.35, 0.55, 1], outputRange: [0, 0, 1, 1] });
  const expTranslate = sheetProgress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [10, 10, 0] });
  const sheetBgColor = sheetProgress.interpolate({ inputRange: [0, 1], outputRange: ['rgba(14,14,14,0.98)', 'rgba(14,14,14,1)'] });
  const animatedHeight = sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [collapsedHeight, expandedHeight] });

  const startProgressRef = useRef(0);
  const currentProgressRef = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        sheetProgress.stopAnimation((v: number) => { startProgressRef.current = v || 0; });
      },
      onPanResponderMove: (_evt, g) => {
        const next = startProgressRef.current - g.dy / dragRange;
        const v = Math.max(0, Math.min(1, next));
        sheetProgress.setValue(v);
      },
      onPanResponderRelease: (_evt, g) => {
        const prog = currentProgressRef.current;
        const shouldExpand = g.vy < -0.5 || (g.vy <= 0.5 && prog >= 0.5);
        Animated.spring(sheetProgress, {
          toValue: shouldExpand ? 1 : 0,
          useNativeDriver: false,
          tension: 220,
          friction: 18,
        }).start(() => setIsExpanded(shouldExpand));
      },
      onPanResponderTerminate: () => {
        const prog = currentProgressRef.current;
        const target = prog >= 0.5 ? 1 : 0;
        Animated.spring(sheetProgress, {
          toValue: target,
          useNativeDriver: false,
          tension: 220,
          friction: 18,
        }).start(() => setIsExpanded(target === 1));
      },
    })
  ).current;

  useEffect(() => {
    const id = sheetProgress.addListener(({ value }) => {
      currentProgressRef.current = value;
      if (typeof onProgress === 'function') onProgress(value);
    });
    return () => { sheetProgress.removeListener(id); };
  }, [sheetProgress, onProgress]);

  return (
    <Animated.View
      style={[styles.tabContainer, { height: animatedHeight, backgroundColor: sheetBgColor }]}
      {...panResponder.panHandlers}
    >
      <View style={styles.pullIndicatorContainer}><View style={styles.pullIndicator} /></View>

      <View style={styles.tabContent}>
        {/* Header card */}
        <View style={styles.bagInfoCard}>
          <View style={styles.bagIconContainer}>
            <View style={styles.bagIconHolder}>
              <Image source={require('../assets/bag.jpeg')} style={styles.bagIcon} />
            </View>
          </View>
          <View style={styles.bagInfoTextContainer}>
            <Text style={styles.bagInfoCenterTitle} numberOfLines={1}>{bagName}</Text>
            <View style={[styles.row, { alignItems: 'center', height: 20, justifyContent: 'flex-start' }]}> 
              <BatteryIndicator level={batteryPct} style={styles.batIcon} />
              <Text style={styles.bagConnectionText}>{`${batteryPct}%`}</Text>
            </View>
          </View>
        </View>

        {/* Primary row */}
        <View style={styles.row}>
          <NetworkBox strength={networkStrength} type={networkType} />
          <View style={[styles.button, styles.primaryButton, styles.primaryButtonRight]}>
            <View style={styles.primaryButtonContent}>
              <Image source={bluetoothIcon} style={styles.primaryButtonIcon} />
              <View style={styles.primaryButtonTextContainer}>
                <Text style={styles.buttonText}>{t('dashboard.bluetooth')}</Text>
                <Text style={styles.buttonText} numberOfLines={1}>{connectionLabel}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Secondary row */}
        <View style={styles.row}>
          {/* LOCK */}
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton, styles.secondaryButtonLeft]}
            onPress={props.playForwardThenReverse}
            activeOpacity={0.85}
          >
            <View style={styles.secondaryContent}>
              <View style={styles.lockIconSlot}>
                <LottieView
                  ref={props.lockAnimationRef}
                  source={lockAnimation}
                  style={styles.lockIcon}
                  autoPlay={false}
                  loop={false}
                  colorFilters={[{ keypath: '*', color: '#ffffff' }]}
                />
              </View>
              <View style={styles.lockLabelSlot}>
                <Text style={styles.secondaryButtonText}>
                  {props.lockLabelOverride ?? (props.isLocked ? t('dashboard.locked') : t('dashboard.unlocked'))}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* TRACK */}
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={props.onOpenTrack}
            activeOpacity={0.85}
          >
            <View style={styles.secondaryContent}>
              <View style={styles.lockIconSlot}>
                <Image source={require('../assets/location.png')} style={styles.lockIcon} />
              </View>
              <View style={styles.lockLabelSlot}>
                <Text style={styles.secondaryButtonText}>{t('dashboard.track')}</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* ALARM (toggle) */}
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton, styles.secondaryButtonRight]}
            onPress={() => {
              if (alarmActive) {
                setAlarmActive(false);
                sendBleCommand('ALARM_OFF');
              } else {
                setAlarmActive(true);
                sendBleCommand('ALARM_ON');
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.secondaryContent}>
              <View style={styles.lockIconSlot}>
                <Image source={require('../assets/alarm.png')} style={styles.lockIcon} />
              </View>
              <View style={styles.lockLabelSlot}>
                <Text style={styles.secondaryButtonText}>{alarmActive ? t('dashboard.alarmOff') : t('dashboard.alarm')}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Expanded section */}
        <Animated.View style={{ opacity: expOpacity, transform: [{ translateY: expTranslate }] }}>
          <TouchableOpacity style={[styles.button, styles.tertiaryButton]} onPress={() => props.navigation.navigate('BagHub')}>
            <View style={styles.centerRow}>
              <Image source={require('../assets/bagHub.png')} style={styles.secondaryButtonIcon} />
              <Text style={styles.tertiaryLabel}>{t('dashboard.bagHub')}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, styles.tertiaryButton]} onPress={() => props.navigation.navigate('Settings')}>
            <View style={styles.centerRow}>
              <Image source={require('../assets/settings.png')} style={styles.secondaryButtonIcon} />
              <Text style={styles.tertiaryLabel}>{t('dashboard.settings')}</Text>
            </View>
          </TouchableOpacity>

          {/* Debug (kept in English) */}
          <View style={styles.debugPanel}>
            <Text style={styles.debugTitle}>Debug</Text>
            <Text style={styles.debugLine}>BLE Status (provider): {debug.bleStatus}</Text>
            <Text style={styles.debugLine}>Provider Device ID: {debug.deviceId || '-'}</Text>
            <Text style={styles.debugLine}>OS Connected: {String(debug.osConnected)}</Text>
            <Text style={styles.debugLine}>OS Device ID: {debug.osDeviceId || '-'}</Text>
            <Text style={styles.debugLine}>Effective Connected: {String(debug.isActuallyConnected)}</Text>
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
};

/* ========================= TrackModal ========================= */
const TrackModalInner: React.FC<{
  visible: boolean;
  ready: boolean;
  distanceMeters: number;
  arrived: boolean;
  buzzerOn: boolean;
  onToggleBuzz: () => void;
  onClose: () => void;
}> = ({ visible, ready, distanceMeters, arrived, buzzerOn, onToggleBuzz, onClose }) => {
  if (!visible) return null;

  const scale1 = useRef(new Animated.Value(0)).current;
  const scale2 = useRef(new Animated.Value(0)).current;
  const opacity1 = useRef(new Animated.Value(0)).current;
  const opacity2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible || arrived) {
      scale1.stopAnimation(); scale2.stopAnimation();
      opacity1.stopAnimation(); opacity2.stopAnimation();
      scale1.setValue(0); scale2.setValue(0);
      opacity1.setValue(0); opacity2.setValue(0);
      return;
    }

    const loopRing = (s: Animated.Value, o: Animated.Value, delayMs: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.parallel([
            Animated.timing(s, { toValue: 1.2, duration: 1600, useNativeDriver: true }),
            Animated.timing(o, { toValue: 0, duration: 1600, useNativeDriver: true }),
          ]),
          Animated.timing(s, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(o, { toValue: 0.6, duration: 0, useNativeDriver: true }),
        ])
      );

    opacity1.setValue(0.6);
    opacity2.setValue(0.6);

    const a1 = loopRing(scale1, opacity1, 0);
    const a2 = loopRing(scale2, opacity2, 600);
    a1.start(); a2.start();

    return () => { a1.stop(); a2.stop(); };
  }, [visible, arrived, scale1, scale2, opacity1, opacity2]);

  if (arrived) {
    return (
      <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
        <View style={modalStyles.arrivedFull}>
          <Text style={modalStyles.arrivedFullText}>You’ve Arrived!</Text>
        </View>
      </Modal>
    );
  }

  const label = Number.isFinite(distanceMeters) ? distanceLabel(distanceMeters) : 'estimating';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={modalStyles.backdrop}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <View style={modalStyles.card}>
              <View style={modalStyles.radar}>
                <Animated.View style={[modalStyles.ring, { transform: [{ scale: scale1 }], opacity: opacity1 }]} />
                <Animated.View style={[modalStyles.ring, { transform: [{ scale: scale2 }], opacity: opacity2 }]} />
                <View style={modalStyles.dot} />
              </View>

              {ready ? (
                <>
                  <Text style={modalStyles.title}>Your bag is {label}</Text>
                  <Text style={modalStyles.subtitle}>
                    Your device is connected via Bluetooth. Sound the buzzer instead?
                  </Text>
                </>
              ) : (
                <>
                  <Text style={modalStyles.title}>Estimating distance…</Text>
                  <Text style={modalStyles.subtitle}>Hold on while we stabilize the signal.</Text>
                </>
              )}

              <View style={modalStyles.actions}>
                <TouchableOpacity
                  onPress={onToggleBuzz}
                  style={[modalStyles.actionBtn, { backgroundColor: buzzerOn ? '#ef4444' : '#22c55e' }]}
                  disabled={!ready}
                >
                  <Text style={modalStyles.actionText}>{buzzerOn ? 'Stop buzzer' : 'Sound buzzer'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
const TrackModal = React.memo(TrackModalInner);

/* ========================= styles ========================= */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  map: { flex: 1 },

  customMarker: {
    backgroundColor: 'white',
    borderRadius: moderateScale(28),
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 999,
    width: moderateScale(55),
    height: moderateScale(55),
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerIcon: { width: '100%', height: '100%', borderRadius: moderateScale(28), resizeMode: 'cover' },
  centerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  tertiaryLabel: {
    color: 'white',
    fontSize: 18,
    paddingLeft: 10,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontFamily: 'MontserratAlt1-Medium',
  },

  mapControls: { position: 'absolute', top: verticalScale(440), right: scale(10), flexDirection: 'column' },
  mapButtonIcon: { height: verticalScale(34), width: scale(34), resizeMode: 'contain' },
  mapControlButton: { backgroundColor: 'transparent', padding: moderateScale(10), borderRadius: moderateScale(12), marginBottom: verticalScale(8) },

  tabContainer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: '#0e0e0e',
    borderTopLeftRadius: moderateScale(20),
    borderTopRightRadius: moderateScale(20),
    elevation: 8,
    overflow: 'hidden',
  },
  pullIndicatorContainer: { alignItems: 'center', paddingTop: verticalScale(10), paddingBottom: verticalScale(12) },
  pullIndicator: { width: scale(40), height: verticalScale(4), backgroundColor: '#ddd', borderRadius: moderateScale(2) },
  tabContent: { flex: 1, paddingHorizontal: scale(15), paddingBottom: 0 },

  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: verticalScale(10), marginTop: verticalScale(2) },

  button: { backgroundColor: '#1a1919', justifyContent: 'center' },

  // Primary buttons
  primaryButton: {
    width: '47.5%',
    height: verticalScale(70),
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 12,
  },
  secondaryButtonIcon: {
    height: moderateScale(30),
    width: moderateScale(30),
    alignSelf: 'center',
    resizeMode: 'contain',
  },

  primaryButtonLeft: { borderTopLeftRadius: moderateScale(12), borderBottomLeftRadius: moderateScale(12) },
  primaryButtonRight: { borderTopRightRadius: moderateScale(12), borderBottomRightRadius: moderateScale(12) },
  primaryButtonContent: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(4),
    width: '100%',
  },
  primaryButtonIcon: {
    marginTop: verticalScale(0),
    marginLeft: scale(-4),
    marginRight: scale(0),
    height: moderateScale(35),
    width: moderateScale(35),
    resizeMode: 'contain',
  },
  primaryButtonTextContainer: { paddingLeft: scale(2), paddingVertical: verticalScale(2), flexShrink: 1, maxWidth: '80%' },

  // Typography
  buttonText: { color: 'white', fontSize: moderateScale(14), fontWeight: '500', fontFamily: 'MontserratAlt1-Regular' },

  // Network box internals
  netBox: { flexDirection: 'row', alignItems: 'center', width: '100%', paddingHorizontal: scale(16) },
  netBars: { flexDirection: 'row', alignItems: 'flex-end', marginRight: scale(10) },
  netBar: { width: scale(6), marginHorizontal: scale(2), borderRadius: scale(3), backgroundColor: '#8A8A8A' },
  netTitle: { color: 'white', fontSize: moderateScale(15), fontFamily: 'MontserratAlt1-Medium' },
  netType: { color: 'white', fontSize: moderateScale(14), opacity: 0.9, fontFamily: 'MontserratAlt1-Regular' },
  netNo: { color: '#ff6b6b', fontSize: moderateScale(13), fontFamily: 'MontserratAlt1-Regular' },

  // Secondary buttons
  secondaryButton: {
    width: '31%',
    height: verticalScale(85),
    alignItems: 'center',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(10),
    borderRadius: 12,
  },
  secondaryButtonLeft: { borderTopLeftRadius: moderateScale(12), borderBottomLeftRadius: moderateScale(12) },
  secondaryButtonRight: { borderTopRightRadius: moderateScale(12), borderBottomRightRadius: moderateScale(12) },

  secondaryButtonText: {
    color: 'white',
    fontSize: moderateScale(15),
    textAlign: 'center',
    paddingTop: 5,
    fontFamily: 'MontserratAlt1-Regular',
  },

  // Fixed internal layout for all three secondary buttons
  secondaryContent: { width: '100%', alignItems: 'center' },
  lockIconSlot: { height: moderateScale(36), justifyContent: 'center', alignItems: 'center' },
  lockLabelSlot: { height: moderateScale(22), justifyContent: 'center', alignItems: 'center' },
  lockIcon: { height: moderateScale(30), width: moderateScale(30), alignSelf: 'center', resizeMode: 'contain' },

  tertiaryButton: { width: '100%', height: 70, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: scale(12) },

  // Header (bag card)
  bagInfoCard: {
    height: verticalScale(80),
    width: '100%',
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(15),
    borderRadius: moderateScale(12),
    alignItems: 'center',
    marginBottom: verticalScale(10),
  },
  bagIconContainer: { height: moderateScale(50), width: moderateScale(50), justifyContent: 'center', alignItems: 'center' },
  bagIconHolder: { borderRadius: moderateScale(25), overflow: 'hidden', backgroundColor: '#abb4c2', height: '100%', width: '100%' },
  bagIcon: { width: '100%', height: '100%', resizeMode: 'cover' },
  bagInfoTextContainer: { flex: 1, paddingLeft: scale(10) },
  bagInfoCenterTitle: { fontSize: moderateScale(20), color: 'black', fontFamily: 'MontserratAlt1-SemiBold' },
  bagConnectionText: { fontSize: moderateScale(16), color: 'black', paddingHorizontal: 10, fontFamily: 'MontserratAlt1-Medium' },

  batIcon: { height: verticalScale(30), width: scale(32), resizeMode: 'contain', marginTop: 4, marginRight: 10 },

  debugPanel: { marginTop: 8, padding: 12, backgroundColor: '#101010', borderRadius: 10, borderWidth: 1, borderColor: '#222' },
  debugTitle: { color: '#999', fontSize: 14, marginBottom: 6, fontFamily: 'MontserratAlt1-Medium' },
  debugLine: { color: '#ddd', fontSize: 13, marginBottom: 2, fontFamily: 'MontserratAlt1-Regular' },
});

// ⭐ Modal styles
const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222',
    overflow: 'hidden',
  },
  radar: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#0f172a',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  ring: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    borderColor: '#34d399',
  },
  dot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#34d399',
  },
  title: {
    color: 'white',
    fontSize: 18,
    fontFamily: 'MontserratAlt1-SemiBold',
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    color: '#d1d5db',
    fontSize: 14,
    fontFamily: 'MontserratAlt1-Regular',
    marginBottom: 16,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionText: {
    color: '#000',
    fontSize: 14,
    fontFamily: 'MontserratAlt1-SemiBold',
  },

  // Arrived = full-screen green
  arrivedFull: {
    flex: 1,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrivedFullText: {
    color: '#ffffff',
    fontSize: 28,
    fontFamily: 'MontserratAlt1-SemiBold',
    textAlign: 'center',
  },
});

export default Dashboard;
