import React, { useContext, useEffect, useCallback, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthContext, AuthProvider } from './src/context/AuthContext';
import { View, ActivityIndicator, Text, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import offlineSyncService from './src/services/OfflineSyncService';
import { setupNotificationActions, addNotificationActionListener } from './src/services/NotificationService';
import BiometricGate from './src/components/BiometricGate';
import { colors, fonts, tabBar, radii, shadows } from './src/theme';
import { ToastProvider } from './src/components/Toast';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';

import DashboardScreen from './src/screens/DashboardScreen';
import AddMedicineScreen from './src/screens/AddMedicineScreen';
import GroupScreen from './src/screens/GroupScreen';
import AddGroupScreen from './src/screens/AddGroupScreen';
import GroupChatScreen from './src/screens/GroupChatScreen';
import GroupDetailsScreen from './src/screens/GroupDetailsScreen';
import MemberActivityScreen from './src/screens/MemberActivityScreen';
import SharedSchedulesScreen from './src/screens/SharedSchedulesScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ScanPrescriptionScreen from './src/screens/ScanPrescriptionScreen';
import MedicineDetailScreen from './src/screens/MedicineDetailScreen';
import EditScheduleScreen from './src/screens/EditScheduleScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ReportScreen from './src/screens/ReportScreen';
import AccountScreen from './src/screens/AccountScreen';
import OnboardingScreen, { hasCompletedOnboarding } from './src/screens/OnboardingScreen';

// Keep splash screen visible while fonts load
SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// ─── Default header styling using theme ──────────────────────────
const defaultScreenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { fontFamily: fonts.semiBold, fontSize: 17 },
  headerShadowVisible: false,
  headerBackTitleVisible: false,
};

// ─── Tab icon config ─────────────────────────────────────────────
const TAB_ICONS = {
  Home: { default: 'home-variant-outline', focused: 'home-variant' },
  Medicines: { default: 'pill', focused: 'pill' },
  Scan: { default: 'line-scan', focused: 'line-scan' },
  Groups: { default: 'account-group-outline', focused: 'account-group' },
  Settings: { default: 'cog-outline', focused: 'cog' },
};

// ─── Home Stack ──────────────────────────────────────────────────
const HomeStack = () => (
  <Stack.Navigator screenOptions={defaultScreenOptions}>
    <Stack.Screen name="DashboardMain" component={DashboardScreen} options={{ title: 'MedScan', headerShown: false }} />
    <Stack.Screen name="AddMedicine" component={AddMedicineScreen} options={{ title: 'Add Medicine' }} />
    <Stack.Screen name="ScanPrescription" component={ScanPrescriptionScreen} options={{ title: 'Scan Prescription' }} />
    <Stack.Screen name="MedicineDetail" component={MedicineDetailScreen} options={({ route }) => ({ title: route.params?.schedule?.medicine?.name || 'Medicine' })} />
    <Stack.Screen name="EditSchedule" component={EditScheduleScreen} options={({ route }) => ({ title: `Edit: ${route.params?.schedule?.medicine?.name || 'Schedule'}` })} />
  </Stack.Navigator>
);

// ─── Medicines Stack (All schedules + Add) ───────────────────────
const MedicinesStack = () => (
  <Stack.Navigator screenOptions={defaultScreenOptions}>
    <Stack.Screen name="HistoryMain" component={HistoryScreen} options={{ title: 'Medicines', headerShown: false }} />
    <Stack.Screen name="AddMedicine" component={AddMedicineScreen} options={{ title: 'Add Medicine' }} />
    <Stack.Screen name="MedicineDetail" component={MedicineDetailScreen} options={({ route }) => ({ title: route.params?.schedule?.medicine?.name || 'Medicine' })} />
    <Stack.Screen name="EditSchedule" component={EditScheduleScreen} options={({ route }) => ({ title: `Edit: ${route.params?.schedule?.medicine?.name || 'Schedule'}` })} />
  </Stack.Navigator>
);

// ─── Scan Stack ──────────────────────────────────────────────────
const ScanStack = () => (
  <Stack.Navigator screenOptions={defaultScreenOptions}>
    <Stack.Screen name="ScanMain" component={ScanPrescriptionScreen} options={{ title: 'Scan', headerShown: false }} />
    <Stack.Screen name="AddMedicine" component={AddMedicineScreen} options={{ title: 'Add Medicine' }} />
  </Stack.Navigator>
);

// ─── Groups Stack ────────────────────────────────────────────────
const GroupsStack = () => (
  <Stack.Navigator screenOptions={defaultScreenOptions}>
    <Stack.Screen name="GroupsMain" component={GroupScreen} options={{ title: 'Groups', headerShown: false }} />
    <Stack.Screen name="AddGroup" component={AddGroupScreen} options={{ title: 'Create Group' }} />
    <Stack.Screen name="GroupChat" component={GroupChatScreen} options={{ title: '' }} />
    <Stack.Screen name="GroupDetails" component={GroupDetailsScreen} options={({ route }) => ({ title: route.params?.group?.groupName || route.params?.group?.name || 'Group Info' })} />
    <Stack.Screen name="MemberActivity" component={MemberActivityScreen} options={({ route }) => ({ title: route.params?.member?.fullName || route.params?.member?.username || 'Member' })} />
    <Stack.Screen name="SharedSchedules" component={SharedSchedulesScreen} options={{ title: 'Shared Schedules' }} />
    <Stack.Screen name="AddMedicineForMember" component={AddMedicineScreen} options={({ route }) => ({ title: `Add Medicine for ${route.params?.targetUserName || 'Member'}` })} />
  </Stack.Navigator>
);

// ─── Settings Stack ──────────────────────────────────────────────
const SettingsStack = () => (
  <Stack.Navigator screenOptions={defaultScreenOptions}>
    <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: 'Settings', headerShown: false }} />
    <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
    <Stack.Screen name="Report" component={ReportScreen} options={{ title: 'Adherence Report' }} />
  </Stack.Navigator>
);

// ─── Main Tab Navigator ─────────────────────────────────────────
const MainTabs = () => (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      headerShown: false,
      tabBarIcon: ({ focused }) => {
        const iconSet = TAB_ICONS[route.name] || { default: 'circle', focused: 'circle' };
        const iconName = focused ? iconSet.focused : iconSet.default;

        // Center scan button gets special treatment
        if (route.name === 'Scan') {
          return (
            <View style={tabStyles.scanButton}>
              <MaterialCommunityIcons name={iconName} size={26} color={colors.textInverse} />
            </View>
          );
        }

        return (
          <View style={tabStyles.tabItem}>
            <MaterialCommunityIcons
              name={iconName}
              size={tabBar.iconSize}
              color={focused ? colors.primary : colors.textTertiary}
            />
            {focused && <View style={tabStyles.activeDot} />}
          </View>
        );
      },
      tabBarShowLabel: false,
      tabBarStyle: tabStyles.tabBar,
    })}
  >
    <Tab.Screen name="Home" component={HomeStack} />
    <Tab.Screen name="Medicines" component={MedicinesStack} />
    <Tab.Screen name="Scan" component={ScanStack} />
    <Tab.Screen name="Groups" component={GroupsStack} />
    <Tab.Screen name="Settings" component={SettingsStack} />
  </Tab.Navigator>
);

// ─── Tab Bar Styles ──────────────────────────────────────────────
const tabStyles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    bottom: tabBar.bottomInset,
    left: tabBar.horizontalInset,
    right: tabBar.horizontalInset,
    height: tabBar.height,
    borderRadius: tabBar.borderRadius,
    backgroundColor: colors.surface,
    borderTopWidth: 0,
    paddingBottom: 0,
    ...shadows.lg,
    ...Platform.select({
      android: { elevation: 12 },
    }),
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  activeDot: {
    width: tabBar.activeDotSize,
    height: tabBar.activeDotSize,
    borderRadius: tabBar.activeDotSize / 2,
    backgroundColor: colors.primary,
    marginTop: 2,
  },
  scanButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    ...shadows.colored(colors.primary),
    ...Platform.select({
      android: { elevation: 8 },
      ios: {
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
    }),
  },
});

// ─── AppNav ──────────────────────────────────────────────────────
const AppNav = () => {
  const { isLoading, userToken } = useContext(AuthContext);
  const [showOnboarding, setShowOnboarding] = useState(null); // null = loading, true/false

  useEffect(() => {
    hasCompletedOnboarding().then(completed => setShowOnboarding(!completed));
  }, []);

  if (isLoading || showOnboarding === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Show onboarding on first launch
  if (showOnboarding && !userToken) {
    return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {userToken !== null ? (
          <Stack.Screen name="Main">
            {() => (
              <BiometricGate>
                <MainTabs />
              </BiometricGate>
            )}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

// ─── Root App ────────────────────────────────────────────────────
export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    offlineSyncService.init();
    setupNotificationActions();
    const notificationSub = addNotificationActionListener();

    return () => {
      offlineSyncService.destroy();
      notificationSub.remove();
    };
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null; // Splash screen stays visible
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
        <StatusBar style="dark" />
        <AuthProvider>
          <ToastProvider>
            <AppNav />
          </ToastProvider>
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}
