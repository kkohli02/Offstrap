// 👇 MUST be first
import 'react-native-gesture-handler';

import React, { useEffect, useState } from 'react';
import {
  View,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import firebase from '@react-native-firebase/app';
import auth from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BLEProvider } from './logics/ble/BLE';
import { BagProvider } from './logics/bag/bagContext';
import { AppLockProvider, AppLockGate } from './logics/security/appLock';
import NotificationEngine from './logics/notifications/NotificationEngine';

// i18n bootstrap
import { initI18n } from './i18n';

// Screens
import Dashboard from './screens/dashboard';
import LoginScreen from './screens/login';
import BLEDeviceSearchScreen from './screens/discovery';
import SettingsScreen from './screens/settings';
import BagHub from './screens/bagHub';
import AccountScreen from './screens/accountsSetting';
import UsageChartScreen from './screens/usage';
import AboutScreen from './screens/about';
import NotificationSettingsScreen from './screens/notification';
import PhoneNameScreen from './screens/userInfo';
import BagSetupScreen from './screens/bagOtp';
import LanguagesScreen from './screens/languages';
import FingerprintSetup from './screens/FingerprintSetup';
import FingerprintManager from './screens/FingerprintManager';
import smartScreen from './screens/smartScreen';

// 🔔 NEW: Toast root
import Toast from 'react-native-toast-message';

// ==== Keys used during setup ====
const PROFILE_KEY = 'profile:v2';
const BAG_LINK_KEY = 'bag:link:v1';
const FINGERPRINT_DONE_KEY = 'fingerprint:enrolled:v1';

export type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  BagHub: undefined;
  Discovery: undefined;
  Settings: undefined;
  FingerprintSetup: undefined;
  FingerprintManager: undefined;
  Account: undefined;
  Usage: undefined;
  About: undefined;
  Notifications: undefined;
  PhoneName: undefined;
  BagSetup: undefined;
  Languages: undefined;
  smartScreen: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ---- Setup gate: decide where to start ----
function SetupGate() {
  const [ready, setReady] = useState(false);
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList>('Login');

  useEffect(() => {
    let unsubAuth: (() => void) | null = null;

    const boot = async () => {
      // Wait for Firebase auth state
      await new Promise<void>((resolve) => {
        unsubAuth = auth().onAuthStateChanged(() => resolve());
      });

      const user = auth().currentUser;
      if (!user) {
        setInitialRoute('Login');
        setReady(true);
        return;
      }

      // Read local setup flags
      const [profileRaw, bagLink, fpDone] = await Promise.all([
        AsyncStorage.getItem(PROFILE_KEY),
        AsyncStorage.getItem(BAG_LINK_KEY),
        AsyncStorage.getItem(FINGERPRINT_DONE_KEY),
      ]);

      const hasProfile = !!profileRaw;
      const hasBag = !!bagLink;
      const hasFingerprint = !!fpDone;

      if (!hasProfile) {
        setInitialRoute('Login');
      } else if (hasProfile && hasBag && hasFingerprint) {
        setInitialRoute('Dashboard');
      } else if (hasProfile && !hasBag) {
        setInitialRoute('Discovery');
      } else if (hasProfile && hasBag && !hasFingerprint) {
        setInitialRoute('FingerprintSetup');
      } else {
        setInitialRoute('Login');
      }

      setReady(true);
    };

    boot();

    return () => {
      if (unsubAuth) try { unsubAuth(); } catch {}
    };
  }, []);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#000',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        animation: 'slide_from_right',
      }}
    >
      {/* Auth + Setup */}
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ gestureEnabled: false, fullScreenGestureEnabled: false }}
      />
      <Stack.Screen name="PhoneName" component={PhoneNameScreen} />
      <Stack.Screen name="Discovery" component={BLEDeviceSearchScreen} />
      <Stack.Screen name="BagSetup" component={BagSetupScreen} />
      <Stack.Screen name="FingerprintSetup" component={FingerprintSetup} />

      {/* App */}
      <Stack.Screen name="Dashboard" component={Dashboard} />
      <Stack.Screen name="BagHub" component={BagHub} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="Usage" component={UsageChartScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen
        name="Notifications"
        component={NotificationSettingsScreen}
      />
      <Stack.Screen name="Languages" component={LanguagesScreen} />
      <Stack.Screen name="FingerprintManager" component={FingerprintManager} />
      <Stack.Screen name="smartScreen" component={smartScreen} />
    </Stack.Navigator>
  );
}

const App = () => {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    (async () => {
      await initI18n();
      setI18nReady(true);
    })();

    if (!firebase.apps.length) {
      firebase.initializeApp();
    }
    GoogleSignin.configure({
      webClientId:
        '49049115254-idraobklmo4cpqami6k2d8u5sergnghv.apps.googleusercontent.com',
      iosClientId:
        '49049115254-09afbpt2p2po9vsbr8r30m21p5q92gom.apps.googleusercontent.com',
    });
  }, []);

  if (!i18nReady) return null;

  return (
    <>
      <BLEProvider>
        <BagProvider>
          <AppLockProvider>
            {/* 🔔 Notifications engine */}
            <NotificationEngine />

            {/* Navigator */}
            <NavigationContainer>
              <SetupGate />
            </NavigationContainer>

            {/* 🔐 App Lock overlay */}
            <AppLockGate />
          </AppLockProvider>
        </BagProvider>
      </BLEProvider>

      {/* 🔔 Toast root (global OffStrap popups) */}
      <Toast />
    </>
  );
};

export default App;
