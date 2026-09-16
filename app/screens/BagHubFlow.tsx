// screens/BagHubFlow.tsx
import React from 'react';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import BagHub from './BagHub';

const Stack = createStackNavigator();

export default function BagHubFlow() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        // enter from LEFT, and pop by swiping LEFT (horizontal-inverted)
        gestureDirection: 'horizontal-inverted',
        cardStyleInterpolator: CardStyleInterpolators.forHorizontalIOS,
        // avoid white flash during transition (your screens use black bg)
        cardStyle: { backgroundColor: '#000' },
        detachPreviousScreen: false,
      }}
    >
      <Stack.Screen name="BagHubInner" component={BagHub} />
    </Stack.Navigator>
  );
}