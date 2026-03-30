import axios from 'axios';
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// const DEFAULT_DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const DEFAULT_DEV_HOST = 'localhost'; // adb reverse handles real device tunneling

const normalizeBaseUrl = (url) => {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return /\/api\/?$/i.test(trimmed) ? trimmed.replace(/\/$/, '') : `${trimmed.replace(/\/$/, '')}/api`;
};


const getDevHostFromMetro = () => {
  const scriptURL = NativeModules?.SourceCode?.scriptURL;
  if (!scriptURL) return null;

  try {
    const parsed = new URL(scriptURL);
    const host = parsed.hostname;
    if (!host) return null;
    // No special-casing for Android here — adb reverse makes localhost work
    return host;
  } catch {
    return null;
  }
};

const getBaseUrl = () => {
  const envBaseUrl = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (envBaseUrl) return envBaseUrl;

  const host = getDevHostFromMetro() || DEFAULT_DEV_HOST;
  return `http://${host}:8080/api`;
};

const BASE_URL = getBaseUrl();

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
      console.log('[API Error] No response received:', error.message, 'BaseURL:', BASE_URL);
    } else {
      console.log('[API Error]', error.message);
    }
    return Promise.reject(error);
  }
);

export default api;
