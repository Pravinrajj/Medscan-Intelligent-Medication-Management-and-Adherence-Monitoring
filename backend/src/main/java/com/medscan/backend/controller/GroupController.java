package com.medscan.backend.controller;

import com.medscan.backend.model.CareGroup;
import com.medscan.backend.model.GroupActivity;
import com.medscan.backend.model.User;
import com.medscan.backend.service.GroupService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@CrossOrigin(origins = "*", maxAge = 3600)
@RestController
@RequestMapping("/api/groups")
public class GroupController {

    @Autowired
    private GroupService groupService;

    @PostMapping("/create")
    public ResponseEntity<CareGroup> createGroup(@RequestParam Long adminId, @RequestParam String groupName) {
        return ResponseEntity.ok(groupService.createGroup(adminId, groupName));
    }

    @PostMapping("/{groupId}/add-member")
    public ResponseEntity<?> addMember(
            @PathVariable Long groupId,
            @RequestParam Long adminId,
            @RequestParam Long userId) {
        groupService.addMember(groupId, adminId, userId);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/contacts/check")
    public ResponseEntity<List<User>> checkContacts(@RequestBody List<String> phoneNumbers) {
        return ResponseEntity.ok(groupService.checkContactsRegistered(phoneNumbers));
    }

    @GetMapping("/user/{userId}")
    public ResponseEntity<List<CareGroup>> getUserGroups(@PathVariable Long userId) {
        return ResponseEntity.ok(groupService.getUserGroups(userId));
    }

    @GetMapping("/members/{groupId}")
    public ResponseEntity<List<User>> getGroupMembers(@PathVariable Long groupId) {
        return ResponseEntity.ok(groupService.getGroupMembers(groupId));
    }

    @GetMapping("/{groupId}/activity")
    public ResponseEntity<List<GroupActivity>> getGroupActivity(@PathVariable Long groupId) {
        return ResponseEntity.ok(groupService.getGroupActivity(groupId));
    }

    @DeleteMapping("/{groupId}/leave")
    public ResponseEntity<?> leaveGroup(
            @PathVariable Long groupId,
            @RequestParam Long userId) {
        groupService.removeMember(groupId, userId);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/{groupId}")
    public ResponseEntity<?> deleteGroup(
            @PathVariable Long groupId,
            @RequestParam Long adminId) {
        groupService.deleteGroup(groupId, adminId);
        return ResponseEntity.ok().build();
    }
}
