// utils/authUtils.js
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const signOut = async (navigation) => {
  try {
    // Sign out from Google
    await GoogleSignin.signOut();
    
    // Clear stored user data
    await AsyncStorage.removeItem('userData');
    
    console.log('User signed out successfully');
    
    // Navigate back to login screen
    navigation.reset({
      index: 0,
      routes: [{ name: 'Login' }],
    });
  } catch (error) {
    console.error('Error signing out:', error);
  }
};

export const getCurrentUser = async () => {
  try {
    const userData = await AsyncStorage.getItem('userData');
    return userData ? JSON.parse(userData) : null;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
};

export const revokeAccess = async (navigation) => {
  try {
    // Revoke access and sign out
    await GoogleSignin.revokeAccess();
    await AsyncStorage.removeItem('userData');
    
    console.log('Access revoked successfully');
    
    navigation.reset({
      index: 0,
      routes: [{ name: 'Login' }],
    });
  } catch (error) {
    console.error('Error revoking access:', error);
  }
};