// screens/userinfo.tsx
import React, { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, Animated, Pressable, useWindowDimensions, Alert,
  ActivityIndicator, Easing, NativeSyntheticEvent, TextInputKeyPressEventData,
} from "react-native";
import auth from "@react-native-firebase/auth";
import firestore from "@react-native-firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useBag } from "../logics/bag/bagContext";

interface Props { navigation: any; route?: any; }

const PROFILE_KEY = "profile:v2";

/* ---------------- Buttons ---------------- */
type BrandButtonProps = { title: string; onPress: () => void | Promise<void>; disabled?: boolean; loading?: boolean; style?: any; };

const BrandButtonBase: React.FC<BrandButtonProps> = ({ title, onPress, disabled, loading, style }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const inFlight = useRef(false);
  const pressIn = useCallback(
    () => Animated.timing(scale, { toValue: 0.97, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(),
    [scale]
  );
  const pressOut = useCallback(
    () => Animated.timing(scale, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(),
    [scale]
  );
  const handlePress = useCallback(async () => {
    if (disabled || loading || inFlight.current) return;
    inFlight.current = true;
    try { await onPress(); } finally { inFlight.current = false; }
  }, [disabled, loading, onPress]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={handlePress}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.cta,
          (disabled || loading) && styles.ctaDisabled,
          pressed && !disabled && !loading && { opacity: 0.92 },
          style,
        ]}
      >
        {loading ? (
          <View style={styles.rowCenter}>
            <ActivityIndicator />
            <Text style={[styles.ctaText, { marginLeft: 8 }]}>Please wait…</Text>
          </View>
        ) : (
          <Text style={styles.ctaText}>{title}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
};
const BrandButton = memo(BrandButtonBase);

type BrandTextButtonProps = { title: string; onPress: () => void | Promise<void>; disabled?: boolean; };
const BrandTextButtonBase: React.FC<BrandTextButtonProps> = ({ title, onPress, disabled }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn  = useCallback(() => Animated.timing(scale, { toValue: 0.98, duration: 70, useNativeDriver: true }).start(), [scale]);
  const onPressOut = useCallback(() => Animated.timing(scale, { toValue: 1, duration: 90, useNativeDriver: true }).start(), [scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable disabled={disabled} onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}
        style={({ pressed }) => [{ opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
        <Text style={styles.resendLink}>{title}</Text>
      </Pressable>
    </Animated.View>
  );
};
const BrandTextButton = memo(BrandTextButtonBase);

/* ---------------- Main Screen ---------------- */
export default function PhoneNameScreen({ navigation, route }: Props) {
  const userData = route?.params?.userData || {};

  // === OTP / phone step ===
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [otpRequested, setOtpRequested] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [step, setStep] = useState<1 | 2>(1);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // === PROFILE: first + last (both required) ===
  const initialName: string = userData?.name || "";
  const [firstName, setFirstName] = useState<string>(initialName.split(" ")[0] || "");
  const [lastName,  setLastName]  = useState<string>(initialName.split(" ").slice(1).join(" "));

  // BagContext (new API)
  const { setProfile } = useBag(); // setProfile({ firstName?, lastName?, phone? })

  // phone verificationId for linking
  const [verificationId, setVerificationId] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const otpRefs = useRef(Array.from({ length: 6 }, () => React.createRef<TextInput>())).current;
  const { width } = useWindowDimensions();
  const isOtpComplete = otp.every((d) => d !== "");

  // ✅ Require BOTH names
  const isFormValid = firstName.trim().length >= 2 && lastName.trim().length >= 1;

  const requestOtpAnim = useRef(new Animated.Value(0)).current;
  const verifyAnim     = useRef(new Animated.Value(0)).current;
  const saveAnim       = useRef(new Animated.Value(0)).current;

  /* --- Animations --- */
  useEffect(() => {
    const ok = !otpRequested && phoneNumber.replace(/\D/g,"").length >= 10;
    if (ok) setTimeout(() => Animated.timing(requestOtpAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start(), 200);
    else requestOtpAnim.setValue(0);
  }, [phoneNumber, otpRequested, requestOtpAnim]);

  useEffect(() => {
    if (isOtpComplete) setTimeout(() => Animated.timing(verifyAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start(), 200);
    else verifyAnim.setValue(0);
  }, [isOtpComplete, verifyAnim]);

  useEffect(() => {
    if (isFormValid) setTimeout(() => Animated.timing(saveAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start(), 200);
    else saveAnim.setValue(0);
  }, [isFormValid, saveAnim]);

  /* --- Handlers --- */

  const handleRequestOtp = useCallback(async () => {
    try {
      const digits = phoneNumber.replace(/\D/g,"");
      if (digits.length < 10) { Alert.alert("Invalid number","Enter a valid 10-digit phone number."); return; }
      setIsRequestingOtp(true);
      const confirmation = await auth().signInWithPhoneNumber(`+91${digits}`);
      const vId = (confirmation as any)?.verificationId ?? null;
      setVerificationId(vId);
      setOtpRequested(true);
      setResendIn(25);
      setTimeout(() => otpRefs[0].current?.focus(), 200);
    } catch(err) {
      console.error(err);
      Alert.alert("Error","Failed to send OTP.");
    } finally { setIsRequestingOtp(false); }
  }, [phoneNumber, otpRefs]);

  const handleVerify = useCallback(async () => {
    const code = otp.join("");
    if (code === "201202") { setStep(2); return; } // dev override
    try {
      if (!verificationId) { Alert.alert("No verification","Request an OTP first."); return; }
      setIsVerifying(true);
      const credential = auth.PhoneAuthProvider.credential(verificationId, code);
      const user = auth().currentUser; if (!user) throw new Error("No signed-in user to link");
      // If already linked, treat as success
      try { await user.linkWithCredential(credential); }
      catch (e: any) { if (!String(e?.code || "").includes("already-linked")) throw e; }
      setStep(2);
    } catch(err:any) {
      console.error(err);
      Alert.alert("Invalid Code","Incorrect or expired.");
    } finally { setIsVerifying(false); }
  }, [verificationId, otp]);

  const makeFullName = useCallback(() => {
    const f = firstName.trim();
    const l = lastName.trim();
    return `${f} ${l}`; // both required
  }, [firstName, lastName]);

  // Save profile — AsyncStorage (v2) -> BagContext -> Firestore
  const handleProceed = useCallback(async () => {
    try {
      setIsSavingProfile(true);
      const firebaseUser = auth().currentUser;
      if (!firebaseUser) { Alert.alert("Not signed in","Please sign in again."); return; }

      const digits = phoneNumber.replace(/\D/g, "");
      const f = firstName.trim();
      const l = lastName.trim();
      const fullName = `${f} ${l}`;
      const phonePretty = `+91 ${digits}`;

      // v2 local payload
      const localV2 = { firstName: f, lastName: l, phone: phonePretty };

      // 1) Save locally first (authoritative for UI & Lost Mode)
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(localV2));

      // 2) Update BagContext immediately (instant placeholders)
      try { await setProfile(localV2); } catch (e) { console.warn("[userinfo] setProfile failed (non-fatal)", e); }

      // 3) Persist to Firestore (fullName only; remove legacy 'name')
      await firestore().collection("users").doc(firebaseUser.uid).set(
        {
          fullName,
          phone: phonePretty,
          email: firebaseUser.email ?? "",
          fingerprintEnrolled: false,
          updatedAt: firestore.FieldValue.serverTimestamp(),
          name: firestore.FieldValue.delete(), // cleanup legacy field
        },
        { merge: true }
      );

      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();

      navigation.navigate("Discovery", {
        userData: {
          ...userData,
          phoneNumber: phonePretty,
          displayName: f, // UI can show first name
          email: firebaseUser.email ?? "",
          attachedId: "Google",
        },
      });
    } catch (err) {
      console.error("[userinfo] Save failed", err);
      Alert.alert("Save failed","Couldn’t save your details.");
    } finally {
      setIsSavingProfile(false);
    }
  }, [fadeAnim, firstName, lastName, navigation, phoneNumber, setProfile, userData]);

  /* --- OTP input --- */
  const focusIndex = useCallback((i:number)=>otpRefs[i]?.current?.focus(), [otpRefs]);
  const handleOtpChange = useCallback((text:string,idx:number)=>{
    const digits=text.replace(/\D/g,""); const next=[...otp];
    if(digits.length===0){ next[idx]=""; setOtp(next); return; }
    let cursor=idx; for(let i=0;i<digits.length && cursor<6;i++,cursor++){ next[cursor]=digits[i]; }
    setOtp(next); cursor<6?focusIndex(cursor):otpRefs[5].current?.blur();
  }, [otp, focusIndex, otpRefs]);
  const handleOtpKeyPress = useCallback((e:NativeSyntheticEvent<TextInputKeyPressEventData>,idx:number)=>{
    if(e.nativeEvent.key==="Backspace"){
      if(otp[idx]!==""){ const next=[...otp]; next[idx]=""; setOtp(next); }
      else if(idx>0){ const next=[...otp]; next[idx-1]=""; setOtp(next); focusIndex(idx-1); }
    }
  }, [otp, focusIndex]);

  useEffect(()=>{ let t:any; if(resendIn>0){ t=setTimeout(()=>setResendIn(s=>s-1),1000);} return()=>clearTimeout(t);},[resendIn]);

  const contentWidth = useMemo(()=> (width>420?380:Math.min(width*0.86,380)), [width]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS==="ios"?"padding":undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={[styles.content,{width:contentWidth}]}>
          {step===1 && (<>
            <Text style={styles.title}>Verify Your Number</Text>
            <Text style={styles.subtitle}>We’ll send a one-time code to keep your account secure.</Text>
            <Text style={styles.label}>Phone Number</Text>
            <View style={styles.phoneRow}>
              <View style={styles.ccBox}><Text style={styles.ccText}>+91</Text></View>
              <TextInput
                style={styles.phoneInput}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="Phone Number"
                placeholderTextColor="#777"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                maxLength={15}
              />
            </View>
            {!otpRequested && phoneNumber.replace(/\D/g,"").length>=10 && (
              <Animated.View style={{opacity:requestOtpAnim,transform:[{translateY:requestOtpAnim.interpolate({inputRange:[0,1],outputRange:[20,0]})}]}}>
                <BrandButton title="Request OTP" onPress={handleRequestOtp} loading={isRequestingOtp}/>
              </Animated.View>
            )}
            {otpRequested && (<View style={{marginTop:22}}>
              <Text style={styles.label}>Enter 6-digit code</Text>
              <View style={styles.otpBoxRow}>
                {otp.map((d,idx)=>(
                  <TextInput
                    key={idx}
                    ref={otpRefs[idx]}
                    style={styles.otpBox}
                    value={d}
                    onChangeText={(t)=>handleOtpChange(t,idx)}
                    onKeyPress={(e)=>handleOtpKeyPress(e,idx)}
                    keyboardType="number-pad"
                    maxLength={1}
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                  />
                ))}
              </View>
              <View style={styles.resendRow}>
                <Text style={styles.resendHint}>Didn’t get the code?</Text>
                <BrandTextButton disabled={resendIn>0} title={resendIn>0?`Resend in ${resendIn}s`:"Resend code"} onPress={handleRequestOtp}/>
              </View>
              <Animated.View style={{opacity:verifyAnim,transform:[{translateY:verifyAnim.interpolate({inputRange:[0,1],outputRange:[20,0]})}]}}>
                <BrandButton title={isVerifying?"Verifying…":"Verify"} onPress={handleVerify} disabled={!isOtpComplete} loading={isVerifying}/>
              </Animated.View>
            </View>)}
          </>)}

          {step===2 && (<>
            <Text style={styles.accTitle}>Account</Text>
            <Text style={styles.accSubtitle}>Set how you’ll appear in the app</Text>
            <View style={styles.card}>
              <Text style={styles.label}>First Name</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Enter your first name"
                placeholderTextColor="#777"
                autoCapitalize="words"
                maxLength={50}
              />

              <Text style={[styles.label, { marginTop: 14 }]}>Last Name</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Enter your last name"
                placeholderTextColor="#777"
                autoCapitalize="words"
                maxLength={50}
              />
            </View>

            {isFormValid && (
              <Animated.View style={{opacity:saveAnim,transform:[{translateY:saveAnim.interpolate({inputRange:[0,1],outputRange:[20,0]})}]}}>
                <BrandButton title="Save & Continue" onPress={handleProceed} disabled={!isFormValid} loading={isSavingProfile}/>
              </Animated.View>
            )}
          </>)}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* --- styles --- */
const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:"#000"},
  scrollContent:{flexGrow:1,alignItems:"center",justifyContent:"center"},
  content:{alignSelf:"center",paddingVertical:32},
  title:{fontFamily:"MontserratAlt1-SemiBold",fontSize:26,color:"#fff",textAlign:"center",marginBottom:8},
  subtitle:{fontFamily:"MontserratAlt1-Light",fontSize:17,color:"#bbb",textAlign:"center",marginBottom:28},
  label:{fontFamily:"MontserratAlt1-SemiBold",fontSize:16,color:"#fff",marginBottom:8},
  phoneRow:{flexDirection:"row",alignItems:"center",marginBottom:8},
  ccBox:{justifyContent:"center",alignItems:"center",backgroundColor:"#101010",borderColor:"#2a2a2a",borderWidth:1,borderRadius:12,paddingHorizontal:14,height:52,marginRight:10},
  ccText:{fontFamily:"MontserratAlt1-SemiBold",fontSize:15,color:"#fff"},
  phoneInput:{flex:1,height:52,backgroundColor:"#101010",color:"#fff",borderRadius:12,borderWidth:1,borderColor:"#2a2a2a",paddingHorizontal:14,fontSize:16,fontFamily:"MontserratAlt1-Regular"},
  otpBoxRow:{flexDirection:"row",justifyContent:"space-between",marginTop:8},
  otpBox:{width:46,height:54,backgroundColor:"#101010",color:"#fff",fontSize:20,textAlign:"center",borderRadius:12,borderWidth:1,borderColor:"#2a2a2a",fontFamily:"MontserratAlt1-SemiBold"},
  resendRow:{flexDirection:"row",alignItems:"center",marginTop:10,marginBottom:12},
  resendHint:{color:"#888",fontSize:13,marginRight:8,fontFamily:"MontserratAlt1-Regular"},
  resendLink:{color:"#fff",fontSize:13,textDecorationLine:"underline",fontFamily:"MontserratAlt1-Medium"},
  accTitle:{color:"#fff",fontSize:28,fontFamily:"MontserratAlt1-SemiBold"},
  accSubtitle:{color:"#bbb",marginTop:6,fontSize:15,fontFamily:"MontserratAlt1-Light"},
  card:{backgroundColor:"#0f0f0f",borderRadius:14,borderWidth:1,borderColor:"#222",padding:16,marginTop:18},
  input:{height:52,backgroundColor:"#101010",color:"#fff",borderRadius:12,borderWidth:1,borderColor:"#2a2a2a",paddingHorizontal:14,fontSize:16,fontFamily:"MontserratAlt1-Regular"},
  cta:{height:52,borderRadius:14,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",marginTop:12},
  ctaDisabled:{backgroundColor:"#333"},
  ctaText:{color:"#000",fontSize:16,fontFamily:"MontserratAlt1-SemiBold"},
  rowCenter:{flexDirection:"row",alignItems:"center",justifyContent:"center"},
});
