import {coreReducer} from './coreReducer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {createStore,  combineReducers, compose} from 'redux'

import { persistReducer, persistStore } from 'redux-persist'
import hardSet from 'redux-persist/lib/stateReconciler/hardSet'


const reducers = combineReducers({
    coreReducer: coreReducer,
})

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  stateReconciler: hardSet
}
const persistedReducer = persistReducer(persistConfig, reducers);


var composeEnhancers = compose;
if (__DEV__) {
  composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
}

export const store = createStore(persistedReducer, composeEnhancers())
export const persistor = persistStore(store)


