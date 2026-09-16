// screens/FingerprintManager.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  Dimensions,
  Modal,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBLE } from '../logics/ble/BLE';
import { useTranslation } from 'react-i18next';

const { height: screenHeight, width: screenWidth } = Dimensions.get('window');
const scale = (size: number) => (screenWidth / 375) * size;
const verticalScale = (size: number) => (screenHeight / 812) * size;
const moderateScale = (size: number, factor = 0.5) =>
  size + (scale(size) - size) * factor;

type FPItem = { id: number; name: string };

// 🔐 Local storage keys
const STORE_KEY = 'offstrap.fp.labels';          // local label storage
const FINGERPRINT_DONE_KEY = 'fingerprint:enrolled:v1'; // global "enrolled" flag (used in App.tsx)

export default function FingerprintManager({ navigation }: any) {
  const { status: bleStatus, deviceId, sendText, restoreLast } = useBLE();
  const { t } = useTranslation();

  const [items, setItems] = useState<FPItem[]>([]);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameId, setRenameId] = useState<number | null>(null);

  // 🔔 AppLock/Travel-style popup
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
    const load = async () => {
      const fallback = t('fpManager.defaultFingerName');
      try {
        const [rawLabels, fpDone] = await Promise.all([
          AsyncStorage.getItem(STORE_KEY),
          AsyncStorage.getItem(FINGERPRINT_DONE_KEY),
        ]);

        // If fingerprint is not marked as enrolled, show empty list.
        if (!fpDone) {
          setItems([]);
          return;
        }

        const map = rawLabels ? (JSON.parse(rawLabels) as Record<string, string>) : {};
        const name = map['1'] || fallback;

        setItems([{ id: 1, name }]);
      } catch {
        setItems([]);
      }
    };

    load();
    restoreLast();
    // re-run if language changes (t ref changes when i18n switches)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreLast, t]);

  const ensureConnected = () => bleStatus === 'connected' && !!deviceId;

  // Just sends the command + handles failure; connection gating is done per-action.
  const sendCmd = useCallback(
    async (cmd: string) => {
      try {
        await sendText(cmd);
        return true;
      } catch {
        Alert.alert(t('fpManager.cmdFailedTitle'), t('fpManager.cmdFailedBody'));
        return false;
      }
    },
    [sendText, t]
  );

  // ---- Rename flow ----
  const openRename = (id: number, currentName: string) => {
    setRenameId(id);
    setRenameValue(currentName);
    setRenameVisible(true);
  };

  const applyRename = async () => {
    if (renameId == null) return;
    const trimmed = renameValue.trim() || t('fpManager.defaultFingerName');
    try {
      const raw = await AsyncStorage.getItem(STORE_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      map[String(renameId)] = trimmed;
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(map));
    } catch {}
    setItems((prev) => prev.map((it) => (it.id === renameId ? { ...it, name: trimmed } : it)));
    setRenameVisible(false);
  };

  // ---- Delete flow ----
  const deleteItem = (id: number) => {
    // 1️⃣ First: if not connected, show the AppLock-style popup and bail.
    if (!ensureConnected()) {
      showPopup(t('fpManager.notConnectedTitle'), t('fpManager.notConnectedBody'));
      return;
    }

    // 2️⃣ Only if connected: ask for confirmation.
    Alert.alert(
      t('fpManager.confirmDeleteTitle'),
      t('fpManager.confirmDeleteBody'),
      [
        { text: t('fpManager.cancel'), style: 'cancel' },
        {
          text: t('fpManager.confirm'),
          style: 'destructive',
          onPress: async () => {
            const ok = await sendCmd('FP_DB_CLEAR'); // firmware clears DB
            if (ok) {
              try {
                // Clear both the label map and the "fingerprint enrolled" flag
                await Promise.all([
                  AsyncStorage.removeItem(STORE_KEY),
                  AsyncStorage.removeItem(FINGERPRINT_DONE_KEY),
                ]);
              } catch {}

              setItems([]);
              Alert.alert(t('fpManager.doneTitle'), t('fpManager.deletedBody'));
            }
          },
        },
      ]
    );
  };

  // ---- Add flow ----
  // If Bluetooth is disconnected, show the same popup first; only navigate when connected.
  const addFingerprint = () => {
    if (!ensureConnected()) {
      showPopup(t('fpManager.notConnectedTitle'), t('fpManager.notConnectedBody'));
      return;
    }
    navigation.navigate('FingerprintSetup', { from: 'manager' });
  };

  // ---- UI ----
  const EmptyState = () => (
    <View style={styles.card}>
      <TouchableOpacity style={styles.addRow} onPress={addFingerprint} activeOpacity={0.9}>
        <Image source={require('../assets/fingerprint.png')} style={styles.iconLg} />
        <Text style={styles.addLabel}>{t('fpManager.add')}</Text>
      </TouchableOpacity>
    </View>
  );

  const ListRow = ({ item }: { item: FPItem }) => (
    <View style={styles.row}>
      {/* Name box (full width, single outline) */}
      <View style={styles.nameBox}>
        <Image source={require('../assets/fingerprint.png')} style={styles.icon} />
        <Text style={styles.rowLabel} numberOfLines={2}>
          {item.name}
        </Text>
      </View>

      {/* Action box (full width, single outline). Two colored halves (50/50) */}
      <View style={styles.actionBox}>
        <TouchableOpacity
          style={[styles.actionHalf, styles.actionHalfLeft]}
          onPress={() => openRename(item.id, item.name)}
          activeOpacity={0.85}
        >
          <View style={styles.actionContent}>
            <Text style={styles.actionText}>{t('fpManager.rename')}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionHalf, styles.actionHalfRight]}
          onPress={() => deleteItem(item.id)}
          activeOpacity={0.85}
        >
          <View style={styles.actionContent}>
            <Text style={styles.actionText}>{t('fpManager.delete')}</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* 🔔 OffStrap-style popup (same vibe as Travel/AppLock) */}
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

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('fpManager.title')}</Text>
        <Text style={styles.subtitle}>{t('fpManager.subtitle')}</Text>
      </View>

      {/* Body */}
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <View style={styles.card}>
          <ListRow item={items[0]} />
        </View>
      )}

      {/* Rename Modal */}
      <Modal transparent animationType="fade" visible={renameVisible} onRequestClose={() => setRenameVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('fpManager.renameTitle')}</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder={t('fpManager.enterName')}
              placeholderTextColor="#777"
              style={styles.input}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setRenameVisible(false)}>
                <Text style={styles.modalBtnText}>{t('fpManager.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalSave]} onPress={applyRename}>
                <Text style={styles.modalBtnText}>{t('fpManager.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ========================= styles ========================= */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: screenHeight * 0.05 },
  header: { paddingHorizontal: 20, marginBottom: 10 },
  title: { color: '#fff', fontSize: 28, fontFamily: 'MontserratAlt1-SemiBold' },
  subtitle: { color: '#bbb', marginTop: 6, fontSize: 15, fontFamily: 'MontserratAlt1-Light' },

  // Card: no OUTERMOST border
  card: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    borderWidth: 0,
    padding: 10,
    marginTop: 18,
    marginHorizontal: 20,
  },

  // Row wrapper
  row: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 0,
    padding: 0,
    marginVertical: 6,
  },

  // Full-width name box
  nameBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  icon: { marginRight: 12, height: 18, width: 18, resizeMode: 'contain' },
  iconLg: { marginRight: 12, height: 24, width: 24, resizeMode: 'contain' },
  rowLabel: { color: '#fff', fontSize: 16, fontFamily: 'MontserratAlt1-Regular', flex: 1, flexWrap: 'wrap' },

  // Action box outline
  actionBox: {
    flexDirection: 'row',
    borderWidth: 1, // single outline around both halves
    borderColor: '#2a2a2a',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#111',
  },

  // Two equal halves with color scheme
  actionHalf: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionHalfLeft: {
    backgroundColor: '#1a1a1a',
    borderRightWidth: 1, // thin divider
    borderRightColor: '#2a2a2a',
  },
  actionHalfRight: {
    backgroundColor: '#2a0f0f', // red-tinted delete half
  },

  actionContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#fff', fontSize: 15, fontFamily: 'MontserratAlt1-Medium' },

  // Empty state "Add" row
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#101010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 14,
    paddingVertical: 18,
    marginVertical: 6,
    justifyContent: 'center',
  },
  addLabel: { color: '#fff', fontSize: 16, fontFamily: 'MontserratAlt1-SemiBold' },

  // Rename Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  modalCard: {
    width: '82%',
    backgroundColor: '#151515',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontFamily: 'MontserratAlt1-SemiBold', marginBottom: 10 },
  input: {
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 16,
    fontFamily: 'MontserratAlt1-Regular',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  modalBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  modalCancel: { backgroundColor: '#1a1a1a', marginRight: 10 },
  modalSave: { backgroundColor: '#007AFF' },
  modalBtnText: { color: '#fff', fontSize: 14, fontFamily: 'MontserratAlt1-Medium' },

  // 🔔 AppLock/Travel-style popup
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
