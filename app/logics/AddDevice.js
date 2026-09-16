import React, { useState, useEffect, useRef } from 'react'
import { SafeAreaView, View, Text, TouchableOpacity, PermissionsAndroid, Platform, Alert, FlatList, TextInput, AppState, Dimensions, ActivityIndicator } from 'react-native'
import WifiManager from "react-native-wifi-reborn";
import { REACT_APP_DEVICE_SSID, REACT_APP_DEVICE_PASS, REACT_APP_DEVICE_SSID_2, REACT_APP_DEVICE_PASS_2, REACT_APP_API_URL } from './config'

import net from 'react-native-tcp-socket';
import _ from 'lodash'
import AsyncStorage from '@react-native-async-storage/async-storage';
import AntDesign from 'react-native-vector-icons/AntDesign'
import MaterialIcons from 'react-native-vector-icons/MaterialIcons'

//import Wifi from "@josectobar/react-native-iot-wifi"
import axios from 'axios'
import Toast from 'react-native-toast-message'

const {width, height, scale} = Dimensions.get("window");


let client = null;
/*
step 0 - init
step 1 - permission granted
step2 - wifi enabled
step3 - connected to RGB
step 4 - getting data (wifi list from rgb)
step 5
step 6
*/


const App = ({ route, navigation }) => {

    console.log('navigation',navigation)
    console.log('route',route)

    const { type } = route.params
    let deviceSSID;
    let devicePass;
    let showlistDefault;
    if(type === '@rgbdevices'){
      deviceSSID = REACT_APP_DEVICE_SSID
      devicePass = REACT_APP_DEVICE_PASS
      showlistDefault = 1
    }
    else if(type === '@biodevices') {
      deviceSSID = REACT_APP_DEVICE_SSID_2
      devicePass = REACT_APP_DEVICE_PASS_2
      showlistDefault = 2
    }
    else {
      deviceSSID = REACT_APP_DEVICE_SSID_3
      devicePass = REACT_APP_DEVICE_PASS_3
      showlistDefault = 3
    }

    const appState = useRef(AppState.currentState);
    const [appStateVisible, setAppStateVisible] = useState(appState.current);

    const [state, setState] = useState({ showwifilist: false, wifilist: [], loading: false, selectedwifi: null, selectedwifipassword: '', connected: false, step: 0, deviceName: '', backable: false, networkError: false, step5error: false })


    // useEffect(()=> {
    //     componentDidMount()
    // },[])



    useEffect(() => {



      // Wifi.connect('DA RGB 4')
      // .then(()=> {
      //     console.log('yo')
      //     setshowwifilist(true)
      // }).catch((error) => {
      //     console.log('error',error)
      //     // if(Platform.OS === 'ios'){
      //     //     //Alert(`Please connect to ${deviceSSID} manually`)
      //     //
      //     // }
      //     setState(prev => ({...prev, networkError: true }))
      // })

      // Wifi.connect("DA RGB 4", error => {
      //   console.log(error ? "error: " + error : "connected to wifi-name");
      // });




      if(__DEV__){
        setState(prev => ({...prev, selectedwifipassword: 'YVGKQB7QYX' }) )
      }
      //getwifilistAndroid()

       const subscription = AppState.addEventListener("change", nextAppState => {
         if (
           appState.current.match(/inactive|background/) &&
           nextAppState === "active"
         ) {
           console.log("App has come to the foreground!");
         }

         appState.current = nextAppState;
         setAppStateVisible(appState.current);
         console.log("AppState", appState.current);
       });

       return () => {
          subscription.remove();
         console.log("Here, you can add clean up code - componentWillUnmount")
         if(client !== null){
           console.log('will destroy')
           client.destroy()
         }
       };



    }, []);

    useEffect(() => {
      console.log('app state changing')
      if(appStateVisible === 'active'){
        componentDidMount()
      }
    }, [appStateVisible]);



    const componentDidMount = async () => {
      // I love myself . amazing ..
      if(client !== null){
        console.log('will destroy')
        await client.destroy()
      }


      //setState(prev => {...prev, step5error: false })

        const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: 'Location permission is required for WiFi connections',
              message:
                'This app needs location permission as this is required  ' +
                'to scan for wifi networks.',
              buttonNegative: 'DENY',
              buttonPositive: 'ALLOW',
            },
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          // You can now use react-native-wifi-reborn
          console.log('ok do it')
            // Nutral here everything ...
          setState(prev => ({...prev, step: 1, step5error: false }) )
          componentDidMount2()

      } else {
          // Permission denied
      }
    }

    const componentDidMount2 = async () => {
        const enabled = await WifiManager.isEnabled();
        console.log('enabled', enabled)
        if (enabled === false){
            Alert('Enable your wifi')
            return;
        }

        setState(prev => ({...prev, step: 2 }) )
        var currentConnection = await WifiManager.getCurrentWifiSSID()
        console.log('x',currentConnection,deviceSSID)
        if(currentConnection != deviceSSID){

          WifiManager.connectToProtectedSSID(deviceSSID, devicePass, false).then(
              () => {
                console.log("Connected successfully!");
                  WifiManager.getCurrentWifiSSID().then(
                      ssid => {
                        console.log("Your current connected wifi SSID is " + ssid);
                        if(ssid === deviceSSID){
                          setState(prev => ({...prev, step: 3, networkError: false }))
                        }
                      },
                      () => {
                        console.log("Cannot get current SSID!");
                        setState(prev => ({...prev, networkError: true }))
                      }
                  );
              },
              (error) => {
                console.log("Connection failed!",error);
                Toast.show({ text1: 'Please connect to device using wifi manually.' })
                setState(prev => ({...prev, networkError: true }))

                  // WifiManager.getCurrentWifiSSID().then(
                  //     ssid => {
                  //       console.log("Your current connected wifi SSID is " + ssid);
                  //       if(ssid === deviceSSID){
                  //         setState(prev => ({...prev, step: 3, networkError: false }))
                  //       }
                  //     },
                  //     () => {
                  //       console.log("Cannot get current SSID!");
                  //       setState(prev => ({...prev, networkError: true }))
                  //     }
                  // );
              }
            );

            //alert(`Please connect to ${deviceSSID} manually`)
            //console.log('trying to conenct to DG RGB4')
            // WifiManager.connectToProtectedSSID(deviceSSID, devicePass, false)
            // .then(()=> {
            //     console.log('yo')
            //     setshowwifilist(true)
            // }).catch((error2) => {
            //     console.log('error',error2)
            //     // if(Platform.OS === 'ios'){
            //     //     //Alert(`Please connect to ${deviceSSID} manually`)
            //     //
            //     // }
            //     setState(prev => ({...prev, networkError: true }))
            // })


        }
        else {
          // its already connected to RGB 4 , now its setup time
          setState(prev => ({...prev, step: 3, networkError: false }))
        }
    }


    const step4 = () => {
      setState(prev => ({...prev, loading: true, step: 4 }))
      if(type === '@rgbdevices'){
        getlist(REACT_APP_API_URL)
      }
      else {
        console.log('fetching list of wifi ')
        axios.get('http://192.168.4.1/wpa')
        .then(response => {
          console.log('response ',response)
          // setState(prev => ({...prev, showwifilist: true , wifilist , loading: false, step: 5 }))
          if(typeof response.data.scan !== 'undefined'){
            var wifilist = _.map(response.data.scan, each => {
              return { id: each, name: each }
            })
            setState(prev => ({...prev, showwifilist: true , wifilist , loading: false, step: 5 }))

          }

        }).catch(error => {
            console.log('error',error)
        })
        //ssdid,,,... wifi ..
        // establishing a connection
        // axios.post (...wpanew , intern ssid, intern password:  , stat: true
        // will get i
      }
      // if (Platform.OS === 'ios'){
      //   getlist(REACT_APP_API_URL)
      // }
      // getwifilistAndroid()
    }

    const getwifilistAndroid = async () => {
      console.log('there there')
      var results = await WifiManager.loadWifiList()
      console.log('results',results)
      var wifilist = _.map(results, each => {
        //if(each.SSID !== deviceSSID){
          return { id: each.SSID, name: each.SSID }
        //}
      })
      wifilist = _.filter(wifilist, each => {
          return each.SSID !== deviceSSID;
      })
      console.log('wifilist',wifilist)
      setState(prev => ({...prev, showwifilist: true , wifilist , loading: false, step: 5 }))
    }

    const getlist = async (ip) => {
      //console.log('triggering')
      //setState(prev => ({...prev, r: response.data.r , g: response.data.g , b: response.data.b, w: response.data.w , loading: false }))

      // if(client !== null){
      //   await client.destroy()
      // }

      //console.log('destroy client',client)
    //client = net.connect(80, ip, ()=> {
    client = net.createConnection({ host: ip, port: 80 }, ()=> {
          console.log('connected')
          console.log('opened client on ' + JSON.stringify(client.address()));
          //setState(prev => ({...prev, connected: true }) )
          client.write(JSON.stringify({ req: 'wpaget', hash: 'rgb1' }))

          // if(Platform.OS == 'ios'){
          //   client.write(JSON.stringify({ req: 'wpaget', hash: 'rgb1' }))
          // }
          // else {
          //   getwifilistAndroid()
          // }

      });

      client.on('error', function(error) {
          console.log(error)

      });

      client.on('data', async (data) =>  {
        if(__DEV__){
          //console.log('message was received', typeof(data), data)
        }
        if(data !== null && data !== ''){
          data = data.toString()
          if(__DEV__){ console.log('data2',data) }
          if(data == 'ok' || data == 'Unsupported_Action'){
            return
          }
          if(__DEV__){
          //console.log(typeof(data))
          }

          try {
            data = JSON.parse(data);
          } catch (e) {
              return false;
          }
          if(typeof(data) !== 'object'){
            return
          }
          //data = JSON.parse(data)
          console.log('get data>',data)

          if(data.req == 'wpaget' && typeof data.status !== 'undefined' && (data.status === 'json_err' || data.status === 'Error')){
            setState(prev => ({...prev,   loading: false, networkError: true }))
            return
          }

          if(data.req == 'wpaget' && typeof data.scan !== 'undefined'){
            var wifilist = _.map(data.scan, each => {
              return { id: each, name: each }
            })
            console.log('wifilist',wifilist)
            if (wifilist.length > 0){
              setState(prev => ({...prev, showwifilist: true , wifilist ,  loading: false, step: 5 }))
            } else {
              setState(prev => ({...prev,   loading: false, step5error: true }))
            }
          }

          if(data.req === 'wpaset' && typeof data.status !== 'undefined' && data.status === true) {
            console.log('wtf han',data.ip)
            setState(prev => ({...prev, connected: true , loading: false }))



             try {
                var alldevices = AsyncStorage.getItem(type)
                console.log('alldevices',alldevices, typeof(alldevices))
                if (alldevices === null){
                  alldevices = {}
                }
                else {
                  //alldevices = JSON.parse(alldevices)
                  alldevices[data.ip] = state.deviceName
                }
                console.log('all devices we have',alldevices)
                await AsyncStorage.setItem(type, JSON.stringify(alldevices))

                Toast.show({ text1: 'Device added successfully' })
                route.params.reload()
                setTimeout(()=> {
                  console.log('will destroy 2')
                  navigation.goBack();
                },1000)


              } catch (e) {
                // saving error
                console.log('e',e)
              }

          }

        } else {
          console.log('need to handle this error as well')
        }
      });

    }

    const renderItem = ({item}) => {
      ///return (<View />)
      console.log('item',item)
      return (
        <TouchableOpacity style={{ height: 50, justifyContent: 'center', borderBottomWidth: 0.5, borderBottomColor: 'grey', paddingLeft: 4 }} onPress={()=>setState(prev => ({...prev, selectedwifi: item.name, step: 6, backable: true}) )} >
          <Text style={{ color: 'black', fontSize: 14 }}>{item.name}</Text>
        </TouchableOpacity>
      );
    }

    const setNework = async (item) => {
      if(type === '@rgbdevices'){
      client.write(JSON.stringify({ req: 'wpaset', hash: 'rgb1', ssid: state.selectedwifi, pass: state.selectedwifipassword }))
      }
      else {
        //console.log('ni')

        var response = await axios.post('http://192.168.4.1/wpanew', `${state.selectedwifi},${state.selectedwifipassword}`, {headers: {"Content-Type": "text/plain"}} )
            console.log('response',response.data)
            // I assume it returns true
            if(response.data){
              //var response2 = await axios.get('http://192.168.4.1/wpa')
                if(response.data.ip !== 'undefined'){
                  setState(prev => ({...prev, connected: true , loading: false }))
                  try {
                       var alldevices = AsyncStorage.getItem(type)
                       console.log('alldevices',alldevices, typeof(alldevices))
                       if (alldevices === null){
                         alldevices = {}
                       }
                       else {
                         //alldevices = JSON.parse(alldevices)
                         alldevices[response.data.ip] = state.deviceName
                       }
                       console.log('all devices we have',alldevices)
                       await AsyncStorage.setItem(type, JSON.stringify(alldevices))

                       Toast.show({ text1: 'Device added successfully' })
                       route.params.reload()
                       setTimeout(()=> {
                         console.log('will destroy 2')
                         navigation.goBack();
                       },1000)

                     } catch (e) {
                       // saving error
                       console.log('e',e)
                    }
                }

            }

      }
    }

    const backButton = () => {
      var step = state.step - 1
      if (step == 5){
        setState(prev => ({...prev, step: step, backable: false }))
      }
      else {
        setState(prev => ({...prev, step: step }))
      }
      console.log('step',step)
    }

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>

            {state.backable && (
              <TouchableOpacity style={{ padding: 5, flexDirection: 'row', alignItems: 'center' }} onPress={()=>backButton}>
                <MaterialIcons name='arrow-back' size={24} color='black' />
                <Text style={{ color: 'black', fontFamily: 'OpenSans-Regular', fontSize: 19, fontWeight: 'bold' }}>Back</Text>
              </TouchableOpacity>
            )}

            {state.loading && (
               <ActivityIndicator style={{ padding: 20 }} size="small" color="#0000ff" />
            )}

              {state.step === 4  && (
                  <View style={{ alignItems: 'center'  }}>
                  <Text style={{ color: 'grey', fontSize: 11}}>getting list of available wifi networks..</Text>
                  </View>
              )}

            {(state.step === 0 || state.step === 1) && (
              <View style={{ padding: 10, flexDirection: 'row' ,  alignItems: 'center', justifyContent: 'center' }} >
              <MaterialIcons name="error-outline" size={20} color={'#cc0000'} />
              <Text style={{ paddingLeft: 3,  color: 'black', fontFamily: 'OpenSans-Regular', fontSize: 15, fontWeight: 'bold' }}>
                Wifi is turned off or location permission is denied.
              </Text>
              </View>
            )}



            {state.networkError && (
              <View style={{ padding: 10, flexDirection: 'row', alignItems: 'center' , justifyContent: 'center' }} >
              <MaterialIcons name="error-outline" size={20} color={'#cc0000'} />
              <Text style={{ paddingLeft: 3,  color: 'black', fontFamily: 'OpenSans-Regular', fontSize: 15, fontWeight: 'bold' }}>{`Please connect to ${deviceSSID} network.`}</Text>
              </View>
            )}

              {state.step === 3 && (
                <View style={{ flex: 1, padding: 20 }}>
                <Text style={{ color: 'black', fontFamily: 'OpenSans-Regular', fontSize: 22, fontWeight: 'bold' }}>Name your device: </Text>
                  <TextInput style={{ padding: 10, borderRadius: 4, borderColor: 'grey', borderWidth: 0.5, width:  width - 40, color: 'black', fontSize: 16 }} maxLength={25} placeholderTextColor={'grey'} placeholder={""} value={state.deviceName} onChangeText={text => setState(prev => ({...prev, deviceName: text }) )   } />
                  <TouchableOpacity disabled={String(state.deviceName).length < 2} onPress={step4} style={{ marginTop: 20, width:  width - 40, height: 40, borderRadius: 4, justifyContent: 'center', alignItems: 'center', backgroundColor: String(state.deviceName).length < 2 ?  '#feeeed' : '#f95951',  }} >
                    <Text style={{ fontSize: 16, color: 'white'}}>Next</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* when we get any error while fetching wifi network or we get empty wifi list */}
              {state.step5error  && (
                <View>
                  <Text>There is no wifi network found. Please check your wifi network.</Text>
                </View>
              )}

              {state.step === 5 && (
                <View style={{ padding: 20, height: 300, backgroundColor: 'yellow' }}>
                <Text style={{ color: 'black', fontFamily: 'OpenSans-Regular', fontSize: 22, fontWeight: 'bold', paddingLeft: 4 }}>Select a network: </Text>
                <FlatList
                  data={state.wifilist}
                  renderItem={renderItem}
                  keyExtractor={item => item.id}
                  style={{  }}
                />



                </View>
              )}


              {/*(state.showwifilist && state.selectedwifi === null && state.connected === false ) && (
                <View style={{ padding: 20 }}>
                <Text style={{ color: 'black', fontFamily: 'OpenSans-Regular', fontSize: 22, fontWeight: 'bold', paddingLeft: 4 }}>Select a network: </Text>
                <FlatList
                  data={state.wifilist}
                  renderItem={renderItem}
                  keyExtractor={item => item.id}
                />
                </View>
              )*/}

              {state.step === 6 && (
                <View style={{ flex: 1, padding: 20}}>
                  <Text style={{ color: 'black', fontFamily: 'OpenSans-Regular', fontSize: 22, fontWeight: 'bold', paddingLeft: 4 }}>Password of {state.selectedwifi} to connect: </Text>

                  <TextInput style={{ padding: 10, borderRadius: 4, borderColor: 'grey', borderWidth: 0.5, width:  width - 40, color: 'black', fontSize: 16 }} maxLength={25} placeholderTextColor={'grey'} value={state.selectedwifipassword} onChangeText={text => setState(prev => ({...prev, selectedwifipassword: text }) )   } />
                  <TouchableOpacity disabled={String(state.selectedwifipassword).length < 3} onPress={setNework} style={{ marginTop: 20, width:  width - 40, height: 40, borderRadius: 4, justifyContent: 'center', alignItems: 'center', backgroundColor: String(state.selectedwifipassword).length < 3 ?  '#feeeed' : '#f95951',  }} >
                    <Text style={{ fontSize: 16, color: 'white'}}>Connect</Text>
                  </TouchableOpacity>

                </View>
              )}


              {state.connected === true && (
                <>
                <Text style={{ color: 'black'}}>You are connected !</Text>
                </>
              )}




        </SafeAreaView>
    )
}
export default App;
