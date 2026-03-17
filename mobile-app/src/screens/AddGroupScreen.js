import React, { useState, useContext, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import * as Contacts from 'expo-contacts';
import api from '../api/client';
import { AuthContext } from '../context/AuthContext';

const AddGroupScreen = ({ navigation }) => {
  const { userInfo } = useContext(AuthContext);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactMatches, setContactMatches] = useState([]);
  const [showContactMatches, setShowContactMatches] = useState(false);
  const [phoneToContactName, setPhoneToContactName] = useState({});

  // B2: Auto-load contacts on mount
  useEffect(() => {
    handleFromContacts();
  }, []);

  const searchByPhone = async (query) => {
    setMemberSearch(query);
    // Need at least 3 digits to search
    if (query.replace(/\D/g, '').length < 3) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const res = await api.post('/groups/contacts/check', [query.trim()]);
      // For manual search, limit displayed info for privacy
      const filtered = (res.data || []).filter(
        u => u.id !== userInfo.id && !selectedMembers.find(m => m.id === u.id)
      ).map(u => ({
        ...u,
        displayName: 'Registered User',  // Don't reveal real name from DB for manual search
      }));
      setSearchResults(filtered);
    } catch (e) {
      console.log('[AddGroup] Search failed:', e.message);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleFromContacts = async () => {
    setContactLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to contacts to find MedScan users.');
        setContactLoading(false);
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      if (!data || data.length === 0) {
        Alert.alert('No Contacts', 'No contacts found on this device.');
        setContactLoading(false);
        return;
      }

      const phoneNumbers = [];
      const phoneToContact = {};
      data.forEach(contact => {
        (contact.phoneNumbers || []).forEach(phone => {
          const normalized = phone.number.replace(/[\s\-\(\)\+]/g, '');
          const last10 = normalized.slice(-10);
          if (last10.length >= 10) {
            phoneNumbers.push(last10);
            phoneToContact[last10] = contact.name || 'Contact';
          }
        });
      });

      setPhoneToContactName(phoneToContact);

      if (phoneNumbers.length === 0) {
        Alert.alert('No Phone Numbers', 'None of your contacts have phone numbers.');
        setContactLoading(false);
        return;
      }

      // Send to backend for matching (in batches of 100)
      const allMatched = [];
      for (let i = 0; i < phoneNumbers.length; i += 100) {
        const batch = phoneNumbers.slice(i, i + 100);
        try {
          const res = await api.post('/groups/contacts/check', batch);
          allMatched.push(...(res.data || []));
        } catch (e) {
          console.log('[AddGroup] Contact batch check failed:', e.message);
        }
      }

      // De-duplicate and filter out self + already-selected
      const seen = new Set();
      const matches = allMatched.filter(u => {
        if (u.id === userInfo.id || selectedMembers.find(m => m.id === u.id) || seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      }).map(u => {
        // Find contact name from device by matching phone
        const userPhone = (u.phoneNumber || '').replace(/[^0-9]/g, '').slice(-10);
        const contactName = phoneToContact[userPhone] || 'Contact';
        return { ...u, displayName: contactName };
      });

      if (matches.length === 0) {
        Alert.alert('No Matches', 'None of your contacts are registered on MedScan.');
      } else {
        setContactMatches(matches);
        setShowContactMatches(true);
      }
    } catch (e) {
      console.log('[AddGroup] Contact access error:', e.message);
      Alert.alert('Error', 'Failed to access contacts.');
    } finally {
      setContactLoading(false);
    }
  };

  const addMember = (user) => {
    setSelectedMembers([...selectedMembers, user]);
    setSearchResults([]);
    setMemberSearch('');
    // Also remove from contact matches if present
    setContactMatches(prev => prev.filter(m => m.id !== user.id));
  };

  const removeMember = (userId) => {
    setSelectedMembers(selectedMembers.filter(m => m.id !== userId));
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a group name.');
      return;
    }

    setSaving(true);
    try {
      // Step 1: Create the group with description
      const params = new URLSearchParams({
        adminId: userInfo.id.toString(),
        groupName: name.trim(),
      });
      if (description.trim()) {
        params.append('description', description.trim());
      }
      const groupRes = await api.post(`/groups/create?${params.toString()}`);
      const groupId = groupRes.data.id;

      // Step 2: Add each selected member
      for (const member of selectedMembers) {
        try {
          await api.post(`/groups/${groupId}/add-member?adminId=${userInfo.id}&userId=${member.id}`);
        } catch (e) {
          console.log(`[AddGroup] Failed to add member ${member.id}:`, e.message);
        }
      }
      Alert.alert('Success', 'Group created successfully!');
      navigation.goBack();
    } catch (e) {
      const msg = e.response?.data?.message || 'Failed to create group.';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Group Details</Text>

        <Text style={styles.label}>Group Name *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g., Family Care Group"
          placeholderTextColor="#bdc3c7"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="Briefly describe this group's purpose"
          placeholderTextColor="#bdc3c7"
          multiline
          numberOfLines={3}
        />

        <Text style={styles.sectionTitle}>Add Members</Text>

        {/* B2: Single search bar — filters contacts, DB fallback at 10 digits */}
        <TextInput
          style={styles.input}
          value={memberSearch}
          onChangeText={(text) => {
            setMemberSearch(text);
            const digits = text.replace(/\D/g, '');
            // Filter contacts
            if (digits.length > 0) {
              const filtered = contactMatches.filter(u => {
                const phone = (u.phoneNumber || '').replace(/\D/g, '');
                const name = (u.displayName || '').toLowerCase();
                return phone.includes(digits) || name.includes(text.toLowerCase());
              });
              setSearchResults(filtered);
            } else if (text.trim()) {
              const filtered = contactMatches.filter(u => {
                const name = (u.displayName || '').toLowerCase();
                return name.includes(text.toLowerCase());
              });
              setSearchResults(filtered);
            } else {
              setSearchResults(contactMatches);
            }
            // DB fallback at 10 digits
            if (digits.length >= 10 && contactMatches.filter(u => (u.phoneNumber || '').replace(/\D/g, '').includes(digits)).length === 0) {
              setSearching(true);
              api.post('/groups/contacts/check', [digits.slice(-10)])
                .then(res => {
                  const dbResults = (res.data || []).filter(
                    u => u.id !== userInfo.id && !selectedMembers.find(m => m.id === u.id)
                  );
                  setSearchResults(prev => {
                    const ids = new Set(prev.map(p => p.id));
                    return [...prev, ...dbResults.filter(r => !ids.has(r.id))];
                  });
                })
                .catch(() => {})
                .finally(() => setSearching(false));
            }
          }}
          placeholder="Search by name or phone number"
          placeholderTextColor="#bdc3c7"
        />

        {contactLoading && <ActivityIndicator size="small" color="#3498db" style={{ marginVertical: 8 }} />}
        {searching && <ActivityIndicator size="small" color="#3498db" style={{ marginVertical: 4 }} />}

        {/* Contact matches / search results */}
        {(memberSearch.trim() ? searchResults : contactMatches).length > 0 && (
          <View style={styles.searchResults}>
            <Text style={styles.selectedTitle}>
              {memberSearch.trim() ? 'Search Results' : 'Your Contacts on MedScan'} ({(memberSearch.trim() ? searchResults : contactMatches).length})
            </Text>
            {(memberSearch.trim() ? searchResults : contactMatches)
              .filter(u => !selectedMembers.find(m => m.id === u.id))
              .map(user => (
              <TouchableOpacity key={user.id} style={styles.searchResultItem} onPress={() => addMember(user)}>
                <View style={styles.userAvatar}>
                  <Text style={styles.userAvatarText}>{(user.displayName || user.fullName || '?')[0].toUpperCase()}</Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userName}>{user.displayName || user.fullName || user.username}</Text>
                  <Text style={styles.userPhone}>{user.phoneNumber || '—'}</Text>
                </View>
                <Text style={styles.addIcon}>+</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {memberSearch.replace(/\D/g, '').length >= 10 && !searching && searchResults.length === 0 && (
          <Text style={styles.noResults}>No registered user found with that number</Text>
        )}

        {/* Selected Members */}
        {selectedMembers.length > 0 && (
          <View style={styles.selectedSection}>
            <Text style={styles.selectedTitle}>Selected ({selectedMembers.length})</Text>
            {selectedMembers.map(member => (
              <View key={member.id} style={styles.selectedMember}>
                <View style={[styles.userAvatar, { backgroundColor: '#27ae60' }]}>
                  <Text style={styles.userAvatarText}>{(member.fullName || member.username || '?')[0].toUpperCase()}</Text>
                </View>
                <Text style={styles.selectedName}>{member.fullName || member.username}</Text>
                <TouchableOpacity onPress={() => removeMember(member.id)}>
                  <Text style={styles.removeBtn}>✗</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Creator info */}
        <View style={styles.creatorInfo}>
          <Text style={styles.creatorText}>You ({userInfo?.fullName || userInfo?.username}) will be the group admin.</Text>
        </View>

        {/* Create Button */}
        <TouchableOpacity style={styles.createBtn} onPress={handleCreate} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>✨ Create Group</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f9fc' },
  scrollContent: { padding: 20, paddingBottom: 120 },

  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#34495e', marginBottom: 12, marginTop: 16 },
  label: { fontSize: 13, fontWeight: '700', color: '#34495e', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },

  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e6ed',
    borderRadius: 12, padding: 14, fontSize: 16, color: '#2c3e50',
  },
  textArea: { height: 80, textAlignVertical: 'top' },

  contactsBtn: {
    backgroundColor: '#e8f4fd', paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#bee3f8',
    marginBottom: 12,
  },
  contactsBtnText: { fontSize: 15, fontWeight: '600', color: '#2980b9' },

  contactMatchesSection: {
    backgroundColor: '#f0fdf4', borderRadius: 12, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: '#bbf7d0',
  },

  searchResults: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1,
    borderColor: '#e0e6ed', marginTop: 8, maxHeight: 200,
  },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  userAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#3498db',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  userAvatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontWeight: '600', color: '#2c3e50' },
  userPhone: { fontSize: 12, color: '#95a5a6' },
  addIcon: { fontSize: 20, color: '#3498db', fontWeight: '700' },
  noResults: { color: '#95a5a6', fontSize: 13, textAlign: 'center', marginTop: 12 },

  selectedSection: { marginTop: 16 },
  selectedTitle: { fontSize: 14, fontWeight: '600', color: '#7f8c8d', marginBottom: 8 },
  selectedMember: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    padding: 10, borderRadius: 10, marginBottom: 6,
  },
  selectedName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#2c3e50', marginLeft: 10 },
  removeBtn: { color: '#e74c3c', fontSize: 18, fontWeight: '700', paddingHorizontal: 8 },

  creatorInfo: {
    backgroundColor: '#eaf7fd', padding: 12, borderRadius: 10, marginTop: 16,
    borderLeftWidth: 4, borderLeftColor: '#3498db',
  },
  creatorText: { color: '#2980b9', fontSize: 13, fontWeight: '500' },

  createBtn: {
    backgroundColor: '#27ae60', paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 24,
    elevation: 3, shadowColor: '#27ae60',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6,
  },
  createBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});

export default AddGroupScreen;
