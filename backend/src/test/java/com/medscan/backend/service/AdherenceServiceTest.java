package com.medscan.backend.service;

import com.medscan.backend.model.AdherenceLog;
import com.medscan.backend.model.MedicationSchedule;
import com.medscan.backend.repository.mongo.AdherenceRepository;
import com.medscan.backend.repository.mysql.CareGroupRepository;
import com.medscan.backend.repository.mysql.GroupMemberRepository;
import com.medscan.backend.repository.mysql.MedicationScheduleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.util.Collections;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

public class AdherenceServiceTest {

    @InjectMocks
    private AdherenceService adherenceService;

    @Mock
    private CareGroupRepository careGroupRepository;

    @Mock
    private GroupService groupService;

    @Mock
    private PushNotificationService pushNotificationService;

    @Mock
    private AdherenceRepository adherenceRepository;

    @Mock
    private MedicationScheduleRepository scheduleRepository;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    @BeforeEach
    public void setUp() {
        MockitoAnnotations.openMocks(this);

        when(groupMemberRepository.findByIdUserId(anyLong()))
                .thenReturn(Collections.emptyList());

        when(groupMemberRepository.findByGroup(any()))
                .thenReturn(Collections.emptyList());

        when(adherenceRepository.countByScheduleIdAndTimestampAfter(anyLong(), any()))
                .thenReturn(0L);
    }

    @Test
    public void testLogAdherence_Taken_DecrementsStock() {
        // Arrange
        Long userId = 1L;
        Long scheduleId = 100L;
        
        MedicationSchedule schedule = new MedicationSchedule();
        schedule.setId(scheduleId);
        schedule.setCurrentStock(10);
        schedule.setDoseAmount(1.0); // e.g., 1 pill

        when(scheduleRepository.findById(scheduleId)).thenReturn(Optional.of(schedule));
        when(adherenceRepository.save(any(AdherenceLog.class))).thenAnswer(i -> i.getArguments()[0]);

        // Act
        AdherenceLog result = adherenceService.logAdherence(userId, scheduleId, "TAKEN", null);

        // Assert
        assertNotNull(result);
        assertEquals("TAKEN", result.getStatus());
        
        // Verify stock was updated
        assertEquals(9, schedule.getCurrentStock());
        verify(scheduleRepository, times(1)).save(schedule);
    }

    @Test
    public void testLogAdherence_Missed_DoesNotDecrementStock() {
        // Arrange
        Long userId = 1L;
        Long scheduleId = 100L;
        
        MedicationSchedule schedule = new MedicationSchedule();
        schedule.setId(scheduleId);
        schedule.setCurrentStock(10);

        when(scheduleRepository.findById(scheduleId)).thenReturn(Optional.of(schedule));
        when(adherenceRepository.save(any(AdherenceLog.class))).thenAnswer(i -> i.getArguments()[0]);

        // Act
        AdherenceLog result = adherenceService.logAdherence(userId, scheduleId, "MISSED", "Forgot");

        // Assert
        assertEquals("MISSED", result.getStatus());
        
        // Stock remains same
        assertEquals(10, schedule.getCurrentStock());
        verify(scheduleRepository, never()).save(schedule);
    }
}
