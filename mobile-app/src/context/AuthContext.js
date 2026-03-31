import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api/client';
import { registerForPushNotificationsAsync } from '../services/NotificationService';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [userToken, setUserToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const login = async (username, password) => {
    try {
        const response = await api.post('/auth/signin', { username, password });
        const { accessToken, ...user } = response.data;
        
        // IMPORTANT: Set auth header FIRST, before state updates.
        // setUserToken() triggers re-render → Dashboard mounts → fetchData()
        // so the header must already be on the axios instance before that happens.
        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

        // Persist to storage (non-blocking relative to header)
        AsyncStorage.setItem('userToken', accessToken).catch(() => {});
        AsyncStorage.setItem('userInfo', JSON.stringify(user)).catch(() => {});

        // Now trigger the re-render (Dashboard will have the header ready)
        setUserToken(accessToken);
        setUserInfo(user);

        // Register push token with backend (non-blocking)
        registerForPushNotificationsAsync(user.id).catch(e =>
          console.log('[Auth] Push token registration skipped:', e.message)
        );
    } catch (e) {
        console.log(e);
        throw e;
    }
  };

  const logout = async () => {
    setUserToken(null);
    setUserInfo(null);
    await AsyncStorage.removeItem('userToken');
    await AsyncStorage.removeItem('userInfo');
    delete api.defaults.headers.common['Authorization'];
  };

  const checkTokenValidity = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const userInfoStr = await AsyncStorage.getItem('userInfo');
      
      if (token && userInfoStr) {
        // Set header temporarily to check validity
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        
        try {
          // Try to refresh token (also validates it)
          const refreshRes = await api.post('/auth/refresh');
          const newToken = refreshRes.data.accessToken || refreshRes.data.token;
          const refreshedUser = {
            id: refreshRes.data.id,
            username: refreshRes.data.username,
            email: refreshRes.data.email,
            fullName: refreshRes.data.fullName,
            phoneNumber: refreshRes.data.phoneNumber,
            roles: refreshRes.data.roles
          };
          
          // Store refreshed token
          api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
          await AsyncStorage.setItem('userToken', newToken);
          await AsyncStorage.setItem('userInfo', JSON.stringify(refreshedUser));
          
          setUserToken(newToken);
          setUserInfo(refreshedUser);
          console.log('[Auth] Token refreshed successfully');

          // Re-register push token (non-blocking)
          registerForPushNotificationsAsync(refreshedUser.id).catch(e =>
            console.log('[Auth] Push token re-registration skipped:', e.message)
          );
        } catch (refreshError) {
          // Refresh failed — try just validating old token
          try {
            await api.get('/auth/validate');
            setUserToken(token);
            const parsedUser = JSON.parse(userInfoStr);
            setUserInfo(parsedUser);
            console.log('[Auth] Using existing token (refresh failed)');

            registerForPushNotificationsAsync(parsedUser.id).catch(e =>
              console.log('[Auth] Push token re-registration skipped:', e.message)
            );
          } catch (validationError) {
            // Only logout if it's a real auth error (401/403), NOT network errors
            const status = validationError.response?.status;
            if (status === 401 || status === 403) {
              console.log('Token invalid (', status, '), clearing session');
              await logout();
            } else {
              // Network error or server down — keep user logged in with cached data
              console.log('[Auth] Server unreachable, using cached session:', validationError.message);
              const parsedUser = JSON.parse(userInfoStr);
              setUserToken(token);
              setUserInfo(parsedUser);
            }
          }
        }
      }
    } catch (e) {
      console.log(`Token check error: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkTokenValidity();
  }, []);

  return (
    <AuthContext.Provider value={{ login, logout, isLoading, userToken, userInfo }}>
      {children}
    </AuthContext.Provider>
  );
};
