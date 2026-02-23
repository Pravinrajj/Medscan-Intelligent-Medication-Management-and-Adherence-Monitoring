# MedScan Project Documentation
*For Project Presentation and Technical Review*

---

## 1. Software Requirement Specification (SRS)

### 1.1 Introduction
**MedScan** is an intelligent, cross-platform mobile medication management system designed to improve patient adherence through scheduling, reminders, and care group monitoring. It bridges the gap between patients and caregivers using modern mobile technology and machine learning.

### 1.2 Functional Requirements
*   **User Authentication**:
    *   Registration of Patients and Caregivers.
    *   Secure Login using JWT Authentication.
*   **Medication Management**:
    *   Add/Edit medications (Name, Dosage, Stock).
    *   Set strict schedules with specific reminder times.
    *   Low stock alerts logic.
*   **Adherence Tracking**:
    *   Log doses as 'Taken', 'Missed', or 'Skipped'.
    *   View adherence history logs.
    *   Weekly adherence statistics and scoring.
*   **Care Groups**:
    *   Create groups for family/caregivers.
    *   Discovery of registered contacts via phone number.
    *   View adherence activity of group members.
*   **OCR Prescription Scanning**:
    *   Upload prescription images via Camera or Gallery.
    *   Extract text (Medicine names, Doctor info) using OCR.
    *   User verification of extracted text.
*   **Notifications**:
    *   Local push notifications for medication reminders (Offline supported).

### 1.3 Mobile-Specific Requirements
*   **Platform Support**:
    *   **Android**: Android 8.0 (Oreo) or higher.
    *   **iOS**: iOS 13.0 or higher.
*   **Device Permissions**:
    *   **Camera**: Required for scanning prescriptions.
    *   **Notifications**: Required for delivering medication reminders.
    *   **Contacts**: Required for finding friends/family to add to Care Groups.
    *   **Storage**: Required for caching user data and images.
*   **Connectivity**: 
    *   Optimized for intermittent network connectivity (offline scheduling).

### 1.4 Non-Functional Requirements
*   **Performance**: Mobile app load time < 2 seconds. API response time < 200ms.
*   **Scalability**: Microservice-ready architecture.
*   **Security**: Data encryption in transit (HTTPS) and at rest (Database).
*   **Usability**: Intuitive UI compliant with Material Design (Android) and Human Interface Guidelines (iOS).

---

## 2. System Analysis and Design

### 2.1 Project Environment (Hardware & Software)

**Development Environment:**
*   **Hardware**: Intel Core i5/i7 (min 4 cores), 16GB RAM.
*   **Software**: 
    *   **OS**: Windows 10/11, macOS, or Linux.
    *   **IDE**: VS Code (Mobile), IntelliJ IDEA (Backend).

**Mobile Deployment Environment:**
*   **Framework**: **React Native with Expo** (Cross-Platform).
    *   Allows a single JavaScript codebase to render native UI components for both Android and iOS.
*   **Testing**: Android Emulator (Pixel/Nexus), iOS Simulator (iPhone), Physical Devices.

**Backend Server Environment:**
*   **Runtime**: JDK 17 (Spring Boot 3.x).
*   **Database Servers**: MySQL 8.0+, MongoDB 6.0+.
*   **ML Environment**: Python 3.8+, FastAPI, Tesseract OCR Engine.

---

### 2.2 Overall System Design

#### 2.2.1 System Architecture
The system follows a **Client-Server Architecture** with a specialized ML service.

```mermaid
graph TD
    Client[Mobile App (React Native - Android/iOS)] <-->|REST API / JSON| Gateway[API Gateway / Load Balancer]
    Gateway <-->|HTTPS| Backend[Spring Boot Backend]
    Backend <-->|JPA/Hibernate| SQL[(MySQL Database)]
    Backend <-->|Spring Data| NoSQL[(MongoDB Database)]
    Backend <-->|HTTP| ML[Python ML Service]
    ML -->|Tesseract| OCR[OCR Engine]
```

#### 2.2.2 Database Design (ER Diagram)

**Relational Schema (MySQL):**
*   **User**: `id (PK)`, `username`, `password_hash`, `role`, `phone_number`.
*   **Medicine**: `id (PK)`, `name`, `type`, `manufacturer`.
*   **MedicationSchedule**: `id (PK)`, `user_id (FK)`, `medicine_id (FK)`, `start_date`, `frequency`, `current_stock`.
*   **ScheduleTime**: `id (PK)`, `schedule_id (FK)`, `time`.
*   **CareGroup**: `id (PK)`, `admin_id (FK)`, `group_name`.
*   **GroupMember**: `group_id`, `user_id` (Composite PK).
*   **Prescription**: `id (PK)`, `user_id (FK)`, `image_url`, `verified_text`.

**NoSQL Schema (MongoDB):**
*   **AdherenceLog**: `_id`, `scheduleId`, `userId`, `status` (TAKEN/MISSED), `timestamp`.

#### 2.2.3 Data Flow Diagram (DFD) - Level 1 (Medication Adherence)
1.  **User** -> (Inputs Dose Status) -> **Mobile App** (iOS/Android)
2.  **Mobile App** -> (POST /adherence) -> **Backend Controller**
3.  **Backend Controller** -> (Log Data) -> **Adherence Service**
4.  **Adherence Service** -> (Save Log) -> **MongoDB**
5.  **Adherence Service** -> (Update Stock) -> **MedicationSchedule Repository** -> **MySQL**
6.  **Backend** -> (Success Response) -> **Mobile App**

#### 2.2.4 UI Design (Key Screens)
*   **Dashboard**: Card-based daily timeline. Color-coded adherence score at top.
*   **Add Medicine**: Form with dynamic time pickers (add multiple reminders).
*   **Group Details**: Member list grid + recent activity feed.
*   **History**: Scrollable list of past doses with status indicators.

---

### 2.3 Detailed Design

#### 2.3.1 Object-Oriented Analysis & Design (OOAD)

**Class Diagram (Core Classes):**
*   **User**: Attributes (id, username, role). Methods (login, updateProfile).
*   **MedicationSchedule**: Attributes (doseAmount, stock, times[]). Methods (decrementStock, isLowStock).
*   **CareGroup**: Attributes (name, members[]). Methods (addMember, removeMember).
*   **AdherenceService**: Methods (logAdherence, calculateStats).
*   **ScheduleController**: Endpoints (create, getByUser).

**Use Case Diagram Actors:**
*   **Patient**: Registers, Adds Meds, Takes Doses, Views Stats.
*   **Caregiver**: Creates Groups, Monitors Patients.
*   **System**: Sends Notifications, Updates Inventory, Syncs Data.

#### 2.3.2 Process Logic (Flow Charts)

**Flow Chart: Taking a Dose**
```
[Start]
   |
[User Clicks "Take"]
   |
[App Sends Request to Backend]
   |
[Backend Component: AdherenceService]
   |
<Is Status TAKEN?> -- No --> [Log "Missed/Skipped" in Mongo] --> [End]
   | Yes
[Find Schedule in MySQL]
   |
<Is Stock > 0?> -- No --> [Log Taken] --> [Return Warning "Stock Empty"]
   | Yes
[Decrement Stock by Dose Amount]
   |
[Save Schedule to MySQL]
   |
[Log "Taken" in Mongo]
   |
[Return Success]
   |
[End]
```

---

## 3. Code Review & Quality Assurance

### 3.1 Codebase Analysis
*   **Design Patterns Used**:
    *   **Repository Pattern**: Abstracts data access (e.g., `UserRepository`, `AdherenceRepository`).
    *   **DTO (Data Transfer Object)**: Decouples internal models from API responses (e.g., `JwtResponse`, `ScheduleRequest`).
    *   **Service Layer Pattern**: Contains business logic, keeping controllers lean.
    *   **Dependency Injection**: Heavily used via Spring's `@Autowired`.

### 3.2 Key Concepts Implemented
1.  **Cross-Platform Mobile Development**: Leverages React Native to deploy on both Android and iOS from a single JavaScript codebase, reducing development time and maintenance cost.
2.  **Hybrid Database Approach**: Using MySQL for relational consistency (Inventory) and MongoDB for write-heavy, non-relational data (Logs), optimizing performance.
3.  **Offline Capability**: Mobile app uses `expo-notifications` to schedule alerts locally, ensuring reminders work even without internet.
4.  **Security**:
    *   `WebSecurityConfig` defines stateless session policy.
    *   `AuthTokenFilter` intercepts requests to validate JWTs.
    *   Passwords are never stored in plain text using `BCryptPasswordEncoder`.

### 3.3 Code review highlights from implementation
*   **Refactoring**: `AdherenceService.java` was verified to ensure atomic updates to inventory when logging doses.
*   **Testing**: Unit tests in `AdherenceServiceTest.java` use Mockito to verify stock decrement logic without touching the real database.
*   **Error Handling**: Global exception handling (basic) ensures API doesn't crash on invalid data.

---

*This document serves as the technical foundation for the MedScan solution presentation.*
