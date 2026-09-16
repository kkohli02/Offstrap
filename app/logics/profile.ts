// /logics/profile.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

const PROFILE_KEY = 'profile:v1';

export type Profile = {
  uid: string;
  name: string;
  phone?: string;
  email?: string;
  providerId?: string;   // e.g. "google.com" / "apple.com"
  photoURL?: string | null;
  updatedAt?: number;
};

// ---- Local storage helpers ----
export async function saveProfileLocal(p: Profile) {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

export async function getProfileLocal(): Promise<Profile | null> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  return raw ? (JSON.parse(raw) as Profile) : null;
}

export async function clearProfileLocal() {
  await AsyncStorage.removeItem(PROFILE_KEY);
}

// ---- Firestore helpers ----
export function userDoc(uid: string) {
  return firestore().collection('users').doc(uid);
}

export async function saveProfileRemote(p: Profile) {
  await userDoc(p.uid).set(
    {
      name: p.name ?? '',
      phone: p.phone ?? '',
      email: p.email ?? '',
      providerId: p.providerId ?? '',
      photoURL: p.photoURL ?? null,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getProfileRemote(uid: string): Promise<Profile | null> {
  const snap = await userDoc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return {
    uid,
    name: d.name || d.userName || '',
    phone: d.phone || '',
    email: d.email || '',
    providerId: d.providerId || '',
    photoURL: d.photoURL ?? null,
    updatedAt: Date.now(),
  };
}

// ---- High-level API ----
export async function getProfile(): Promise<Profile | null> {
  const local = await getProfileLocal();
  if (local?.uid) return local;

  const u = auth().currentUser;
  if (!u) return null;

  // Try remote, else build from Firebase user object
  const remote = await getProfileRemote(u.uid);
  const base: Profile =
    remote ?? {
      uid: u.uid,
      name: u.displayName || '',
      phone: '', // fill when you capture OTP
      email: u.email ?? '',
      providerId: (u.providerData?.[0]?.providerId as string) || '',
      photoURL: u.photoURL ?? null,
      updatedAt: Date.now(),
    };

  await saveProfileLocal(base);
  return base;
}

export async function saveProfile(p: Profile) {
  await Promise.all([saveProfileLocal(p), saveProfileRemote(p)]);
}

export async function updateProfile(partial: Partial<Profile>) {
  const current = (await getProfile()) || ({} as Profile);
  const merged = { ...current, ...partial, updatedAt: Date.now() } as Profile;
  await saveProfile(merged);
  return merged;
}

export async function clearProfile() {
  await clearProfileLocal();
}
