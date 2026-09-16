import React, {useState, useEffect} from 'react'
import {SafeAreaView, View , Text, TouchableOpacity, Dimensions, Image, FlatList ,ScrollView,TextInput, Alert} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { Shadow } from 'react-native-shadow-2';
import _ from 'lodash'
import AntDesign from 'react-native-vector-icons/AntDesign'
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

import WifiManager from "react-native-wifi-reborn";
import Toast from 'react-native-toast-message'
import {REACT_APP_DEVICE_SSID } from './config'

const {width, height} = Dimensions.get('window')
const useableWidth = width - 20

function App({ route, navigation }) {

  const [state, setState] = useState({ loading: false, userData: null })

  useEffect(()=> {
    console.log('auth',auth)
    const user = auth().currentUser
    if(user){
      console.log('user',user.uid)
        if(user.displayName === null){
          firestore().collection('users').doc(user.uid).get()
          .then(userData => {
              console.log('userData',userData.data())
              //auth().updateProfile(user, { displayName: userData.data().userName })
              setState(prev => ({...prev, loading: false, userData: userData.data() }))
          })
          .catch(error => {
              console.log('error',error)
          })
        } else {
          setState(prev => ({...prev, loading: false, userData: userData.data() }))
        }

      }

  },[])

  const logOut = () => {
      Alert.alert(
       "Confirm",
       "Are you sure want to logout?",
       [
         {
           text: "Cancel",
           onPress: () => console.log("Cancel Pressed"),
           style: "cancel"
         },
         { text: "Yes", onPress: () => confirmLogout()}
       ]
     );
  }

  const confirmLogout = async () => {
    auth().signOut()
    // navigation.reset({
    //    index: 0,
    //    routes: [{ name: 'Dashboard' }],
    //  });
    //navigation.navigate('Dashboard', { skipped: true })
    route.params.backFromLogOut(true)
    setTimeout(()=> {
      navigation.goBack()
    },1000)



  }

  return (
    <SafeAreaView style={{ flex: 1, paddingTop: 20, alignItems: 'center', justifyContent: 'flex-start', backgroundColor: '#f4f4f4' }}>
          {state.userData !== null && (
            <View style={{ flex: 1, width: width- 100, alignItems: 'center',  }}>
              <Text style={{ color: 'black', textAlign: 'center', fontSize: 24, textTransform: 'capitalize' }}>{state.userData.userName}</Text>
              <Text style={{ paddingTop: 10, color: 'black', textAlign: 'center', fontSize: 16,  }}>{state.userData.email}</Text>

              <TouchableOpacity   onPress={logOut} style={{ justifyContent:'center', alignItems: 'center', marginTop:30,backgroundColor:'#C20950',  fontSize: 20,   borderRadius:5, paddingHorizontal:20, paddingVertical: 10 }}>
                <Text style={{color: 'white',fontFamily:'OpenSans-Regular', fontSize: 16}}>Logout</Text>
              </TouchableOpacity>

            </View>
          )}
    </SafeAreaView>
  )

}

export default App
