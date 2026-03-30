import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts, radii, spacing, shadows } from '../theme';

/**
 * Toast notification system.
 *
 * Usage:
 *   import { ToastProvider, useToast } from '../components/Toast';
 *
 *   // Wrap your app:
 *   <ToastProvider><App /></ToastProvider>
 *
 *   // In any component:
 *   const toast = useToast();
 *   toast.success('Medicine added!');
 *   toast.error('Failed to save.');
 *   toast.info('Syncing data...');
 *   toast.warning('Low stock!');
 */

const ToastContext = React.createContext(null);

const TOAST_CONFIG = {
  success: { icon: 'check-circle', bg: colors.success, bgLight: colors.successLight },
  error: { icon: 'alert-circle', bg: colors.danger, bgLight: colors.dangerLight },
  warning: { icon: 'alert', bg: colors.warning, bgLight: colors.warningLight },
  info: { icon: 'information', bg: colors.primary, bgLight: colors.primaryBg },
};

const DURATION = 3000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const show = useCallback((type, message, duration = DURATION) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, type, message, duration }]);
    return id;
  }, []);

  const hide = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (msg, dur) => show('success', msg, dur),
    error: (msg, dur) => show('error', msg, dur),
    warning: (msg, dur) => show('warning', msg, dur),
    info: (msg, dur) => show('info', msg, dur),
    hide,
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <View style={styles.container} pointerEvents="box-none">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => hide(t.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    // Fallback if ToastProvider is not wrapped
    return {
      success: (msg) => console.log('[Toast] Success:', msg),
      error: (msg) => console.log('[Toast] Error:', msg),
      warning: (msg) => console.log('[Toast] Warning:', msg),
      info: (msg) => console.log('[Toast] Info:', msg),
      hide: () => {},
    };
  }
  return context;
}

function ToastItem({ toast, onDismiss }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    // Slide in
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();

    // Auto-dismiss
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -20, duration: 200, useNativeDriver: true }),
      ]).start(() => onDismiss());
    }, toast.duration || DURATION);

    return () => clearTimeout(timer);
  }, []);

  const config = TOAST_CONFIG[toast.type] || TOAST_CONFIG.info;

  return (
    <Animated.View style={[styles.toast, { opacity, transform: [{ translateY }] }]}>
      <View style={[styles.toastInner, { backgroundColor: config.bg }]}>
        <MaterialCommunityIcons name={config.icon} size={20} color="#fff" />
        <Text style={styles.toastText} numberOfLines={2}>{toast.message}</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialCommunityIcons name="close" size={16} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
  },
  toast: {
    width: '100%',
    marginBottom: spacing.sm,
  },
  toastInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    gap: spacing.sm,
    ...shadows.lg,
  },
  toastText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontFamily: fonts.medium,
    lineHeight: 20,
  },
});
