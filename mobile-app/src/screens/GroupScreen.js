import React, { useContext, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, SafeAreaView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import { colors, fonts, spacing, radii, shadows, typography, components } from '../theme';

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

  // Color for group avatar based on group id
  const getGroupColor = (id) => {
    const palette = [colors.primary, '#7C3AED', '#059669', '#D97706', '#DC2626', '#2563EB'];
    return palette[(id || 0) % palette.length];
  };

  const renderItem = ({ item }) => {
    const groupColor = getGroupColor(item.id);
    const initial = (item.groupName || item.name || 'G')[0].toUpperCase();

    return (
      <TouchableOpacity
        style={styles.groupCard}
        onPress={() => navigation.navigate('GroupChat', { group: item })}
        activeOpacity={0.7}
      >
        <View style={[styles.groupAvatar, { backgroundColor: groupColor + '15' }]}>
          <Text style={[styles.groupAvatarText, { color: groupColor }]}>{initial}</Text>
        </View>
        <View style={styles.groupInfo}>
          <View style={styles.groupTopRow}>
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
          <View style={styles.memberBadge}>
            <MaterialCommunityIcons name="account-multiple" size={12} color={colors.primary} />
            <Text style={styles.memberCount}>
              {item.memberCount || item.members?.length || 0} members
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error && groups.length === 0) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={colors.textTertiary} />
        <Text style={styles.errorTitle}>Failed to Load Groups</Text>
        <Text style={styles.errorSub}>Check your connection and try again.</Text>
        <TouchableOpacity style={[components.buttonPrimary, { marginTop: spacing.lg }]} onPress={fetchGroups}>
          <Text style={[typography.button, { color: colors.textInverse }]}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Care Groups</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('AddGroup')}
        >
          <MaterialCommunityIcons name="plus" size={20} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={groups}
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <MaterialCommunityIcons name="account-group-outline" size={48} color={colors.textTertiary} />
            </View>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptySubtext}>Create a care group to share medication updates with family or caregivers</Text>
            <TouchableOpacity
              style={[components.buttonPrimary, { marginTop: spacing.xl }]}
              onPress={() => navigation.navigate('AddGroup')}
            >
              <Text style={[typography.button, { color: colors.textInverse }]}>Create First Group</Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.background, padding: spacing.xxl,
  },
  errorTitle: { ...typography.h3, marginTop: spacing.md },
  errorSub: { ...typography.caption, marginTop: spacing.xs },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingTop: 50, paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  title: { ...typography.h1 },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    ...shadows.colored(colors.primary),
  },

  // Group card
  groupCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, padding: spacing.lg,
    borderRadius: radii.xl, marginTop: spacing.md,
    ...shadows.sm,
  },
  groupAvatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  groupAvatarText: { fontSize: 20, fontFamily: fonts.bold },
  groupInfo: { flex: 1, marginRight: spacing.sm },
  groupTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupName: { fontSize: 15, fontFamily: fonts.semiBold, color: colors.text, flex: 1, marginRight: spacing.sm },
  lastTime: { fontSize: 11, fontFamily: fonts.regular, color: colors.textTertiary },
  lastMessage: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 3 },
  groupDesc: { fontSize: 13, fontFamily: fonts.regular, color: colors.textTertiary, marginTop: 3 },
  memberBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  memberCount: { fontSize: 12, fontFamily: fonts.semiBold, color: colors.primary },

  // Empty
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  emptyTitle: { ...typography.h3, marginBottom: spacing.sm },
  emptySubtext: { ...typography.caption, textAlign: 'center', lineHeight: 20 },
});

export default GroupScreen;
