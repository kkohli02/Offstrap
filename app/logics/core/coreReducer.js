export const ADD_DEVICE = 'add_devices'
export const REMOVE_DEVICE = 'remove_device'
export const SET_LOGGEDIN = 'set_loggedIn'
export const SET_LOGGEDOUT = 'set_loggedOut'
export const SKIP_REGISTER = 'skip_register'
export const RESET_ALL = 'reset_all'
 
import _ from 'lodash'

const initialState = {
  loggedin: false,
  userID: null,
  alldevices: [],
  skipLogin: false,
  landScreen: 0, //1, 2, 3 ,
  darkMode: false 

};

export const coreReducer = (state = initialState, action) => {
    switch(action.type){
      case SET_LOGGEDIN:
        return {...state, loggedin: true, userID: action.payload };
      
      case SET_LOGGEDOUT:
        return {...state, loggedin: false, userID: null };

      case ADD_DEVICE:
        console.log('state.alldevices',[...state.alldevices, action.payload])
        return {...state,  alldevices: [...state.alldevices, action.payload] }; 

      case REMOVE_DEVICE:
        return {...state, alldevices: _.filter(state.alldevices,each => each.ip !== action.payload.ip ) }; 

      case SKIP_REGISTER:
        return {...state, skipLogin: action.payload };

      case RESET_ALL:
        return {...initialState }  
      
      default:
        return state;
      }
}  


export const get_loginStatus = (state) => state.coreReducer.loggedin;
export const get_userID = (state) => state.coreReducer.userID;
export const get_rgbdevices = (state) =>  _.filter(state.coreReducer.alldevices, each => each.type === '@rgbdevices')
export const get_biodevices = (state) => _.filter(state.coreReducer.alldevices, each => each.type === '@biodevices')
export const get_timerdevices = (state) => _.filter(state.coreReducer.alldevices, each => each.type === '@timerdevices')
