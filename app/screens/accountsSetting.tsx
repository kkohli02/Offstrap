// screens/accountSetting.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Platform,
  Dimensions,
  Alert,
  Pressable,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useBag } from '../logics/bag/bagContext';

const { height: screenHeight } = Dimensions.get('window');

export default function AccountScreen({ navigation }: any) {
  const { t } = useTranslation();

  // ---- Single source of truth: BagContext ----
  const {
    firstName: ctxFirst,
    lastName:  ctxLast,
    phone:     ctxPhone,
    setProfile,
  } = useBag();

  // Local editable fields (mirror context)
  const [firstName, setFirstName] = useState<string>(ctxFirst || '');
  const [lastName,  setLastName]  = useState<string>(ctxLast || '');
  const [phone,     setPhone]     = useState<string>(ctxPhone || '');

  // Reflect context changes
  useEffect(() => { setFirstName(ctxFirst || ''); }, [ctxFirst]);
  useEffect(() => { setLastName(ctxLast || '');   }, [ctxLast]);
  useEffect(() => { setPhone(ctxPhone || '');     }, [ctxPhone]);

  // Grey out Save until something changed
  const dirty = useMemo(() => {
    return (
      (firstName ?? '') !== (ctxFirst ?? '') ||
      (lastName  ?? '') !== (ctxLast  ?? '') ||
      (phone     ?? '') !== (ctxPhone ?? '')
    );
  }, [firstName, lastName, phone, ctxFirst, ctxLast, ctxPhone]);

  const onSave = async () => {
    const f = (firstName || '').trim();
    const l = (lastName  || '').trim();
    const p = (phone     || '').trim();

    if (f.length < 2) {
      Alert.alert(
        t('account.firstNameRequiredTitle') || 'First name required',
        t('account.firstNameRequiredBody')  || 'Please enter your first name.',
      );
      return;
    }
    if (l.length < 1) {
      Alert.alert(
        t('account.lastNameRequiredTitle') || 'Last name required',
        t('account.lastNameRequiredBody')  || 'Please enter your last name.',
      );
      return;
    }

    try {
      await setProfile({ firstName: f, lastName: l, phone: p });

      Alert.alert(
        t('account.savedTitle') || 'Saved',
        t('account.savedBody')  || 'Your changes have been saved.',
      );
      try {
        navigation?.canGoBack?.() ? navigation.goBack() : null;
      } catch {}
    } catch (e) {
      Alert.alert(
        t('account.errorTitle') || 'Couldn’t save',
        t('account.errorBody')  || 'Please try again.',
      );
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Heading */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('account.title')}</Text>
        <Text style={styles.subtitle}>{t('account.subtitle')}</Text>
      </View>

      {/* Card: Profile */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('account.profile')}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t('account.firstName') || 'First Name'}</Text>
          <TextInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder={t('account.firstNamePlaceholder') || 'Enter your first name'}
            placeholderTextColor="#777"
            style={styles.input}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('account.lastName') || 'Last Name'}</Text>
          <TextInput
            value={lastName}
            onChangeText={setLastName}
            placeholder={t('account.lastNamePlaceholder') || 'Enter your last name'}
            placeholderTextColor="#777"
            style={styles.input}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('account.phone') || 'Phone'}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder={t('account.phonePlaceholder') || '+91 99107 80862'}
            placeholderTextColor="#777"
            style={styles.input}
            keyboardType="phone-pad"
          />
        </View>
      </View>

      {/* Save Button */}
      <Pressable
        onPress={dirty ? onSave : undefined}
        disabled={!dirty}
        style={({ pressed }) => [
          styles.saveBtn,
          !dirty && styles.saveBtnDisabled,
          { opacity: pressed && dirty ? 0.95 : 1 },
        ]}
      >
        <Text style={[styles.saveText, !dirty && styles.saveTextDisabled]}>
          {t('account.saveChanges')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: screenHeight * 0.05 },
  content: { padding: 20, paddingBottom: 32 },

  header: { marginBottom: 14, alignItems: 'flex-start' },
  title: { color: '#fff', fontSize: 28, fontFamily: 'MontserratAlt1-SemiBold' },
  subtitle: { color: '#bbb', marginTop: 6, fontSize: 15, fontFamily: 'MontserratAlt1-Light' },

  card: {
    backgroundColor: '#0f0f0f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    padding: 16,
    marginTop: 18,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 10,
    fontFamily: 'MontserratAlt1-SemiBold',
  },

  field: { marginBottom: 14 },
  label: {
    color: '#9aa',
    marginBottom: 6,
    fontSize: 13,
    fontFamily: 'MontserratAlt1-Medium',
  },
  input: {
    height: 52,
    backgroundColor: '#101010',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 14,
    color: '#fff',
    fontSize: 16,
    fontFamily: 'MontserratAlt1-Regular',
  },

  // Save button
  saveBtn: {
    marginTop: 22,
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
  saveText: {
    color: '#000',
    fontSize: 16,
    fontFamily: 'MontserratAlt1-SemiBold',
  },
  saveBtnDisabled: {
    backgroundColor: '#444',
    shadowOpacity: 0,
    elevation: 0,
  },
  saveTextDisabled: {
    color: '#aaa',
  },
});
