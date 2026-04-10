/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import { displayLocalNotification } from './src/services/cometchatPushNotifications';

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await displayLocalNotification(remoteMessage);
});

AppRegistry.registerComponent(appName, () => App);
