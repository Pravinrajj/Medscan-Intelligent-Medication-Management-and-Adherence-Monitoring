package com.medscan.backend.repository.mongo;

import com.medscan.backend.model.GroupActivity;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface GroupActivityRepository extends MongoRepository<GroupActivity, String> {
    List<GroupActivity> findByGroupIdOrderByTimestampDesc(Long groupId);
}
