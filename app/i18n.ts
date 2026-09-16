// i18n.ts (final)
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as RNLocalize from 'react-native-localize';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---- English + Hindi (ISO folders) ----
import en from './assets/locales/en/common.json';
import hi from './assets/locales/hi/common.json';

// ---- Your custom folder names mapped to ISO codes ----
// bn (Bengali)   -> folder "be"
// mr (Marathi)   -> folder "ma"
// te (Telugu)    -> folder "te"
// ta (Tamil)     -> folder "ta"
// gu (Gujarati)  -> folder "gu"
// kn (Kannada)   -> folder "ka"
// ml (Malayalam) -> folder "mal"
// pa (Punjabi)   -> folder "pu"
// fr (French)    -> folder "fr"
// es (Spanish)   -> folder "sp"
import bn from './assets/locales/be/common.json';
import mr from './assets/locales/ma/common.json';
import te from './assets/locales/te/common.json';
import ta from './assets/locales/ta/common.json';
import gu from './assets/locales/gu/common.json';
import kn from './assets/locales/ka/common.json';
import ml from './assets/locales/mal/common.json';
import pa from './assets/locales/pu/common.json';
import fr from './assets/locales/fr/common.json';
import es from './assets/locales/sp/common.json';

const LANG_KEY = 'prefs:language';

// Map device/local codes to our ISO keys
const ALIAS_MAP: Record<string, string> = {
  // ISO we use directly
  en: 'en',
  hi: 'hi',
  fr: 'fr',
  es: 'es',
  bn: 'bn',
  mr: 'mr',
  te: 'te',
  ta: 'ta',
  gu: 'gu',
  kn: 'kn',
  ml: 'ml',
  pa: 'pa',
  // Common regional variants → base
  'en-US': 'en', 'en-GB': 'en',
  'hi-IN': 'hi',
  'bn-IN': 'bn',
  'mr-IN': 'mr',
  'te-IN': 'te',
  'ta-IN': 'ta',
  'gu-IN': 'gu',
  'kn-IN': 'kn',
  'ml-IN': 'ml',
  'pa-IN': 'pa',
  'fr-FR': 'fr', 'fr-CA': 'fr',
  'es-ES': 'es', 'es-MX': 'es'
};

// The actual resources the app exposes (keys are ISO codes!)
const resources = {
  en: { common: en },
  hi: { common: hi },
  bn: { common: bn },
  mr: { common: mr },
  te: { common: te },
  ta: { common: ta },
  gu: { common: gu },
  kn: { common: kn },
  ml: { common: ml },
  pa: { common: pa },
  fr: { common: fr },
  es: { common: es },
} as const;

export async function initI18n() {
  // Pick saved language or map device locale → ISO code we support
  const saved = await AsyncStorage.getItem(LANG_KEY);
  const deviceCode =
    RNLocalize.getLocales?.()[0]?.languageTag ||
    RNLocalize.getLocales?.()[0]?.languageCode ||
    'en';

  const mappedDevice = ALIAS_MAP[deviceCode] || ALIAS_MAP[deviceCode.split('-')[0]] || 'en';
  const initial =
    (saved && (resources as any)[saved]) ? saved : ((resources as any)[mappedDevice] ? mappedDevice : 'en');

  await i18n
    .use(initReactI18next)
    .init({
      compatibilityJSON: 'v3',
      resources,
      lng: initial,
      fallbackLng: 'en',
      ns: ['common'],
      defaultNS: 'common',
      supportedLngs: Object.keys(resources), // ensure i18next knows all
      nonExplicitSupportedLngs: true,
      interpolation: { escapeValue: false }
    });

  // Persist choice whenever user switches in-app
  i18n.on('languageChanged', async (lng) => {
    try { await AsyncStorage.setItem(LANG_KEY, lng); } catch {}
  });

  return i18n;
}

export default i18n;
