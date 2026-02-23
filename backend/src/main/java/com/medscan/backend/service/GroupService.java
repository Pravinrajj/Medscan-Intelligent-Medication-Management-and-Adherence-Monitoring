package com.medscan.backend.service;

import com.medscan.backend.model.CareGroup;
import com.medscan.backend.model.GroupActivity;
import com.medscan.backend.model.GroupMember;
import com.medscan.backend.model.User;
import com.medscan.backend.repository.mongo.GroupActivityRepository;
import com.medscan.backend.repository.mysql.CareGroupRepository;
import com.medscan.backend.repository.mysql.GroupMemberRepository;
import com.medscan.backend.repository.mysql.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class GroupService {

    @Autowired
    private CareGroupRepository careGroupRepository;

    @Autowired
    private GroupMemberRepository groupMemberRepository;
    
    @Autowired
    private UserRepository userRepository;

    @Autowired
    private GroupActivityRepository groupActivityRepository;

    public CareGroup createGroup(Long adminId, String groupName) {
        User admin = userRepository.findById(adminId)
                .orElseThrow(() -> new RuntimeException("Admin not found"));
        CareGroup group = new CareGroup();
        group.setAdmin(admin);
        group.setGroupName(groupName);
        CareGroup saved = careGroupRepository.save(group);

        // Log activity
        groupActivityRepository.save(new GroupActivity(
                saved.getId(), adminId, "GROUP_CREATED",
                admin.getFullName() + " created group \"" + groupName + "\""));

        return saved;
    }

    public void addMember(Long groupId, Long adminId, Long userId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));

        // Enforce admin-only member addition
        if (!group.getAdmin().getId().equals(adminId)) {
            throw new RuntimeException("Only the group admin can add members");
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        GroupMember member = new GroupMember(group, user);
        groupMemberRepository.save(member);

        // Log activity
        User admin = group.getAdmin();
        groupActivityRepository.save(new GroupActivity(
                groupId, adminId, "MEMBER_ADDED",
                admin.getFullName() + " added " + user.getFullName() + " to the group"));
    }

    // Contact Discovery — normalizes phone numbers and uses indexed query
    public List<User> checkContactsRegistered(List<String> phoneNumbers) {
        // Normalize: strip non-digits, keep last 10 digits (handles +91, +1, etc.)
        List<String> normalized = phoneNumbers.stream()
                .map(p -> p.replaceAll("[^0-9]", ""))
                .filter(p -> p.length() >= 10)
                .map(p -> p.substring(p.length() - 10))
                .distinct()
                .collect(Collectors.toList());
        
        if (normalized.isEmpty()) return List.of();
        
        // Also try matching with the raw numbers for exact matches
        List<String> allVariants = new java.util.ArrayList<>(normalized);
        for (String n : normalized) {
            allVariants.add("+91" + n); // India
            allVariants.add("91" + n);
        }
        
        return userRepository.findByPhoneNumberIn(allVariants.stream().distinct().collect(Collectors.toList()));
    }

    public List<CareGroup> getUserGroups(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
        
        List<CareGroup> adminGroups = careGroupRepository.findByAdminId(userId);
        List<GroupMember> memberGroups = groupMemberRepository.findByUser(user);
        
        List<CareGroup> allGroups = new ArrayList<>(adminGroups);
        for (GroupMember gm : memberGroups) {
            if (!allGroups.contains(gm.getGroup())) {
                allGroups.add(gm.getGroup());
            }
        }
        return allGroups;
    }

    public List<User> getGroupMembers(Long groupId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));
        return groupMemberRepository.findByGroup(group).stream()
                .map(GroupMember::getUser)
                .collect(Collectors.toList());
    }

    public List<GroupActivity> getGroupActivity(Long groupId) {
        return groupActivityRepository.findByGroupIdOrderByTimestampDesc(groupId);
    }

    // Log an activity event for a group (e.g., dose taken by a member)
    public void logGroupActivity(Long groupId, Long userId, String type, String message) {
        groupActivityRepository.save(new GroupActivity(groupId, userId, type, message));
    }

    public void removeMember(Long groupId, Long userId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
        
        GroupMember member = groupMemberRepository.findByGroupAndUser(group, user)
                .orElseThrow(() -> new RuntimeException("User is not a member of this group"));
        
        groupMemberRepository.delete(member);

        // Log activity
        groupActivityRepository.save(new GroupActivity(
                groupId, userId, "MEMBER_LEFT",
                (user.getFullName() != null ? user.getFullName() : user.getUsername()) + " left the group"));
    }

    public void deleteGroup(Long groupId, Long adminId) {
        CareGroup group = careGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found"));

        if (!group.getAdmin().getId().equals(adminId)) {
            throw new RuntimeException("Only the group admin can delete the group");
        }

        // Remove all members first
        List<GroupMember> members = groupMemberRepository.findByGroup(group);
        groupMemberRepository.deleteAll(members);

        // Log deletion
        User admin = group.getAdmin();
        groupActivityRepository.save(new GroupActivity(
                groupId, adminId, "GROUP_DELETED",
                admin.getFullName() + " deleted group \"" + group.getGroupName() + "\""));

        // Delete the group
        careGroupRepository.delete(group);
    }
}
