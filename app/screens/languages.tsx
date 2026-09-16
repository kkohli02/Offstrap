// screens/languages.tsx
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

const { height: screenHeight } = Dimensions.get('window');

const LANGS = [
  { code: 'en', label: 'English' }, // default
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'mr', label: 'Marathi' },
  { code: 'te', label: 'Telugu' },
  { code: 'ta', label: 'Tamil' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'kn', label: 'Kannada' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
];

const LANG_KEY = 'prefs:language';

export default function LanguagesScreen() {
  const { t, i18n } = useTranslation();
  // Start from current i18n language to avoid a visible "jump"
  const initial = (() => {
    const lng = (i18n.language || 'en').split('-')[0]; // normalize "en-US" -> "en"
    return LANGS.some(l => l.code === lng) ? lng : 'en';
  })();
  const [selected, setSelected] = useState<string>(initial);

  // Keep local state in sync if language is changed elsewhere
  useEffect(() => {
    const onChanged = (lng: string) => {
      const code = (lng || 'en').split('-')[0];
      if (LANGS.some(l => l.code === code)) setSelected(code);
    };
    i18n.on('languageChanged', onChanged);
    return () => {
      i18n.off('languageChanged', onChanged);
    };
  }, [i18n]);

  // Load saved language on mount and apply it
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LANG_KEY);
        if (saved && LANGS.some(l => l.code === saved)) {
          setSelected(saved);
          if (saved !== i18n.language) {
            try { await i18n.changeLanguage(saved); } catch {}
          }
        }
      } catch {}
    })();
  }, [i18n]);

  const choose = async (code: string) => {
    setSelected(code);
    try {
      await AsyncStorage.setItem(LANG_KEY, code);
    } catch {}
    try {
      await i18n.changeLanguage(code);
    } catch {}
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Heading */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('languages.title')}</Text>
        <Text style={styles.subtitle}>{t('languages.subtitle')}</Text>
      </View>

      {/* Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('languages.choose')}</Text>

        {LANGS.map((l) => {
          const isActive = l.code === selected;
          return (
            <Pressable
              key={l.code}
              onPress={() => choose(l.code)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              style={({ pressed }) => [
                styles.row,
                isActive && styles.rowActive,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.langLabel}>{l.label}</Text>
              {/* simple ✓ checkmark, no icon font */}
              <Text style={[styles.check, { opacity: isActive ? 1 : 0 }]}>✓</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.hint}>{t('languages.savedHint')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // page chrome
  container: { flex: 1, backgroundColor: '#000', paddingTop: screenHeight * 0.05 },
  content: { padding: 20, paddingBottom: 32 },
  header: { marginBottom: 14, alignItems: 'flex-start' },
  title: { color: '#fff', fontSize: 28, fontFamily: 'MontserratAlt1-SemiBold' },
  subtitle: { color: '#bbb', marginTop: 6, fontSize: 15, fontFamily: 'MontserratAlt1-Light' },

  // card
  card: {
    backgroundColor: '#0f0f0f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    padding: 8,
    paddingVertical: 10,
    marginTop: 18,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 6,
    paddingHorizontal: 8,
    fontFamily: 'MontserratAlt1-SemiBold',
  },

  // rows
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
  langLabel: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'MontserratAlt1-Regular',
    flex: 1,
  },
  check: { color: '#4ade80', fontSize: 18, fontWeight: '700' },

  hint: { color: '#8a8a8a', fontSize: 12, marginTop: 12, paddingHorizontal: 2 },
});