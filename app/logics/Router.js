// In Router.js in a new project

import React, {useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
//import SplashScreen from 'react-native-splash-screen'
import auth from '@react-native-firebase/auth';

import Register from './Register'
import Login from './Login'
import ForgetPass from './ForgetPass'
import Dashboard from './Dashboard'
import DeviceListPage from './DeviceListPage'
import AddDevice from './AddDevice' //onwifi connection over wiif
import DeviceControl from './DeviceControl'
import DeviceControl_Bio from './DeviceControl_Bio'
import Profile from './Profile'
import AddDeviceBLE from './AddDeviceBLE' //onBLE connection over ble

import DE_Timer from './DE_Timer'
import DE_Timer_Add from './DE_Timer_Add'
import DE_Timer_List from './DE_Timer_List'

import Toast, { BaseToast, ErrorToast } from 'react-native-toast-message';


import { useDispatch, useSelector } from 'react-redux'
import { get_loginStatus, SET_LOGGEDIN, SET_LOGGEDOUT, SKIP_REGISTER, RESET_ALL } from './app/coreReducer'



const Stack = createNativeStackNavigator();

function LoginStack () {
    return (
      <Stack.Navigator>
        <Stack.Screen name="Register" options={{
          animationEnabled: true,
          headerShown: false,
          title: 'Register'
        }}>
         {props => <Register {...props} />}
        </Stack.Screen>

        <Stack.Screen name="Login" options={{
          animationEnabled: true,
          headerShown: true,
          title: 'Login'
        }}>
         {props => <Login {...props} />}
         </Stack.Screen>

         <Stack.Screen name="ForgetPass" options={{
           animationEnabled: true,
           title: 'Forget Password'
         }}>
          {props => <ForgetPass {...props} />}
          </Stack.Screen>
      </Stack.Navigator>
    )
}

function DashboardStack () {
  return (
    <Stack.Navigator>




      <Stack.Screen name="Dashboard" options={{
        animationEnabled: true,
        headerShown: false,
      }}>
       {props => <Dashboard {...props} />}
      </Stack.Screen>

      <Stack.Screen name="DeviceListPage" options={{
        animationEnabled: true,
        headerShown: true,
        title: ""
      }}>
       {props => <DeviceListPage {...props} />}
      </Stack.Screen>

      <Stack.Screen name="AddDevice" options={{
        animationEnabled: true,
        headerShown: false,
      }}>
       {props => <AddDevice {...props} />}
       </Stack.Screen>

       <Stack.Screen name="DeviceControl" options={{
         animationEnabled: true,
         title: 'Device Control'
       }}>
        {props => <DeviceControl {...props} />}
        </Stack.Screen>

        <Stack.Screen name="DeviceControl_Bio" options={{
          animationEnabled: true,
          title: 'Device Control'
        }}>
         {props => <DeviceControl_Bio {...props} />}
         </Stack.Screen>

        <Stack.Screen name="Profile" options={{
          animationEnabled: true,
          title: 'Profile'
        }}>
         {props => <Profile {...props} />}
         </Stack.Screen>

         <Stack.Screen name="AddDeviceBLE" options={{
           animationEnabled: true,
           title: 'Add Device'
         }}>
          {props => <AddDeviceBLE {...props} />}
          </Stack.Screen>



           <Stack.Screen name="DE_Timer" options={{
             animationEnabled: true,
             title: 'Select A Channel'
           }}>
            {props => <DE_Timer {...props} />}
            </Stack.Screen>

            <Stack.Screen name="DE_Timer_List" options={{
              animationEnabled: true,
              title: 'Timer Schedules'
            }}>
             {props => <DE_Timer_List {...props} />}
             </Stack.Screen>

             <Stack.Screen name="DE_Timer_Add" options={{
               animationEnabled: true,
               title: 'Add Timer Device'
             }}>
              {props => <DE_Timer_Add {...props} />}
              </Stack.Screen>



    </Stack.Navigator>
  )
}

function Router(){

  const [state, setState] = useState({ isloggedin: false  })
  const dispatch = useDispatch()
  const loginStatus = useSelector(get_loginStatus)
  const skipLogin = useSelector(state => state.coreReducer.skipLogin)

  useEffect(()=> {
    // just to reset
    //dispatch({ type: RESET_ALL  }) 
    console.log('loginStatus',loginStatus)
    //SplashScreen.hide()
    setTimeout(()=> {
      //SplashScreen.hide()
      Toast.show({ type: 'error', text1: 'Welcome '})
    },3000)
    const subscriber = auth().onAuthStateChanged(onAuthStateChanged);
    return subscriber;
  }, [])



  // useEffect(()=> {
  //   if(state.loading){
  //     setloader(true)
  //   }
  // },[state])

  const onAuthStateChanged = async (user) => {
      if(user !== null){
        setState(prev => ({...prev, loading: false}))
        dispatch({ type: SET_LOGGEDIN, payload: user.uid })
      }
      else {
        //set_isloggedin(false)
        setState(prev => ({...prev, loading: false}))
        dispatch({ type: SET_LOGGEDOUT })
      }
  }

  const toastConfig = {
    success: (props) => (
      <BaseToast
        {...props}
        style={{ borderLeftColor: 'pink' }}
        contentContainerStyle={{ paddingHorizontal: 15 }}
        text1Style={{
          fontSize: 15,
          fontWeight: '400',
          color: 'black'
        }}
        text2Style={{
          color: 'black'
        }}
      />
    ),
    /*
      Overwrite 'error' type,
      by modifying the existing `ErrorToast` component
    */
    error: (props) => (
      <ErrorToast
        {...props}
        text1Style={{
          fontSize: 17,
          color: 'red'
        }}
        text2Style={{
          fontSize: 15
        }}
      />
    ),
  };

  return (
      <>
      {state.loading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: 'grey'}}>loading...</Text>
          </View>
        ): (
          <NavigationContainer>
          <Stack.Navigator initialRouteName={loginStatus || skipLogin  ? 'DashboardStack' : 'LoginStack'}>
            <Stack.Screen name="LoginStack" options={{ headerShown : false }} component={LoginStack} />
            <Stack.Screen name="DashboardStack" options={{ headerShown : false }} component={DashboardStack} />
          </Stack.Navigator>
          </NavigationContainer>
        )}
        <Toast config={toastConfig} />
      </>
  );
}

export default Router;
