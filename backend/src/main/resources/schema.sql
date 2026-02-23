-- Create Database
CREATE DATABASE IF NOT EXISTS medscan_db;
USE medscan_db;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    role ENUM('PATIENT', 'CAREGIVER', 'ADMIN') DEFAULT 'PATIENT',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Medicines Table (Master Database or User specific?) 
-- Lets make it User specific for now, or a Global DB could be separate.
-- For this project, we assume users add their own medicines or pick from a global list.
CREATE TABLE IF NOT EXISTS medicines (
    medicine_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    manufacturer VARCHAR(100),
    type ENUM('TABLET', 'SYRUP', 'INJECTION', 'DROPS', 'OTHER') DEFAULT 'TABLET',
    dosage_strength VARCHAR(50), -- e.g. "500mg"
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Schedules Config (Linking Users and Medicines - The "Plan")
CREATE TABLE IF NOT EXISTS medication_schedules (
    schedule_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    medicine_id BIGINT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    frequency_type ENUM('DAILY', 'WEEKLY', 'AS_NEEDED', 'SPECIFIC_DAYS') DEFAULT 'DAILY',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (medicine_id) REFERENCES medicines(medicine_id) ON DELETE CASCADE
);

-- 3a. Schedule Times (Specific times for the schedule)
CREATE TABLE IF NOT EXISTS schedule_times (
    time_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    schedule_id BIGINT NOT NULL,
    scheduled_time TIME NOT NULL, -- e.g. "08:00:00", "20:00:00"
    FOREIGN KEY (schedule_id) REFERENCES medication_schedules(schedule_id) ON DELETE CASCADE
);

-- 4. Groups Table (Caregiver Groups)
CREATE TABLE IF NOT EXISTS care_groups (
    group_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    admin_id BIGINT NOT NULL, -- The creator/admin of the group
    group_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 5. Group Members Table
CREATE TABLE IF NOT EXISTS group_members (
    group_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES care_groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 6. Prescriptions (Metadata for OCR scans)
CREATE TABLE IF NOT EXISTS prescriptions (
    prescription_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    image_url VARCHAR(500), -- Path to stored image
    extracted_text TEXT, -- Raw OCR text
    verified_by_user BOOLEAN DEFAULT FALSE,
    doctor_name VARCHAR(100),
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
