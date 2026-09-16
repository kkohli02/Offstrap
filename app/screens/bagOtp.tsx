// screens/BagOTP.tsx
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Animated,
  StyleSheet,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
} from "react-native";
import { BleManager, Device, Subscription } from "react-native-ble-plx";
import base64 from "react-native-base64";
import auth from "@react-native-firebase/auth";
import firestore from "@react-native-firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useBLE } from "../logics/ble/BLE";
import { OFFSTRAP_STATE, SECURE_UUID, DIS_UUID } from "../logics/ble/BLE";

const manager = new BleManager();

/** OTP service/char (for submitting the code) */
const OTP_SERVICE = "8b7a0001-bf5f-4a9a-9955-2a6f8a7f6c01";
const OTP_CHAR    = "8b7a0002-bf5f-4a9a-9955-2a6f8a7f6c01";

/** Local cache keys */
const BAG_SERIAL_KEY = "bag:serial:v1";
const BAG_LINK_KEY   = "bag:link:v1";

/** Waits */
const MIN_WAIT_MS = 5000;
const PROVISION_TIMEOUT_MS = 10000;

type Provision = {
  bagId?: string;
  iccid?: string;
};

export default function BagOTP({ route, navigation }) {
  const { deviceId } = route.params as { deviceId: string };
  const { adopt, refreshBagId } = useBLE();

  const [device, setDevice] = useState<Device | null>(null);
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const subRef = useRef<Subscription | null>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const handedOffRef = useRef(false);
  const inputs = useRef(Array.from({ length: 6 }, () => React.createRef<TextInput>())).current;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const d = await manager.connectToDevice(deviceId, { autoConnect: false });
        const dd = await d.discoverAllServicesAndCharacteristics();
        if (!mounted) return;

        // STATE watcher
        subRef.current = dd.monitorCharacteristicForService(
          OFFSTRAP_STATE.SERVICE,
          OFFSTRAP_STATE.STATE_CHAR,
          async (error, char) => {
            if (error || !char?.value) return;
            const val = base64.decode(char.value).trim();
            if (!val) return;

            console.log("[STATE]", val);

            if (val === "Wrong OTP") {
              setBusy(false);
              triggerError();
              return;
            }
            if (val === "OTP timeout") {
              setBusy(false);
              Alert.alert("Code expired", "Please reconnect to get a new code.");
              return;
            }
            if (val === "Authorized") {
              setBusy(false);

              // Listen for SECURE JSONs (bagId + iccid); merge across packets.
              let provision: Provision | null = null;
              try {
                provision = await listenForProvision(dd, PROVISION_TIMEOUT_MS);
                if (provision) console.log("✅ [PROVISION]", provision);
                else console.log("⚠️  [PROVISION] none received");
              } catch (e: any) {
                console.warn("listenForProvision failed:", e?.message || e);
              }

              // Hand BLE connection to app-level manager
              try {
                const ok = await adopt(dd.id);
                handedOffRef.current = !!ok;
              } catch {}

              // Finalize pairing → write to Firebase (bagId always, iccid if present)
              try {
                await finalizePairing(dd, provision || undefined);
              } catch (e: any) {
                console.warn("finalizePairing failed:", e?.message || e);
              }

              navigation.reset({ index: 0, routes: [{ name: "FingerprintSetup" }] });
            }
          }
        );

        setDevice(dd);
      } catch (e: any) {
        Alert.alert("Connection failed", e?.message ?? "Unknown error");
        navigation.goBack();
      }
    })();

    return () => {
      try { subRef.current?.remove(); } catch {}
      if (device && !handedOffRef.current) device.cancelConnection().catch(() => {});
      mounted = false;
    };
  }, [deviceId, adopt, navigation]);

  /**
   * Robust SECURE listener:
   * - Reassembles fragmented JSONs via brace depth
   * - Merges {bagId} and {iccid} if separate
   * - Early-exits when both collected
   */
  const listenForProvision = async (d: Device, windowMs: number): Promise<Provision | null> => {
    let current = "";
    let depth = 0;
    const result: Provision = {};
    let sub: Subscription | null = null;
    let done = false;

    const commitIfComplete = () => {
      if (result.bagId && result.iccid) done = true;
    };

    const onChunk = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (ch === "{") {
          if (depth === 0) current = "{";
          else current += "{";
          depth++;
        } else if (ch === "}") {
          if (depth > 0) {
            current += "}";
            depth--;
            if (depth === 0) {
              try {
                const obj = JSON.parse(current);
                console.log("📦 [SECURE][JSON]", obj);
                if (obj && typeof obj === "object") {
                  if (typeof obj.bagId === "string" && obj.bagId.trim()) result.bagId = obj.bagId.trim();
                  if (typeof obj.iccid === "string" && /^\d{10,22}$/.test(obj.iccid.trim())) result.iccid = obj.iccid.trim();
                  commitIfComplete();
                }
              } catch {
                console.warn("⚠️  [SECURE][JSON parse error] chunk:", current);
              }
              current = "";
            }
          }
        } else {
          if (depth > 0) current += ch;
        }
      }
    };

    const p = new Promise<Provision | null>((resolve) => {
      sub = d.monitorCharacteristicForService(
        SECURE_UUID.SERVICE,
        SECURE_UUID.DATA,
        (_err, characteristic) => {
          if (!characteristic?.value) return;
          const raw = base64.decode(characteristic.value);
          console.log("🔐 [SECURE][RAW]", raw);
          onChunk(raw);
          if (done) {
            try { sub?.remove(); } catch {}
            console.log("🔎 [SECURE][SUMMARY]", { haveBagId: !!result.bagId, haveIccid: !!result.iccid });
            resolve(result);
          }
        }
      );

      setTimeout(() => {
        if (done) return;
        try { sub?.remove(); } catch {}
        const haveSomething = !!result.bagId || !!result.iccid;
        console.log("🔎 [SECURE][TIMEOUT]", { haveBagId: !!result.bagId, haveIccid: !!result.iccid });
        resolve(haveSomething ? result : null);
      }, windowMs);
    });

    return p;
  };

  /** Write bagId + iccid(simId) to Firestore (ICCID only if received over SECURE) */
  const finalizePairing = async (d: Device, provision?: Provision) => {
    const user = auth().currentUser;
    if (!user) throw new Error("No signed-in user");

    // BagID from DIS Serial (authoritative)
    let serial = await refreshBagId();
    if (!serial) {
      try {
        const ch = await d.readCharacteristicForService(DIS_UUID.SERVICE, DIS_UUID.SERIAL);
        if (ch?.value) serial = base64.decode(ch.value).trim();
      } catch {}
    }
    if (!serial) throw new Error("Bag ID unavailable");

    const iccid =
      provision?.iccid && /^\d{10,22}$/.test(provision.iccid) ? provision.iccid : null;

    // Local cache
    await AsyncStorage.multiSet([
      [BAG_SERIAL_KEY, serial],
      [BAG_LINK_KEY, serial],
    ]);

    // 🔐 Firestore: set createdAt ONCE, updatedAt always
    const userRef = firestore().collection("users").doc(user.uid);

    await firestore().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);

      const payload: any = {
        bagId: serial,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      };
      if (iccid) payload.simId = iccid;

      // Only set createdAt if it doesn't exist yet
      if (!snap.exists || !snap.data()?.createdAt) {
        payload.createdAt = firestore.FieldValue.serverTimestamp();
      }

      tx.set(userRef, payload, { merge: true });
    });

    // OPTIONAL: also keep a bag-centric doc
    // await firestore().collection("bags").doc(serial)
    //   .set({ simId: iccid ?? firestore.FieldValue.delete(), updatedAt: firestore.FieldValue.serverTimestamp() }, { merge: true });

    console.log("✅ Pairing finalized:", { bagId: serial, iccid: iccid ?? "(omitted)" });
  };

  const triggerError = () => {
    setError(true);
    setOtp(Array(6).fill(""));
    inputs[0].current?.focus();
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start(() => setError(false));
  };

  /* ---------- OTP handling ---------- */
  const focusIndex = (i: number) => inputs[i]?.current?.focus();
  const handleOtpChange = (text: string, idx: number) => {
    const digits = (text || "").replace(/\D/g, "");
    const next = [...otp];
    if (digits.length === 0) {
      next[idx] = "";
      setOtp(next);
      return;
    }
    let cursor = idx;
    for (let i = 0; i < digits.length && cursor < 6; i++, cursor++) next[cursor] = digits[i];
    setOtp(next);
    cursor < 6 ? focusIndex(cursor) : inputs[5].current?.blur();
  };

  const handleOtpKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>, idx: number) => {
    if (e.nativeEvent.key === "Backspace") {
      const next = [...otp];
      if (otp[idx] !== "") next[idx] = "";
      else if (idx > 0) next[idx - 1] = "";
      setOtp(next);
      if (idx > 0 && otp[idx] === "") focusIndex(idx - 1);
    }
  };

  const submitOtp = async () => {
    if (!device) return;
    const code = otp.join("");
    if (!/^[0-9]{6}$/.test(code)) {
      Alert.alert("Enter 6 digits", "Please type the 6-digit code exactly as shown.");
      return;
    }
    try {
      setBusy(true);
      const bleWork = (async () => {
        await device.writeCharacteristicWithoutResponseForService(
          OTP_SERVICE,
          OTP_CHAR,
          base64.encode(code)
        );
        await device
          .readCharacteristicForService(SECURE_UUID.SERVICE, SECURE_UUID.DATA)
          .catch(() =>
            new Promise((r) => setTimeout(r, 600)).then(() =>
              device.readCharacteristicForService(SECURE_UUID.SERVICE, SECURE_UUID.DATA)
            )
          );
      })();
      const minWait = new Promise((r) => setTimeout(r, MIN_WAIT_MS));
      await Promise.all([bleWork, minWait]);
    } catch (e: any) {
      setBusy(false);
      Alert.alert("Verification failed", e?.message ?? "Please try again.");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify your bag</Text>
      <Text style={styles.subtitle}>Enter the 6-digit code from your bag</Text>

      <Animated.View style={[styles.otpRow, { transform: [{ translateX: shakeAnim }] }]}>
        {otp.map((digit, idx) => (
          <TextInput
            key={idx}
            ref={inputs[idx]}
            style={[styles.otpBox, error && { borderColor: "red" }]}
            value={digit}
            onChangeText={(t) => handleOtpChange(t, idx)}
            onKeyPress={(e) => handleOtpKeyPress(e, idx)}
            keyboardType="number-pad"
            maxLength={1}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoCorrect={false}
            autoCapitalize="none"
            selectTextOnFocus
          />
        ))}
      </Animated.View>

      {error && <Text style={styles.error}>Invalid OTP</Text>}

      <Pressable
        onPress={submitOtp}
        disabled={busy || otp.some((d) => d === "")}
        style={[styles.button, (busy || otp.some((d) => d === "")) && { backgroundColor: "#333" }]}
      >
        {busy ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator color="#000" />
            <Text style={styles.btnText}>Please wait…</Text>
          </View>
        ) : (
          <Text style={styles.btnText}>Continue</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 24, justifyContent: "center", alignItems: "center" },
  title: { color: "#fff", fontSize: 26, fontFamily: "MontserratAlt1-SemiBold", marginBottom: 8 },
  subtitle: { color: "#aaa", marginBottom: 24 },
  otpRow: { flexDirection: "row", justifyContent: "center", marginBottom: 20 },
  otpBox: {
    width: 46, height: 54, backgroundColor: "#111", color: "#fff", fontSize: 20, textAlign: "center",
    borderRadius: 12, borderWidth: 1, borderColor: "#2a2a2a", marginHorizontal: 5, fontFamily: "MontserratAlt1-SemiBold",
  },
  error: { color: "red", marginBottom: 12, fontFamily: "MontserratAlt1-SemiBold" },
  button: { backgroundColor: "#fff", padding: 14, borderRadius: 12, alignItems: "center", width: "70%" },
  btnText: { color: "#000", fontSize: 18, fontFamily: "MontserratAlt1-SemiBold" },
});
