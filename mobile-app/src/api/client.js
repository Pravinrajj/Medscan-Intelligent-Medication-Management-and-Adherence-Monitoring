import axios from 'axios';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 10.0.2.2 maps to host machine's localhost on Android emulator
const BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8080/api' : 'http://localhost:8080/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      console.log('[API Error]', error.response.status, error.response.data);
    } else if (error.request) {
      console.log('[API Error] No response received:', error.message);
    } else {
      console.log('[API Error]', error.message);
    }
    return Promise.reject(error);
  }
);

export default api;
