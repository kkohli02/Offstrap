import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
  Animated,
  Pressable,
  Platform,
} from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

type UserProfile = {
  fullName?: string;
  email?: string;
  phone?: string;
  bagId?: string;
  fingerprintEnrolled?: boolean;
  updatedAt?: any;
};

export default function LoginScreen({ navigation }: any) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // --- responsive sizing ---
  const { width, height } = useWindowDimensions();
  const logoFontSize = Math.max(36, Math.min(68, width * 0.12));
  const taglineFontSize = Math.max(12, Math.min(18, width * 0.045));
  const verticalGap = Math.max(48, Math.min(72, height * 0.065));
  const gapLogoTagline = Math.max(14, Math.min(22, height * 0.021));

  // --- animations ---
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoTranslate = useRef(new Animated.Value(12)).current;
  const tagOpacity = useRef(new Animated.Value(0)).current;
  const tagTranslate = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(logoTranslate, { toValue: 0, duration: 450, useNativeDriver: true }),
      ]),
      Animated.delay(125),
      Animated.parallel([
        Animated.timing(tagOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(tagTranslate, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();
  }, [logoOpacity, logoTranslate, tagOpacity, tagTranslate]);

  /** ---- Firestore helpers ---- */

  const fetchUserProfile = useCallback(async (uid: string, email?: string): Promise<UserProfile | null> => {
    // Prefer doc keyed by UID
    const doc = await firestore().collection('users').doc(uid).get();
    if (doc.exists) return doc.data() as UserProfile;

    // Fallback by email (helps older records if any)
    if (email) {
      const qs = await firestore().collection('users').where('email', '==', email).limit(1).get();
      if (!qs.empty) return qs.docs[0].data() as UserProfile;
    }
    return null;
  }, []);

  const routeAfterAuth = useCallback(
    async (uid: string, email?: string) => {
      const profile = await fetchUserProfile(uid, email);

      // Cache for UI convenience (not authoritative)
      const cache = {
        userId: uid,
        email: email ?? '',
        name: profile?.fullName ?? '',
        phone: profile?.phone ?? '',
        bagId: profile?.bagId ?? '',
        fingerprintEnrolled: !!profile?.fingerprintEnrolled,
      };
      await AsyncStorage.setItem('userData', JSON.stringify(cache));

      if (profile) {
        navigation.reset({ index: 0, routes: [{ name: 'Dashboard', params: { profile: cache } }] });
      } else {
        navigation.replace('PhoneName');
      }
    },
    [fetchUserProfile, navigation]
  );

  /** ---- Boot: check auth state + attempt silent sign-in ---- */
  useEffect(() => {
    const unsub = auth().onAuthStateChanged(async (user) => {
      if (user) {
        // Print a fresh Firebase ID token (JWT) for backend testing
        try {
          const firebaseJwt = await user.getIdToken(true);
          console.log('FIREBASE_ID_TOKEN:', firebaseJwt);
        } catch {}
        await routeAfterAuth(user.uid, user.email || undefined);
      } else {
        // Attempt silent Google sign-in (only if previous session exists)
        try {
          const hadPrev = await GoogleSignin.hasPreviousSignIn(); // ✅ called (fixes TS warning)
          if (hadPrev) {
            const { idToken } = await GoogleSignin.signInSilently();
            if (idToken) {
              // Convert Google idToken -> Firebase session
              const cred = auth.GoogleAuthProvider.credential(idToken);
              const uc = await auth().signInWithCredential(cred);

              // Now print the Firebase ID token (JWT)
              try {
                const firebaseJwt = await uc.user.getIdToken(true);
                console.log('FIREBASE_ID_TOKEN (silent):', firebaseJwt);
              } catch {}

              await routeAfterAuth(uc.user.uid, uc.user.email || undefined);
              return;
            }
          }
        } catch {
          // ignore; show login UI
        }
        setIsCheckingAuth(false);
      }
    });
    return unsub;
  }, [routeAfterAuth]);

  /** ---- Interactive Google sign-in ---- */
  const signInWithGoogle = async () => {
    try {
      setIsSigningIn(true);
      try {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      } catch {}

      const res = await GoogleSignin.signIn();
      let googleIdToken = res?.idToken ?? null;
      if (!googleIdToken) {
        const tokens = await GoogleSignin.getTokens();
        googleIdToken = tokens?.idToken ?? null;
      }
      if (!googleIdToken) throw new Error('No Google idToken from sign-in');

      const credential = auth.GoogleAuthProvider.credential(googleIdToken);
      const userCred = await auth().signInWithCredential(credential);

      // Print the Firebase (not Google) JWT for backend testing
      try {
        const firebaseJwt = await userCred.user.getIdToken(true);
        console.log('FIREBASE_ID_TOKEN (interactive):', firebaseJwt);
      } catch {}

      await routeAfterAuth(userCred.user.uid, userCred.user.email || undefined);
    } catch (error: any) {
      console.log('Google Sign-In Error:', error);
      if (error?.code === statusCodes.SIGN_IN_CANCELLED) return;
      else if (error?.code === statusCodes.IN_PROGRESS) {
        Alert.alert('Sign-in in progress', 'Please wait…');
      } else if (error?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Play Services unavailable', 'Please update Play Services');
      } else {
        Alert.alert('Sign-in failed', error?.message ?? 'Unknown error');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const signInWithApple = () => {
    Alert.alert('Apple Sign-In', 'Apple Sign-In not implemented yet');
    navigation.replace('Dashboard');
  };

  // --- button press animation ---
  const usePressAnim = () => {
    const scale = useRef(new Animated.Value(1)).current;
    const onPressIn = () =>
      Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
    const onPressOut = () =>
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
    return { scale, onPressIn, onPressOut };
  };

  const googleAnim = usePressAnim();
  const appleAnim = usePressAnim();

  if (isCheckingAuth) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.loadingText}>Checking authentication…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Logo */}
      <Animated.Text
        style={[
          styles.logoText,
          { fontSize: logoFontSize, opacity: logoOpacity, transform: [{ translateY: logoTranslate }] },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        OFFSTRAP
      </Animated.Text>

      {/* Tagline */}
      <Animated.Text
        style={[
          styles.tagline,
          {
            fontSize: taglineFontSize,
            marginTop: gapLogoTagline,
            marginBottom: verticalGap,
            opacity: tagOpacity,
            transform: [{ translateY: tagTranslate }],
          },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        Smart. Secure. Connected.
      </Animated.Text>

      {/* Google button */}
      <Animated.View style={{ transform: [{ scale: googleAnim.scale }], width: '70%', alignSelf: 'center' }}>
        <Pressable
          onPressIn={googleAnim.onPressIn}
          onPressOut={googleAnim.onPressOut}
          onPress={signInWithGoogle}
          disabled={isSigningIn}
          style={({ pressed }) => [
            styles.buttonBase,
            styles.buttonShadow,
            { opacity: isSigningIn ? 0.6 : pressed ? 0.95 : 1 },
          ]}
        >
          {isSigningIn ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <>
              <Image source={require('../assets/google_logo.png')} style={styles.icon} />
              <Text style={styles.btnText}>Sign in with Google</Text>
            </>
          )}
        </Pressable>
      </Animated.View>

      {/* Apple button */}
      <Animated.View style={{ transform: [{ scale: appleAnim.scale }], width: '70%', alignSelf: 'center' }}>
        <Pressable
          onPressIn={appleAnim.onPressIn}
          onPressOut={appleAnim.onPressOut}
          onPress={signInWithApple}
          style={({ pressed }) => [styles.buttonBase, styles.buttonShadow, { opacity: pressed ? 0.95 : 1 }]}
        >
          <Image source={require('../assets/apple_logo.png')} style={styles.icon} />
          <Text style={styles.btnText}>Sign in with Apple</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  centered: { justifyContent: 'center' },

  logoText: {
    fontFamily: 'MontserratAlt1-SemiBold',
    color: '#fff',
    textAlign: 'center',
    width: '80%',
    alignSelf: 'center',
  },

  tagline: {
    fontFamily: 'MontserratAlt1-Light',
    color: '#fff',
    textAlign: 'center',
    width: '80%',
    alignSelf: 'center',
    letterSpacing: 0.5,
  },

  buttonBase: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 18,
    paddingHorizontal: 14,
  },

  buttonShadow: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 4 },
    default: {},
  }),

  icon: { width: 20, height: 20, marginRight: 10, resizeMode: 'contain' },
  btnText: { fontSize: 16, color: '#000' },
  loadingText: { color: '#fff', marginTop: 10, fontSize: 16 },
});
