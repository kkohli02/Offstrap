import React, {useState, useEffect, useRef} from 'react';
import { SafeAreaView, FlatList, ScrollView, StyleSheet, View, Text ,Dimensions,Switch, ActivityIndicator, TextInput, TouchableOpacity, Alert} from 'react-native';
//import { Switch } from 'react-native-switch';

import { REACT_APP_API_URL, REACT_APP_MAX_POTENCY } from './config'
import axios from 'axios'

import firestore from '@react-native-firebase/firestore';

//import Slider from '@react-native-community/slider';
import { Slider } from '@sharcoux/slider'

import Toast from 'react-native-toast-message'
import net from 'react-native-tcp-socket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AntDesign from 'react-native-vector-icons/AntDesign'

const {width, height, scale} = Dimensions.get("window");
let client = null
const App = ({ route, navigation }) => {

  let { ip, deviceSlug } = route.params
  console.log('ip',ip,'deviceSlug',deviceSlug)

  //if(__DEV__) ip = '192.168.0.107'

  const step = 5 //steps of a slider
  let retrymax = 3
  let retryattempt = 1
  const reconnectionTime = 1000 // in miliseconds 3 seconds
  let timer = null
  let timerTimeExecution = 4000
  const [state, setState] = useState({ r: 0, g: 0, b: 0, w: 0, trigger: false, predefinedKey: null, predefinedval: null,
    loading : true,
    isConnecting: true,
    isConnected: false,
    error: false, // when error found to conenct
    closedConnection: false,
    reconnecting: false
    })
  //const [doreconnect, set_doreconnect] = useState(true)
  const doreconnect = useRef(true)






   useEffect(() => {
     console.log('do you ever hit here ???')
      reload()

      // get it online
        const predefinedval = [ ]
        firestore().collection('rgbpredefined').get()
        .then(snapShot => {
            snapShot.docs.map(doc => {
                predefinedval.push({  id: doc.id, ...doc.data() })
            })
            //console.log('all predefinedval', predefinedval)
            setState(prev => ({...prev, predefinedval  }))
        })
        .catch(error => {

        })

      return () => {
        console.log("Here, you can add clean up code - componentWillUnmount")
        if(client !== null){
          console.log('will destroy when we goff')
          //set_doreconnect(false)
          doreconnect.current = false
          client.destroy(er=> {
            console.log('er while detroying',er)
          })
        }
      };
    }, []);

    useEffect(() => {
      if(state.trigger){
        if(__DEV__) console.log('why do you hit ')
        setValues()
      }
    }, [state]);

  const reload = () => {
    if (__DEV__) console.log('triggering with ip',ip)
    //setState(prev => ({...prev, r: response.data.r , g: response.data.g , b: response.data.b, w: response.data.w , loading: false }))

    //client = net.connect(80, ip, ()=> {
    client = net.createConnection({ host: ip, port: 80 }, ()=> {
        if (__DEV__)  console.log('opened client on ' + JSON.stringify(client.address()));
        setState(prev => ({...prev, loading: false, isConnecting: false , isConnected: true, error: false, closedConnection: false, reconnecting: false }))
        client.write(JSON.stringify({ hash: 'rgb1', req: 'colget' }))
    });

    client.setKeepAlive(true)

    client.on('error', function(error) {
      if (__DEV__)  console.log('error handing is here',error)
      setState(prev => ({...prev, loading: false, isConnecting: false , isConnected: false, error: true, closedConnection: true }))
    });



    client.on('close', function(){
      if (__DEV__) console.log('Connection closed!');
      //setState(prev => ({...prev, loading: false }))
      setState(prev => ({...prev, loading: false, isConnecting: false , isConnected: false, error: true, closedConnection: true }))
      if(doreconnect.current){
        reconnecting()
      }
    });

    client.on('data', function(data) {
      return
      //we do not need to ..
      if (__DEV__)  console.log('message was received', typeof(data), data)
      if(data !== null && data !== ''){
        if (__DEV__) console.log('we got data so we clear the time')
        clearTimeout(timer)
        data = data.toString()
        if(__DEV__) console.log('data2',data)
        if(data == 'ok' || data == 'Unsupported_Action'){
          return
        }
        if(__DEV__) console.log(typeof(data))

        try {
          data = JSON.parse(data);
        } catch (e) {
            return false;
        }
        if(typeof(data) !== 'object'){
          return
        }
        //data = JSON.parse(data)
        if(__DEV__) console.log('data',data)
        if (typeof data.status !== 'undefined'){
          if(__DEV__) console.log('I wont let you pollute my code')
          return;
        }
        setState(prev => ({...prev, loading: false, r: parseInt(data.r/10) , g: parseInt(data.g/10) , b: parseInt(data.b/10), w: parseInt(data.w/10)  }))
      }
    });
  }

  const reconnecting = () => {
    //if (__DEV__) console.log('trying to reconnect in 3 seconds')

    setState(prev => ({...prev, reconnecting: true }))


    if(retryattempt >= retrymax){
      //if (__DEV__) console.log('max limit exhausted')
      setState(prev => ({...prev, reconnecting: false }))
      Toast.show({ text1: 'max attempt done to connect. Please try later.' })
      return
    }
    retryattempt++
      setTimeout(()=> {
        reload()
      },reconnectionTime)
  }

  const setValues = () => {
    if (__DEV__) console.log('now we will post updates')
    //Toast.show({ text1: 'Updating values..' })
    if (__DEV__) console.log('client status',client,state.closedConnection)
    if(state.closedConnection === false){
    clearTimeout(timer)
    timer = setTimeout(() => {
      console.log('I think there is no connetion')
    }, timerTimeExecution)
    client.write(JSON.stringify({ r: state.r, g: state.g, b: state.b, w: state.w, hash: 'rgb1', req: 'colset', trigger: false }))
    }
  }

  const setValuesX = (rgb,value) => {
    if (__DEV__) console.log('now we will post updates power2')
    //Toast.show({ text1: 'Updating values..' })
    if (__DEV__) console.log('client status',client,state.closedConnection)
    if(state.closedConnection === false){
    clearTimeout(timer)
    timer = setTimeout(() => {
      console.log('I think there is no connetion')
    }, timerTimeExecution)
    client.write(JSON.stringify({ [rgb]: parseInt(value)*10, hash: 'rgb1', req: 'colset' }))
    }
  }

  const deleteDevice = () => {
      Alert.alert(
       "Confirm",
       "Are you sure want to remove this device ?",
       [
         {
           text: "Cancel",
           onPress: () => console.log("Cancel Pressed"),
           style: "cancel"
         },
         { text: "Yes", onPress: () => confirmDelete()}
       ]
     );
  }

  const confirmDelete = async () => {
    try {
      var connectedDevices = await AsyncStorage.getItem('@rgbdevices')
      if (__DEV__) console.log('connectedDevices DeviceControl',connectedDevices, typeof (connectedDevices))
      if(typeof connectedDevices === 'string'){
        connectedDevices = JSON.parse(connectedDevices)
      }
      delete(connectedDevices[ip])
      if (__DEV__) console.log('after delete',connectedDevices)
      await AsyncStorage.setItem('@rgbdevices', JSON.stringify(connectedDevices))
      if (__DEV__) console.log('its done successfully hwoever..')
      // navigation.reset({
      //    index: 0,
      //    routes: [{ name: 'DashboardStack' }],
      //  });
      route.params.reload()
      setTimeout(()=> {
        navigation.goBack()
      },1000)

    } catch (error) {
      if (__DEV__) console.log('error',error)
    }
  }

  const boxColor = () => {
    if (__DEV__) console.log('yoda',parseInt(state.w/392))
    return (
      <View style={{ alignItems: 'flex-end'}}>
      <View style={{ marginTop: 30, borderRadius: 4, backgroundColor: 'white', height: 40, width: 40 }}>
          <View style={{ borderRadius: 4, backgroundColor: `rgba(${parseInt(state.r/3.92)},${parseInt(state.g/3.92)},${parseInt(state.b)/3.92},${parseFloat(state.w/392).toFixed(2)})`, height: 40 }}  />
      </View>
      </View>
    )
  }

  const sliderBox = () => {
    return (
      <View style={{backgroundColor:'#ececec', borderRadius:20,padding:19, elevation: 4, marginTop: 3}}>
        <Slider
        style={{width: width-70, height: 40}}
        trackHeight={8}
        thumbSize={30}
        minimumValue={0}
        maximumValue={REACT_APP_MAX_POTENCY}
        value={state.r}
        step={step}
        onValueChange={position => {
          console.log('position',position)
          setState(prev => ({...prev, r: position, predefinedKey: null }));
          setValuesX('r',position)
        }}
        minimumTrackTintColor="red"
        maximumTrackTintColor="#a6a6a6"
        thumbTintColor="white"
      />
      <Text style={{ marginBottom: 10}}>Red: {state.r}%</Text>


      <Slider
        style={{width: width-70, height: 40}}
        trackHeight={8}
        thumbSize={30}
        minimumValue={0}
        maximumValue={REACT_APP_MAX_POTENCY}
        value={state.g}
        step={step}
        onValueChange={position => {
          console.log('position',position)
          setState(prev => ({...prev, g: position, predefinedKey: null }));
          setValuesX('g',position)
        }}
        minimumTrackTintColor="green"
        maximumTrackTintColor="#a6a6a6"
        thumbTintColor="white"
      />
      <Text style={{ marginBottom: 10}}>Green: {state.g}%</Text>


      <Slider
        style={{width: width-70, height: 50}}
        trackHeight={8}
        thumbSize={30}
        minimumValue={0}
        maximumValue={REACT_APP_MAX_POTENCY}
        value={state.b}
        step={step}
        onValueChange={position => {
          setState(prev => ({...prev, b: position,  predefinedKey: null }));
          setValuesX('b',position)
        }}
        minimumTrackTintColor="blue"
        maximumTrackTintColor="#a6a6a6"
        thumbTintColor="white"
      />
      <Text style={{ marginBottom: 10}}>Blue: {state.b}%</Text>

      <Slider
        style={{width: width-70, height: 50}}
        minimumValue={0}
        trackHeight={8}
        thumbSize={30}
        maximumValue={REACT_APP_MAX_POTENCY}
        value={state.w}
        step={step}
        onValueChange={position => {
          setState(prev => ({...prev, w: position, predefinedKey: null }));
          setValuesX('w',position)
        }}
        minimumTrackTintColor="white"
        maximumTrackTintColor="#a6a6a6"
        thumbTintColor="white"
      />
      <Text style={{ marginBottom: 10}}>White: {state.w}%</Text>

  </View>
    )
  }

  const predefinedBox = () => {
    return (
      <>
      <Text style={{ marginTop: 20 , marginBottom: 4,  color: 'black', fontSize: 22, fontWeight: 'bold' }}>Predefined Color Sets</Text>
      <FlatList
        horizontal
        data={state.predefinedval}
        renderItem={renderItemPredefined}
        keyExtractor={item => item.id}
      />
      </>
    )
  }

  const renderItemPredefined = ({ index, item }) => {
    if (__DEV__) console.log('item>',item)
    return (
      <TouchableOpacity key={item.id} onPress={ ()=>setState(prev => ({...prev, r: item.r, g: item.g, b: item.b, w: item.w, trigger: true, predefinedKey: item.id })) } style={{ marginLeft: index === 0 ? 0: 20, borderWidth: 1, borderColor: state.predefinedKey === item.id ? 'grey' : 'white', alignItems: 'center',  paddingTop: 4, backgroundColor: 'white', width: 70, height: 90, justifyContent: 'flex-start', borderRadius: 3 }}>
          <View style={{ width: 50, height: 50, backgroundColor: `rgba(${parseInt(item.r/3.92)},${parseInt(item.g/3.92)},${parseInt(item.b)/3.92},${parseFloat(item.w/392).toFixed(2)})`, borderRadius: 3 }} />
          <Text style={{ marginTop: 2, fontSize: 10, color: 'grey', flexWrap: 'wrap', textTransform: 'capitalize'}}>{item.label}</Text>
      </TouchableOpacity>
    )

  }

  return (
    <SafeAreaView style={{ flex: 1, paddingHorizontal:15, paddingTop:20, flex:1, backgroundColor:'white'}}>

    {state.loading && (
       <ActivityIndicator size="small" color="#0000ff" />
    )}

    <View style={{ flexDirection: 'row', alignItems: 'center' }}>

        <View style={{ flex: 4 }}>
        <Text style={{ paddingLeft: 10, color: 'black', fontFamily: 'OpenSans-Regular', fontSize: 24, fontWeight: 'bold' }}>{deviceSlug}</Text>
        </View>

        <View style={{ flex: 1 }}>
            <TouchableOpacity onPress={deleteDevice} style={{ justifyContent: 'center', alignItems: 'center', borderRadius: 14, width: 60, height: 30, backgroundColor: '#C20950' }}>
              <Text style={{ fontSize: 11, color: 'white' }}>Delete</Text>
            </TouchableOpacity>
        </View>
      </View>


      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6,  }}>
        {state.isConnected && (
          <AntDesign name={"checkcircleo"}  size={14} color={'green'} />
        )}
        <Text style={{fontSize:16, paddingLeft: 5, color:'black', fontWeight: 'bold'}}>{state.isConnected ? 'Connected' : state.isConnecting ? 'Connecting..' : 'Disconnected'}</Text>
      </View>




          {state.isConnected && (
            <>
            {boxColor()}
            {sliderBox()}
            {predefinedBox()}
            </>
          )}



          {/*(state.closedConnection && doreconnect) && (
              <View style={{ alignItems: 'center', marginTop: 20 }}>
                <TouchableOpacity onPress={()=>reconnecting()} style={{ justifyContent: 'center', alignItems: 'center', borderRadius: 6, width: 120, height: 45, backgroundColor: '#C20950' }}>
                    <Text style={{ color: 'white'}}>Reconnect</Text>
                </TouchableOpacity>
              </View>
          )*/}

          {(state.reconnecting) && (
              <View style={{ alignItems: 'center', marginTop: 20 }}>
                <View style={{ justifyContent: 'center', alignItems: 'center', borderRadius: 6, width: 120, height: 45, backgroundColor: '#C20950' }}>
                    <Text style={{ color: 'white'}}>Reconnecting connection..</Text>
                </View>
              </View>
          )}


    </SafeAreaView>
  );
};

export default App;
