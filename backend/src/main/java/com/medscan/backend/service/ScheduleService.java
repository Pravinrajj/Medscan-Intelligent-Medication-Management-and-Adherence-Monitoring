package com.medscan.backend.service;

import com.medscan.backend.model.MedicationSchedule;
import com.medscan.backend.model.ScheduleTime;
import com.medscan.backend.model.User;
import com.medscan.backend.model.Medicine;
import com.medscan.backend.repository.mysql.MedicationScheduleRepository;
import com.medscan.backend.repository.mysql.MedicineRepository;
import com.medscan.backend.repository.mysql.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.util.List;

@Service
public class ScheduleService {

    @Autowired
    private MedicationScheduleRepository scheduleRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private MedicineRepository medicineRepository;

    public List<MedicationSchedule> getUserSchedules(Long userId) {
        return scheduleRepository.findByUserIdAndIsActiveTrue(userId);
    }

    @Transactional
    public MedicationSchedule createSchedule(Long userId, Long medicineId, MedicationSchedule scheduleData, List<LocalTime> times) {
        User user = userRepository.findById(userId).orElseThrow(() -> new RuntimeException("User not found"));
        Medicine medicine = medicineRepository.findById(medicineId).orElseThrow(() -> new RuntimeException("Medicine not found"));

        scheduleData.setUser(user);
        scheduleData.setMedicine(medicine);
        
        // Save the schedule first to get an ID
        MedicationSchedule savedSchedule = scheduleRepository.save(scheduleData);

        // Add times
        if (times != null) {
            for (LocalTime time : times) {
                ScheduleTime scheduleTime = new ScheduleTime();
                scheduleTime.setScheduledTime(time);
                savedSchedule.addScheduleTime(scheduleTime);
            }
        }

        return scheduleRepository.save(savedSchedule);
    }

    @Transactional
    public MedicationSchedule updateSchedule(Long scheduleId, MedicationSchedule updates, List<LocalTime> newTimes) {
        MedicationSchedule existing = scheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new RuntimeException("Schedule not found"));

        // Update editable fields
        if (updates.getDoseAmount() != null) existing.setDoseAmount(updates.getDoseAmount());
        if (updates.getDoseUnit() != null) existing.setDoseUnit(updates.getDoseUnit());
        if (updates.getCurrentStock() != null) existing.setCurrentStock(updates.getCurrentStock());
        if (updates.getFrequencyType() != null) existing.setFrequencyType(updates.getFrequencyType());
        if (updates.getEndDate() != null) existing.setEndDate(updates.getEndDate());

        // Replace schedule times if provided
        if (newTimes != null && !newTimes.isEmpty()) {
            existing.getScheduleTimes().clear();
            for (LocalTime time : newTimes) {
                ScheduleTime st = new ScheduleTime();
                st.setScheduledTime(time);
                existing.addScheduleTime(st);
            }
        }

        return scheduleRepository.save(existing);
    }

    public void deleteSchedule(Long scheduleId) {
        scheduleRepository.deleteById(scheduleId);
    }
}
