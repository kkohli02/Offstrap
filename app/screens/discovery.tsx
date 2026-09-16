// screens/Discovery.tsx
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Alert,
} from "react-native";
import { BleManager, Device, ScanMode } from "react-native-ble-plx";

// OffStrap service UUIDs (both modes)
const OFFSTRAP_SERVICES = [
  "8b7a0001-bf5f-4a9a-9955-2a6f8a7f6c01", // OTP service
  "8b7a1001-bf5f-4a9a-9955-2a6f8a7f6c01", // SECURE service
];

export default function DiscoveryScreen({ navigation }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showBags, setShowBags] = useState(false);

  const managerRef = useRef<BleManager | null>(null);
  const devicesRef = useRef<Device[]>([]);
  const seenRef = useRef<Record<string, boolean>>({});

  const { width, height } = useWindowDimensions();
  const logoFontSize = Math.max(36, Math.min(68, width * 0.12));
  const taglineFontSize = Math.max(13, Math.min(18, width * 0.045));
  const verticalGap = Math.max(48, Math.min(72, height * 0.065));

  // --- JIT permission request ---
  const ensureBlePermissions = async (): Promise<boolean> => {
    if (Platform.OS !== "android") return true;
    const sdk = Number(Platform.Version);

    try {
      if (sdk >= 31) {
        const multi = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, // still needed by some stacks
        ]);
        return (
          multi[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === "granted" &&
          multi[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === "granted" &&
          multi[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === "granted"
        );
      } else {
        const fine = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return fine === "granted";
      }
    } catch {
      return false;
    }
  };

  const stopScanSafely = () => {
    try {
      managerRef.current?.stopDeviceScan();
    } catch {}
  };

  const considerDevice = (device?: Device | null) => {
    if (!device) return;
    const name = device.name?.toLowerCase?.() ?? "";

    // Fast-path: name check OR advertised services match
    const isOffStrapByName = name.includes("offstrap");
    const hasService =
      // Some platforms populate serviceUUIDs, some don't—so we keep the name check too
      // @ts-ignore - serviceUUIDs may exist on native object
      Array.isArray(device.serviceUUIDs) &&
      // @ts-ignore
      device.serviceUUIDs?.some((u) => OFFSTRAP_SERVICES.includes(String(u).toLowerCase()));

    if (isOffStrapByName || hasService) {
      if (!seenRef.current[device.id]) {
        seenRef.current[device.id] = true;
        devicesRef.current.push(device);
        setDevices([...devicesRef.current]);
        setShowBags(true);
      }
    }
  };

  // --- Scan handler ---
  const startScan = async (opts?: { retry?: boolean }) => {
    const retry = !!opts?.retry;

    const ok = await ensureBlePermissions();
    if (!ok) {
      Alert.alert("Bluetooth permission", "We need Bluetooth permission to scan for your bag.");
      return;
    }

    if (!managerRef.current) managerRef.current = new BleManager();
    const manager = managerRef.current;

    // Clean state
    stopScanSafely();
    setDevices([]);
    devicesRef.current = [];
    seenRef.current = {};
    setShowBags(false);
    setScanning(true);

    // Kick scan with OffStrap service filters (fast, reduces noise)
    manager.startDeviceScan(
      OFFSTRAP_SERVICES,
      {
        allowDuplicates: true,
        scanMode: ScanMode.LowLatency,
        // legacyScan true can help some Android devices see non-extended adverts quicker
        // @ts-ignore
        legacyScan: true,
      },
      (error, device) => {
        if (error) {
          console.log("Scan error:", error);
          setScanning(false);
          return;
        }
        considerDevice(device);
      }
    );

    // --- “Grace” quick restart ---
    // If nothing shows within ~900ms (typical for “just-missed” case),
    // restart the scan once. This catches the advert as it comes up.
    const graceTimer = setTimeout(() => {
      if (devicesRef.current.length === 0) {
        // quick restart: stop → start again immediately
        stopScanSafely();
        try {
          manager.startDeviceScan(
            OFFSTRAP_SERVICES,
            { allowDuplicates: true, scanMode: ScanMode.LowLatency, legacyScan: true },
            (error, device) => {
              if (error) {
                console.log("Scan error (grace):", error);
                setScanning(false);
                return;
              }
              considerDevice(device);
            }
          );
        } catch {}
      }
    }, 900);

    // Hard stop after 7s; if nothing found, do ONE full retry after 500ms
    const stopTimer = setTimeout(() => {
      clearTimeout(graceTimer);
      stopScanSafely();
      setScanning(false);

      if (devicesRef.current.length === 0 && !retry) {
        console.log("🔄 No devices found, retrying once…");
        setTimeout(() => startScan({ retry: true }), 500);
      }
    }, 7000);
  };

  // --- Selecting a bag ---
  const handleBagPress = (device: Device) => {
    stopScanSafely();
    setScanning(false);
    // Navigate with ID (connection happens in setup flow)
    navigation.navigate("BagSetup", {
      deviceId: device.id,
      nextRoute: "FingerprintSetup",
    });
  };

  const renderBagCard = ({ item }: { item: Device }) => (
    <Pressable
      onPress={() => handleBagPress(item)}
      style={({ pressed }) => [styles.bagCard, { opacity: pressed ? 0.95 : 1 }]}
    >
      <Text style={styles.bagName}>{item.name || "OffStrap"}</Text>
      <Text style={styles.bagCode}>{item.id}</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <Text style={[styles.logoText, { fontSize: logoFontSize }]}>OFFSTRAP</Text>
      <Text
        style={[styles.tagline, { fontSize: taglineFontSize, marginTop: 14, marginBottom: 24 }]}
      >
        Let’s connect your Trail 1.0
      </Text>

      <Text
        style={[styles.instruction, { fontSize: taglineFontSize, marginBottom: verticalGap }]}
      >
        <Text style={styles.highlight}>Place your finger</Text> on the{" "}
        <Text style={styles.highlight}>Fingerprint Sensor</Text> to wake the device,
        then tap Scan.
      </Text>

      {!scanning && !showBags && (
        <Pressable style={styles.buttonBase} onPress={() => startScan()}>
          <Text style={styles.btnText}>Scan</Text>
        </Pressable>
      )}

      {scanning && (
        <View style={[styles.buttonBase, { backgroundColor: "#333", flexDirection: "row", gap: 8 }]}>
          <ActivityIndicator color="#aaa" />
          <Text style={[styles.btnText, { color: "#aaa" }]}>Scanning…</Text>
        </View>
      )}

      {(scanning || showBags) && (
        <>
          {devices.length === 0 && !scanning && (
            <Pressable style={[styles.buttonBase, { marginTop: 16 }]} onPress={() => startScan()}>
              <Text style={styles.btnText}>Scan Again</Text>
            </Pressable>
          )}
          <View style={styles.resultsSection}>
            <FlatList
              data={devices}
              keyExtractor={(item) => item.id}
              renderItem={renderBagCard}
              contentContainerStyle={{ gap: 14, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", alignItems: "center", paddingTop: "25%" },
  logoText: { fontFamily: "MontserratAlt1-SemiBold", color: "#fff", textAlign: "center" },
  tagline: { fontFamily: "MontserratAlt1-Light", color: "#fff", textAlign: "center", letterSpacing: 0.4 },
  instruction: { fontFamily: "MontserratAlt1-SemiBold", color: "#fff", textAlign: "center", lineHeight: 22, paddingHorizontal: 24 },
  highlight: { color: "#00e0ff", fontFamily: "MontserratAlt1-SemiBold" },
  buttonBase: { height: 54, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", width: "70%" },
  btnText: { fontSize: 18, color: "#000", fontFamily: "MontserratAlt1-SemiBold" },
  resultsSection: { width: "92%", marginTop: 22 },
  bagCard: { backgroundColor: "#1a1a1a", padding: 16, borderRadius: 14, borderWidth: 1, borderColor: "#333" },
  bagName: { fontSize: 18, color: "#fff", fontFamily: "MontserratAlt1-SemiBold" },
  bagCode: { fontSize: 12, color: "#aaa", marginTop: 4, fontFamily: "MontserratAlt1-Regular" },
});