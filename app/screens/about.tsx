// screens/about.tsx
import React from 'react';
import { ScrollView, View, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

const { height: screenHeight } = Dimensions.get('window');

export default function AboutScreen() {
  const { t } = useTranslation();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('about.title')}</Text>
        <Text style={styles.subtitle}>{t('about.subtitle')}</Text>
      </View>

      {/* Card: Application Details */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('about.applicationDetails')}</Text>
        <Text style={styles.rowText}>
          <Text style={styles.bold}>{t('about.appNameLabel')}: </Text>
          <Text style={styles.body}>{t('about.appName')}</Text>
        </Text>
        <Text style={styles.rowText}>
          <Text style={styles.bold}>{t('about.appVersionLabel')}: </Text>
          <Text style={styles.body}>{t('about.appVersion')}</Text>
        </Text>
        <Text style={styles.rowText}>
          <Text style={styles.bold}>{t('about.hwVersionLabel')}: </Text>
          <Text style={styles.body}>{t('about.hwVersion')}</Text>
        </Text>
        <Text style={styles.rowText}>
          <Text style={styles.bold}>{t('about.releaseDateLabel')}: </Text>
          <Text style={styles.body}>{t('about.releaseDate')}</Text>
        </Text>
        <Text style={styles.rowText}>
          <Text style={styles.bold}>{t('about.developerLabel')}: </Text>
          <Text style={styles.body}>{t('about.developer')}</Text>
        </Text>
        <Text style={styles.rowTextLast}>
          <Text style={styles.bold}>{t('about.officialContactLabel')}: </Text>
          <Text style={styles.body}>{t('about.officialContact')}</Text>
        </Text>
      </View>

      {/* Card: System Overview */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('about.systemOverview')}</Text>
        <Text style={styles.body}>{t('about.systemOverviewP1')}</Text>
        <Text style={styles.body}>{t('about.systemOverviewP2')}</Text>
      </View>

      {/* Card: Key Features */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('about.keyFeatures')}</Text>

        <Text style={styles.featureTitle}>{t('about.featSmartUnlockingTitle')}</Text>
        <Text style={styles.body}>{t('about.featSmartUnlockingBody')}</Text>

        <Text style={styles.featureTitle}>{t('about.featLocationTitle')}</Text>
        <Text style={styles.body}>{t('about.featLocationBody')}</Text>

        <Text style={styles.featureTitle}>{t('about.featTravelModeTitle')}</Text>
        <Text style={styles.body}>{t('about.featTravelModeBody')}</Text>

        <Text style={styles.featureTitle}>{t('about.featSecurityTitle')}</Text>
        <Text style={styles.body}>{t('about.featSecurityBody')}</Text>

        <Text style={styles.featureTitle}>{t('about.featNotificationsTitle')}</Text>
        <Text style={styles.body}>{t('about.featNotificationsBody')}</Text>
      </View>

      {/* Card: Customer Support */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('about.customerSupport')}</Text>
        <Text style={styles.body}>{t('about.supportP1')}</Text>
        <Text style={styles.body}>
          <Text style={styles.bold}>{t('about.supportEmailLabel')}: </Text>
          {t('about.officialContact')}{'\n'}
          <Text style={styles.bold}>{t('about.supportSlaLabel')}: </Text>
          {t('about.supportSla')}
        </Text>
      </View>

      {/* Card: Disclaimer */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('about.disclaimer')}</Text>
        <Text style={styles.body}>{t('about.disclaimerP1')}</Text>
        <Text style={styles.body}>{t('about.disclaimerP2')}</Text>
        <Text style={styles.body}>{t('about.disclaimerP3')}</Text>
      </View>

      {/* Card: IP */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('about.license')}</Text>
        <Text style={styles.body}>{t('about.licenseBody')}</Text>
      </View>

      {/* Card: Updates */}
      <View style={[styles.card, { marginBottom: 32 }]}>
        <Text style={styles.cardTitle}>{t('about.updates')}</Text>
        <Text style={styles.body}>{t('about.updatesBody')}</Text>
      </View>
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

  // cards
  card: {
    backgroundColor: '#0f0f0f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    padding: 16,
    marginTop: 18,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 2 },
    }),
  },
  cardTitle: { color: '#fff', fontSize: 16, marginBottom: 10, fontFamily: 'MontserratAlt1-SemiBold' },

  // text
  body: { color: '#ccc', fontSize: 15, lineHeight: 22, fontFamily: 'MontserratAlt1-Regular' },
  bold: { color: '#fff', fontFamily: 'MontserratAlt1-SemiBold' },

  // rows inside detail card
  rowText: { marginBottom: 8 },
  rowTextLast: { marginBottom: 0 },

  featureTitle: {
    color: '#fff',
    fontSize: 16,
    marginTop: 14,
    marginBottom: 8,
    fontFamily: 'MontserratAlt1-SemiBold',
  },
});
