package com.medscan.backend.repository.mysql;

import com.medscan.backend.model.CareGroup;
import com.medscan.backend.model.GroupMember;
import com.medscan.backend.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface GroupMemberRepository extends JpaRepository<GroupMember, GroupMember.GroupMemberId> {
    List<GroupMember> findByUser(User user);
    List<GroupMember> findByGroup(CareGroup group);
    List<GroupMember> findByIdUserId(Long userId);
    java.util.Optional<GroupMember> findByGroupAndUser(CareGroup group, User user);
}
