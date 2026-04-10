import Config from 'react-native-config';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_URL = (Config.API_URL || 'http://192.168.0.101:5000').replace(/\/+$/, '');

export async function attachAuthToken(request) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    if (token) {
      request.headers.Authorization = `Bearer ${token}`;
    }
  } catch (error) {
    if (__DEV__) {
      console.error('Error fetching token for request', error);
    }
  }
  return request;
}
