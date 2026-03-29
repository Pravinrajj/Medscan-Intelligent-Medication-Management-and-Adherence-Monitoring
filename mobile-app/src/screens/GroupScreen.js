import React, { useContext, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';

const GroupScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const [groups, setGroups] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchGroups = async () => {
    if (!userInfo?.id) return;
    try {
      setError(false);
      const response = await api.get(`/groups/user/${userInfo.id}`);
      setGroups(response.data);
    } catch (err) {
      console.error('Failed to fetch groups', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchGroups();
    setRefreshing(false);
  }, [userInfo]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchGroups();
    }, [userInfo])
  );

  const getRelativeTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.groupCard} 
      onPress={() => navigation.navigate('GroupChat', { group: item })}
      activeOpacity={0.7}
    >
      <View style={styles.groupIcon}>
        <MaterialCommunityIcons name="account-group" size={22} color="#3498db" />
      </View>
      <View style={styles.groupInfo}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.groupName} numberOfLines={1}>{item.groupName || item.name}</Text>
          {item.lastActivityTime && (
            <Text style={styles.lastTime}>{getRelativeTime(item.lastActivityTime)}</Text>
          )}
        </View>
        {item.lastActivityMessage ? (
          <Text style={styles.lastMessage} numberOfLines={1}>{item.lastActivityMessage}</Text>
        ) : item.description ? (
          <Text style={styles.groupDesc} numberOfLines={1}>{item.description}</Text>
        ) : null}
        <Text style={styles.memberCount}>
          {item.memberCount || item.members?.length || 0} members
        </Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3498db" />
      </View>
    );
  }

  if (error && groups.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <MaterialCommunityIcons name="alert-circle-outline" size={40} color="#7f8c8d" style={{marginBottom: 10}} />
        <Text style={{fontSize: 16, fontWeight: '600', color: '#2c3e50', marginBottom: 6}}>Failed to Load Groups</Text>
        <Text style={{color: '#7f8c8d', marginBottom: 16}}>Check your connection and try again.</Text>
        <TouchableOpacity style={{backgroundColor: '#3498db', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8}} onPress={fetchGroups}>
          <Text style={{color: '#fff', fontWeight: '600'}}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Care Groups</Text>
      
      {loading ? (
        <ActivityIndicator size="large" color="#3498db" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={item => item.id.toString()}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="account-group-outline" size={48} color="#bdc3c7" style={{marginBottom: 12}} />
              <Text style={styles.emptyText}>No groups yet</Text>
              <Text style={styles.emptySubtext}>Create a care group to share medication updates with family</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}

      <TouchableOpacity 
        style={styles.createButton}
        onPress={() => navigation.navigate('AddGroup')}
        activeOpacity={0.8}
      >
        <Text style={styles.createButtonText}>+ Create New Group</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    padding: 20, 
    backgroundColor: '#f5f7fa',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f7fa',
  },
  title: { 
    fontSize: 24, 
    fontWeight: '800', 
    color: '#2c3e50', 
    marginBottom: 16,
    marginTop: 10,
  },
  
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  groupIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e8f4fd',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  groupIconText: { fontSize: 22 },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 16, fontWeight: '700', color: '#2c3e50' },
  groupDesc: { fontSize: 13, color: '#7f8c8d', marginTop: 2 },
  memberCount: { fontSize: 12, color: '#3498db', fontWeight: '600', marginTop: 4 },
  lastMessage: { fontSize: 13, color: '#7f8c8d', marginTop: 2 },
  lastTime: { fontSize: 11, color: '#95a5a6' },

  emptyContainer: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: '700', color: '#2c3e50', marginBottom: 6 },
  emptySubtext: { fontSize: 14, color: '#95a5a6', textAlign: 'center', paddingHorizontal: 40 },

  createButton: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: '#3498db',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#3498db',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  createButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

export default GroupScreen;
