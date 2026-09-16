// screens/smartScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Dimensions,
  Alert,
  Keyboard,
  Modal,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useBLE } from '../logics/ble/BLE';

const { height: screenHeight } = Dimensions.get('window');
const MAX_CHARS = 50 as const;

const MODE_KEY = 'prefs:smartDisplay:mode';
const TEXT_KEY = 'prefs:smartDisplay:text';

// Image mode removed
type Option = 'logo' | 'text' | 'blank';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function SmartDisplayScreen({ navigation }: any) {
  const { t } = useTranslation();
  const { status: bleStatus, deviceId, sendText, onReceiveBytes } = useBLE();

  // --- Selection state (default to Show Logo) ---
  const [selected, setSelected] = useState<Option>('logo');
  const [appliedOption, setAppliedOption] = useState<Option>('logo');

  // --- Personalised text state ---
  const [inputText, setInputText] = useState('');
  const [appliedText, setAppliedText] = useState('');

  // Preview text default
  const defaultPreview =
    t('smartDisplay.previewHint') || 'Your Message Will Appear Here';
  const livePreviewText = inputText?.length ? inputText : defaultPreview;

  const atLimit = inputText.length === MAX_CHARS;

  // 🔔 OffStrap-style popup (same as Settings / Notifications)
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

  // Hydrate from AsyncStorage on mount
  useEffect(() => {
    (async () => {
      try {
        const [storedMode, storedText] = await Promise.all([
          AsyncStorage.getItem(MODE_KEY),
          AsyncStorage.getItem(TEXT_KEY),
        ]);

        // Only allow non-image modes; if old storage has "image", fall back to 'logo'
        const validModes: Option[] = ['logo', 'text', 'blank'];
        let mode: Option = 'logo';
        const text = (storedText || '').toString();

        if (storedMode && validModes.includes(storedMode as Option)) {
          mode = storedMode as Option;
        } else {
          await AsyncStorage.multiSet([
            [MODE_KEY, 'logo'],
            [TEXT_KEY, text],
          ]);
          mode = 'logo';
        }

        setSelected(mode);
        setAppliedOption(mode);
        setAppliedText(text);
        if (mode === 'text') setInputText(text);
      } catch {}
    })();
  }, []);

  // BLE RX console logger
  useEffect(() => {
    const unsub = onReceiveBytes((bytes) => {
      try {
        const s = String.fromCharCode(...bytes).trim();
        if (s) console.log('[BLE RX]', s);
      } catch {}
    });
    return unsub;
  }, [onReceiveBytes]);

  // Dirty check
  const dirty = useMemo(() => {
    if (selected !== appliedOption) return true;
    if (selected === 'text' && inputText.trim() !== appliedText.trim()) return true;
    return false;
  }, [selected, appliedOption, inputText, appliedText]);

  // Handlers
  const choose = (opt: Option) => setSelected(opt);

  const handleChangeText = (text: string) => {
    const noNewlines = text.replace(/(\r\n|\n|\r)/g, '');
    const clipped = noNewlines.slice(0, MAX_CHARS);
    setInputText(clipped);
  };
  const handleKeyPress = ({ nativeEvent }: any) => {
    if (nativeEvent?.key === 'Enter') Keyboard.dismiss();
  };
  const handleSubmitEditing = () => Keyboard.dismiss();

  const persistAsync = async (mode: Option, text: string) => {
    try {
      await AsyncStorage.multiSet([
        [MODE_KEY, mode],
        [TEXT_KEY, text],
      ]);
    } catch {}
  };

  // 🔒 BLE-guarded command with OffStrap popup
  const sendBleCommand = async (command: string) => {
    if (!(bleStatus === 'connected' && deviceId)) {
      showPopup(t('settings.notConnectedTitle'), t('settings.notConnectedBody'));
      return false;
    }
    try {
      await sendText(command);
      return true;
    } catch {
      showPopup(t('settings.cmdFailedTitle'), t('settings.cmdFailedBody'));
      return false;
    }
  };

  const handleUpdateDisplay = async () => {
    try {
      if (selected === 'text') {
        const msg = inputText.trim();
        if (!msg.length) {
          Alert.alert(
            t('smartDisplay.requiredTitle') || 'Text required',
            t('smartDisplay.requiredBody') || 'Please enter some text to display.'
          );
          return;
        }
        const safe = msg.replace(/\|/g, ' ').slice(0, MAX_CHARS);

        const ok1 = await sendBleCommand('DSP_MODE|TEXT');
        if (!ok1) return;

        await sleep(80);

        const ok2 = await sendBleCommand(`DSP_TEXT|${safe}`);
        if (!ok2) return;

        setAppliedText(safe);
        setAppliedOption('text');
        await persistAsync('text', safe);
      } else if (selected === 'blank') {
        const ok = await sendBleCommand('DSP_MODE|BLANK');
        if (!ok) return;
        setAppliedOption('blank');
        await persistAsync('blank', appliedText);
      } else if (selected === 'logo') {
        const ok = await sendBleCommand('DSP_MODE|LOGO');
        if (!ok) return;
        setAppliedOption('logo');
        await persistAsync('logo', appliedText);
      }

      Alert.alert(
        t('smartDisplay.savedTitle') || 'Updated',
        t('smartDisplay.savedBody') || 'Your display has been updated.'
      );
      try {
        navigation?.canGoBack?.() ? navigation.goBack() : null;
      } catch {}
    } catch (e) {
      Alert.alert(
        t('smartDisplay.errorTitle') || 'Could not update',
        t('smartDisplay.errorBody') || 'Please try again.'
      );
    }
  };

  const rowStyle = (active: boolean) => [
    styles.row,
    active && styles.rowActive,
  ];

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

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('smartDisplay.title') || 'Smart Display'}</Text>
          <Text style={styles.subtitle}>
            {t('smartDisplay.subtitle') || 'Customize your E-Ink bag display'}
          </Text>
        </View>

        <View style={{ marginTop: 18 }}>
          <Text style={styles.cardTitle}>
            {t('smartDisplay.modeTitle') || 'Choose What to Show'}
          </Text>

          {/* Show Logo */}
          <Pressable
            onPress={() => choose('logo')}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === 'logo' }}
            style={({ pressed }) => [
              rowStyle(selected === 'logo'),
              pressed && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.rowLabel}>
              {t('smartDisplay.showLogo') || 'Show Logo'}
            </Text>
            <Text style={[styles.check, { opacity: selected === 'logo' ? 1 : 0 }]}>✓</Text>
          </Pressable>

          {/* Show Personalised Text */}
          <Pressable
            onPress={() => choose('text')}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === 'text' }}
            style={({ pressed }) => [
              rowStyle(selected === 'text'),
              pressed && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.rowLabel}>
              {t('smartDisplay.showText') || 'Show Personalised Text'}
            </Text>
            <Text style={[styles.check, { opacity: selected === 'text' ? 1 : 0 }]}>✓</Text>
          </Pressable>

          {selected === 'text' && (
            <View style={{ marginTop: 10, marginBottom: 6 }}>
              <Text style={styles.cardTitle}>
                {t('smartDisplay.enterText') || 'Enter Display Text'}
              </Text>

              <TextInput
                style={[styles.input, atLimit && styles.inputAtLimit]}
                value={inputText}
                onChangeText={handleChangeText}
                onKeyPress={handleKeyPress}
                onSubmitEditing={handleSubmitEditing}
                multiline
                returnKeyType="done"
                blurOnSubmit
              />
              {atLimit && (
                <Text style={styles.limitText}>Max length = 50 characters</Text>
              )}

              <Text style={[styles.cardTitle, { marginTop: 12 }]}>
                {t('smartDisplay.preview') || 'Preview'}
              </Text>
              <View style={styles.previewBox}>
                <Text style={styles.previewText}>{livePreviewText}</Text>
              </View>
            </View>
          )}

          {/* Leave Blank */}
          <Pressable
            onPress={() => choose('blank')}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === 'blank' }}
            style={({ pressed }) => [
              rowStyle(selected === 'blank'),
              pressed && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.rowLabel}>
              {t('smartDisplay.leaveBlank') || 'Leave Blank'}
            </Text>
            <Text style={[styles.check, { opacity: selected === 'blank' ? 1 : 0 }]}>✓</Text>
          </Pressable>
        </View>

        {/* Save / Update */}
        <Pressable
          onPress={handleUpdateDisplay}
          style={({ pressed }) => [
            styles.saveBtn,
            { opacity: pressed ? 0.95 : 1 },
          ]}
        >
          <Text style={styles.saveText}>
            {t('smartDisplay.updateBtn') || 'Update Display'}
          </Text>
        </Pressable>

        {!dirty && (
          <Text style={{ color: '#9aa3b2', marginTop: 8, fontSize: 12 }}>
            {t('') || ''}
          </Text>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: screenHeight * 0.05 },
  content: { padding: 20, paddingBottom: 32 },

  header: { marginBottom: 14, alignItems: 'flex-start' },
  title: { color: '#fff', fontSize: 28, fontFamily: 'MontserratAlt1-SemiBold' },
  subtitle: { color: '#bbb', marginTop: 6, fontSize: 15, fontFamily: 'MontserratAlt1-Light' },

  cardTitle: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 10,
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
  rowActive: {
    borderColor: '#3b82f6',
    backgroundColor: '#0f172a',
  },
  rowLabel: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'MontserratAlt1-Regular',
    flex: 1,
  },
  check: { color: '#4ade80', fontSize: 18, fontWeight: '700' },

  input: {
    minHeight: 120,
    backgroundColor: '#101010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 16,
    fontFamily: 'MontserratAlt1-Regular',
    textAlignVertical: 'top',
  },
  inputAtLimit: { borderColor: '#FF3B30' },
  limitText: {
    marginTop: 6,
    fontSize: 12,
    color: '#FF3B30',
    fontFamily: 'MontserratAlt1-Regular',
  },

  previewBox: {
    backgroundColor: '#101010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 20,
    minHeight: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewText: {
    color: '#ccc',
    fontSize: 22,
    fontFamily: 'MontserratAlt1-Regular',
    textAlign: 'center',
  },

  saveBtn: {
    marginTop: 24,
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

  // 🔔 Popup styles (same as Settings / Notifications)
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
