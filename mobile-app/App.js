import React, { useContext, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthContext, AuthProvider } from './src/context/AuthContext';
import { View, ActivityIndicator, Text } from 'react-native';
import offlineSyncService from './src/services/OfflineSyncService';
import { setupNotificationActions, addNotificationActionListener } from './src/services/NotificationService';
import BiometricGate from './src/components/BiometricGate';

import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';

import DashboardScreen from './src/screens/DashboardScreen';
import AddMedicineScreen from './src/screens/AddMedicineScreen';
import GroupScreen from './src/screens/GroupScreen';
import AddGroupScreen from './src/screens/AddGroupScreen';
import GroupDetailsScreen from './src/screens/GroupDetailsScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ScanPrescriptionScreen from './src/screens/ScanPrescriptionScreen';
import MedicineDetailScreen from './src/screens/MedicineDetailScreen';
import EditScheduleScreen from './src/screens/EditScheduleScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ReportScreen from './src/screens/ReportScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Tab icon helper
const TabIcon = ({ label, focused }) => {
  const icons = { Home: '🏠', History: '📋', Groups: '👥', Profile: '👤' };
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 20 }}>{icons[label] || '•'}</Text>
      <Text style={{ fontSize: 10, fontWeight: focused ? '700' : '500', color: focused ? '#3498db' : '#95a5a6', marginTop: 2 }}>{label}</Text>
    </View>
  );
};

// Home Stack (Dashboard + sub-screens)
const HomeStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="DashboardMain" component={DashboardScreen} options={{ title: 'MedScan', headerShown: false }} />
    <Stack.Screen name="AddMedicine" component={AddMedicineScreen} options={{ title: 'Add Medicine' }} />
    <Stack.Screen name="ScanPrescription" component={ScanPrescriptionScreen} options={{ title: 'Scan Prescription' }} />
    <Stack.Screen name="MedicineDetail" component={MedicineDetailScreen} options={({ route }) => ({ title: route.params?.schedule?.medicine?.name || 'Medicine' })} />
    <Stack.Screen name="EditSchedule" component={EditScheduleScreen} options={({ route }) => ({ title: `Edit: ${route.params?.schedule?.medicine?.name || 'Schedule'}` })} />
  </Stack.Navigator>
);

// Groups Stack
const GroupsStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="GroupsMain" component={GroupScreen} options={{ title: 'Groups', headerShown: false }} />
    <Stack.Screen name="AddGroup" component={AddGroupScreen} options={{ title: 'Create Group' }} />
    <Stack.Screen name="GroupDetails" component={GroupDetailsScreen} options={({ route }) => ({ title: route.params?.group?.groupName || route.params?.group?.name || 'Group' })} />
  </Stack.Navigator>
);

// Profile Stack
const ProfileStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: 'Profile', headerShown: false }} />
    <Stack.Screen name="Report" component={ReportScreen} options={{ title: 'Adherence Report' }} />
  </Stack.Navigator>
);

const MainTabs = () => (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      headerShown: false,
      tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
      tabBarShowLabel: false,
      tabBarStyle: {
        height: 65,
        paddingBottom: 8,
        paddingTop: 8,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        position: 'absolute',
        backgroundColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 15,
      },
    })}
  >
    <Tab.Screen name="Home" component={HomeStack} />
    <Tab.Screen name="History" component={HistoryScreen} />
    <Tab.Screen name="Groups" component={GroupsStack} />
    <Tab.Screen name="Profile" component={ProfileStack} />
  </Tab.Navigator>
);

const AppNav = () => {
    const { isLoading, userToken } = useContext(AuthContext);

    if (isLoading) {
        return (
            <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
                <ActivityIndicator size={'large'} />
            </View>
        );
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

export default function App() {
  useEffect(() => {
    // Initialize services
    offlineSyncService.init();
    setupNotificationActions();

    // Listen for notification action responses (Take / Snooze)
    const notificationSub = addNotificationActionListener();

    return () => {
      offlineSyncService.destroy();
      notificationSub.remove();
    };
  }, []);

  return (
    <AuthProvider>
      <AppNav />
    </AuthProvider>
  );
}
