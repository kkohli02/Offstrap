// screens/BagHub.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Animated,
} from 'react-native';
import type { ViewStyle, ImageSourcePropType, LayoutChangeEvent } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useBag } from '../logics/bag/bagContext';
import { useTranslation } from 'react-i18next';

const { height: screenHeight, width: screenWidth } = Dimensions.get('window');
const scale = (size: number) => (screenWidth / 375) * size;
const verticalScale = (size: number) => (screenHeight / 812) * size;
const moderateScale = (size: number, factor = 0.5) =>
  size + (scale(size) - size) * factor;

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

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const BatteryIndicator: React.FC<BatteryIndicatorProps> = ({ level, style, source }) => {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const anim = useRef(new Animated.Value(clamp01((+level || 0) / 100))).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamp01((+level || 0) / 100),
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [level, anim]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - dims.w) > 0.5 || Math.abs(height - dims.h) > 0.5) {
      setDims({ w: width, h: height });
    }
  };

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
            // @ts-ignore Animated width type
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
/* ========================================================================== */

export default function BagHub({ navigation }: any) {
  const { t } = useTranslation();
  const { bagName, batteryPct } = useBag();

  const goToDiscovery = () => {
    navigation.navigate?.('Discovery');
    navigation.getParent?.()?.navigate('Discovery');
  };

  return (
    <SafeAreaProvider>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('bagHub.title')}</Text>
          <Text style={styles.subtitle}>{t('bagHub.subtitle')}</Text>
        </View>

        {/* Bag card */}
        <TouchableOpacity style={styles.bagInfoCard} onPress={() => {}}>
          <View style={styles.bagIconContainer}>
            <View style={styles.bagIconHolder}>
              <Image source={require('../assets/bag.jpeg')} style={styles.bagIcon} />
            </View>
          </View>
          <View style={styles.bagInfoTextContainer}>
            <Text style={styles.bagInfoCenterTitle} numberOfLines={1}>
              {bagName}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', height: 20, marginTop: 2 }}>
              <BatteryIndicator level={batteryPct} style={styles.batIcon} />
              <Text style={styles.bagConnectionText}>{`${batteryPct}%`}</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Add an Offstrap (centered) */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.centerRow} onPress={goToDiscovery}>
            <Image source={require('../assets/add.png')} style={styles.addIcon} />
            <Text style={styles.addLabel}>{t('bagHub.addOffstrap')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaProvider>
  );
}

/* ========================= styles ========================= */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: screenHeight * 0.05 },
  content: { padding: 16, paddingBottom: 32 },

  header: { marginBottom: 14, alignItems: 'flex-start' },
  title: { color: '#fff', fontSize: 28, fontFamily: 'MontserratAlt1-SemiBold' },
  subtitle: { color: '#bbb', marginTop: 6, fontSize: 15, fontFamily: 'MontserratAlt1-Light' },

  // bag card
  bagInfoCard: {
    height: verticalScale(80),
    width: '100%',
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(15),
    borderRadius: moderateScale(12),
    alignItems: 'center',
    marginBottom: verticalScale(16),
  },
  bagIconContainer: {
    height: moderateScale(50),
    width: moderateScale(50),
    justifyContent: 'center',
    alignItems: 'center',
  },
  bagIconHolder: {
    borderRadius: moderateScale(25),
    overflow: 'hidden',
    backgroundColor: '#abb4c2',
    height: '100%',
    width: '100%',
  },
  bagIcon: { resizeMode: 'cover', height: '100%', width: '100%' },
  bagInfoTextContainer: { flex: 1, paddingLeft: scale(10) },
  bagInfoCenterTitle: { fontSize: moderateScale(20), fontWeight: '500', color: 'black' },
  bagConnectionText: { fontSize: moderateScale(16), color: 'black', paddingHorizontal: 10 },
  batIcon: { height: verticalScale(30), width: scale(32), resizeMode: 'contain', marginTop: 4, marginRight: 10 },

  // section
  section: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingVertical: 18,
    marginBottom: 16,
    alignItems: 'center',
  },

  // centered row
  centerRow: { flexDirection: 'row', alignItems: 'center' },
  addIcon: { marginRight: 10, height: 20, width: 20, resizeMode: 'contain' },
  addLabel: { color: 'white', fontSize: 16, fontFamily: 'MontserratAlt1-Regular' },
});