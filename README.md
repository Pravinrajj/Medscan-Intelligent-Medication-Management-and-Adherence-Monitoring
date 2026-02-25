# MedScan - Intelligent Medication Management & Adherence System

**A full-stack, cross-platform healthcare application addressing medication non-adherence through intelligent scheduling, real-time reminders, and care group coordination.**

![Status](https://img.shields.io/badge/Status-MVP%20Complete-brightgreen)
![Java](https://img.shields.io/badge/Backend-Java%2021%20Spring%20Boot%203.2-blue)
![React Native](https://img.shields.io/badge/Mobile-React%20Native%200.81-61dafb)
![License](https://img.shields.io/badge/License-MIT-green)

## Overview

MedScan is a comprehensive healthcare platform designed to improve patient medication adherence by integrating intelligent scheduling, real-time reminders, family care coordination, and prescription OCR scanning. The system implements enterprise-grade architecture with hybrid database design, JWT-based authentication, and microservice-ready infrastructure.

**Problem Statement**: With ~50% medication non-adherence rate leading to poor health outcomes, manual tracking of schedules, inventory mismanagement, and limited caregiver coordination tools, there is a critical need for an integrated digital platform.

**Solution**: MedScan provides:
- Real-time medication scheduling with multiple daily reminders
- Adherence tracking and analytics (7-day trend analysis)
- Care group management for family monitoring
- Prescription OCR scanning with Tesseract text extraction
- Hybrid database (MySQL for relational data, MongoDB for logs)
- Offline-first architecture with intelligent sync
- Push notifications via Expo API

---

## Features

**Core Functionality**
- **Medication Scheduling**: Create schedules with multiple daily times, frequency types (Daily/Weekly/As-needed), automatic stock decrement
- **Adherence Logging**: Log doses as Taken/Missed/Skipped with timestamp tracking
- **Analytics Dashboard**: 7-day adherence rate, medicine-wise breakdown, daily trends
- **Prescription Scanning**: Camera capture + OCR extraction with manual verification
- **Care Groups**: Create family groups, discover members by phone, monitor activity feed
- **Offline Support**: Local caching with intelligent batch sync when connectivity restored
- **Biometric Authentication**: Optional fingerprint/face recognition (expo-local-authentication)

---

## Technology Stack

| **Backend** | Java 21 (LTS), Spring Boot 3.2.5, Spring Security 6.2.4, Spring Data JPA/MongoDB, MySQL 8.0+, MongoDB 6.0+, JWT (JJWT 0.12.6), Maven 3.9.x |
| **Mobile** | React Native 0.81.5, Expo SDK 54, React 19.1, React Navigation 7.x, AsyncStorage 2.2.0, Axios 1.7.9, expo-notifications 0.32.16 |
| **ML Service** | Python 3.10+, FastAPI 0.109, Tesseract OCR, Pillow 10.2, pyzbar 0.1.9, Uvicorn 0.27 |
| **Authentication** | JWT-based stateless auth with Spring Security |
| **Database** | Hybrid: MySQL (relational) + MongoDB (document store) |

---

## System Architecture

### High-Level Architecture
```
Client (Mobile App with Expo)
         ↓ REST API (JSON/HTTPS)
    ┌────────────────┐
    │ Spring Boot    │
    │   Backend      │ 
    ├────────────────┤
    │ 9 Controllers  │
    │ 9 Services     │
    │ 6 Repositories │
    └────────────────┘
         ↙  ↓  ↘
    ┌─────┬─────┬──────────┐
    │    │     │           │
  MySQL  MongoDB  Python FastAPI
(Users,  (Logs,   (OCR, Barcode)
Schedules Activity)
Groups)
```

### Data Flow: Adherence Logging
```
Mobile App: "Take Dose" Click
         ↓
POST /api/adherence/log
         ↓
AdherenceController (JWT validation)
         ↓
AdherenceService
  ├─ Verify schedule exists
  ├─ Decrement stock (if TAKEN)
  ├─ Create AdherenceLog (MongoDB)
  ├─ Create GroupActivity (MongoDB)
  └─ Send push notifications
         ↓
Success Response
```

### Database Schema

**MySQL (Relational)**
```
Users (id, username, password_hash, role, phone)
Medicines (id, name, manufacturer, dosage)
MedicationSchedules (id, user_id, medicine_id, current_stock, is_active)
ScheduleTimes (id, schedule_id, scheduled_time)
CareGroups (id, admin_id, group_name)
GroupMembers (group_id, user_id) [Composite PK]
Prescriptions (id, user_id, image_url, extracted_text, verified)
```

**MongoDB (Document)**
```
AdherenceLogs
  { userId, scheduleId, medicineName, status, timestamp }

GroupActivity
  { groupId, userId, action, timestamp }

OCRMetadata
  { prescriptionId, extracted_text, verified_text, confidence }
```

---

## Project Structure

```
MedScan/
├── backend/                          # Spring Boot 3.2.5
│   ├── src/main/java/com/medscan/backend/
│   │   ├── config/                   # Security, validation configuration
│   │   ├── controller/               # 9 REST controllers (Auth, Schedule, Adherence, etc.)
│   │   ├── service/                  # 9 services (business logic)
│   │   ├── model/                    # 15+ JPA entities
│   │   ├── repository/               # 6 MySQL + 2 MongoDB repositories
│   │   └── security/                 # JWT authentication
│   ├── src/test/java/                # Unit tests
│   └── pom.xml                       # Maven dependencies
│
├── mobile-app/                       # React Native + Expo SDK 54
│   ├── src/
│   │   ├── screens/                  # 13 screens (Login, Dashboard, AddMedicine, etc.)
│   │   ├── components/               # Reusable UI components
│   │   ├── context/                  # AuthContext (global state)
│   │   ├── api/                      # Axios HTTP client
│   │   └── services/                 # OfflineSyncService, NotificationService
│   ├── App.js                        # Navigation root
│   ├── package.json                  # Dependencies
│   └── app.json                      # Expo config
│
├── ml-service/                       # Python FastAPI
│   ├── main.py                       # OCR & barcode endpoints
│   └── requirements.txt              # Python dependencies
│
├── datasets/                         # CSV data files
├── README.md                         # This file
└── PROJECT_DOCUMENTATION.md          # Detailed SRS & design
```

**Backend Services:**
| Service | Responsibility |
|---------|---------------|
| **AuthService** | JWT token generation/validation, user registration |
| **ScheduleService** | Medication schedule CRUD, time management |
| **AdherenceService** | Dose logging, history, stock decrement |
| **GroupService** | Care group creation, member discovery |
| **MedicineService** | Medicine search, database seeding |
| **PushNotificationService** | Expo push notification sending |
| **StatsService** | 7-day adherence calculations |
| **ReportService** | Detailed adherence reports |
| **OcrImprovementService** | User corrections → ML model training |

**Mobile Screens:**
- **Auth Stack**: LoginScreen, RegisterScreen
- **Dashboard Tab**: DashboardScreen (today's meds), AddMedicineScreen, MedicineDetailScreen, EditScheduleScreen
- **History Tab**: HistoryScreen (past 30 days), ReportScreen (7-day analytics)
- **Scanner Tab**: ScanPrescriptionScreen (camera → OCR)
- **Groups Tab**: GroupScreen, AddGroupScreen, GroupDetailsScreen
- **Profile Tab**: ProfileScreen, BiometricGate (fingerprint unlock)

---

## Installation & Setup

### Prerequisites
```bash
java -version        # Java 21+
node --version       # Node 18+
npm --version        # npm 9+
mysql --version      # MySQL 8+
mongod --version     # MongoDB 6+
```

### Backend Setup
```bash
cd backend
# Configure database in src/main/resources/application.properties
mvn clean install
mvn spring-boot:run        # Runs on http://localhost:8080
```

**Database Setup:**
```sql
CREATE DATABASE medscan_db;
CREATE USER 'medscan_user'@'localhost' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON medscan_db.* TO 'medscan_user'@'localhost';
```

### Mobile App Setup
```bash
cd mobile-app
npm install
npx expo start              # Start development server
npx expo start --android    # Launch on emulator
npx expo start --ios        # Launch on iOS simulator
```

### ML Service Setup
```bash
cd ml-service
pip install -r requirements.txt
# Install Tesseract: brew install tesseract (Mac) or apt-get install tesseract-ocr (Linux)
uvicorn main:app --port 8001 --reload
```

---

## API Documentation

### Authentication
```bash
# Register
curl -X POST http://localhost:8080/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"user1","password":"Pass123!","fullName":"John"}'

# Login
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user1","password":"Pass123!"}'
# Response: { "token": "eyJhbGciOiJIUzUxMiJ9...", "userId": 1 }
```

### Medication Schedule
```bash
# Create schedule
curl -X POST http://localhost:8080/api/schedules \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"userId":1,"medicineId":5,"frequencyType":"DAILY","doseAmount":1,"times":["08:00","20:00"]}'

# Get user schedules
curl -X GET http://localhost:8080/api/schedules/1 \
  -H "Authorization: Bearer <token>"
```

### Adherence Tracking
```bash
# Log dose
curl -X POST http://localhost:8080/api/adherence/log \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"scheduleId":1,"status":"TAKEN"}'

# Get adherence history
curl -X GET http://localhost:8080/api/adherence/history/1 \
  -H "Authorization: Bearer <token>"

# Get 7-day stats
curl -X GET "http://localhost:8080/api/stats/user/1?days=7" \
  -H "Authorization: Bearer <token>"
```

### Care Groups
```bash
# Create group
curl -X POST http://localhost:8080/api/groups \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"groupName":"Family","memberPhoneNumbers":["+919876543210"]}'

# Get group activity
curl -X GET http://localhost:8080/api/groups/1/activity \
  -H "Authorization: Bearer <token>"
```

### Prescription OCR
```bash
# Upload prescription
curl -X POST http://localhost:8080/api/prescriptions/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@prescription.jpg"

# Verify extracted text
curl -X POST http://localhost:8080/api/prescriptions/5/verify \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"verifiedText":"Paracetamol 500mg twice daily","medicines":[{"name":"Paracetamol","dosage":"500mg"}]}'
```

---

## Development Workflow

### Backend: Add New Endpoint
1. Create controller method with `@RestController` & `@RequestMapping`
2. Implement business logic in service layer
3. Create generic repository interface
4. Write unit tests (JUnit 5 + Mockito)
5. Add to API documentation
6. Commit: `git commit -m "feat(auth): add OAuth2 support"`

### Mobile: Add New Screen
1. Create screen component in `src/screens/`
2. Add to navigation stack in `App.js`
3. Use Context API for state management
4. Call API via Axios with JWT headers
5. Handle offline with OfflineSyncService
6. Test on emulator: `npx expo start --android`
7. Commit: `git commit -m "feat(screens): add medicine detail view"`

### Git Workflow
```bash
git checkout -b feature/new-feature  # Create branch
git add .
git commit -m "feat: description"    # Semantic commit
git push origin feature/new-feature  # Push
# Create Pull Request on GitHub
```

---

## Key Architectural Patterns

**Design Patterns Used**
- **MVC Pattern**: Controller → Service → Repository
- **Dependency Injection**: Spring @Autowired, Context API
- **JWT Bearer Token**: Stateless authentication
- **Repository Pattern**: Data access abstraction
- **Service Locator**: API client pattern (Axios)
- **Offline-First**: AsyncStorage + batch sync

**Database Design**
- **Normalization**: SQL tables properly normalized (3NF)
- **Denormalization**: MongoDB aggregations for analytics
- **Composite Keys**: GroupMembers(group_id, user_id)
- **Indexes**: Scheduled on userId, medicineId for query optimization

---

## Testing & Quality

**Backend Testing**
- JUnit 5 framework with Mockito
- AdherenceServiceTest validates adherence logic
- Run: `mvn test`

**Mobile Testing**
- Manual testing on Android/iOS emulators
- Critical flows: Login → Schedule → Adherence → Reports
- Run: `npx expo start --clear`

---

## Performance & Scalability

**Current Implementation**
- Single backend instance on Tomcat
- Connection pooling to MySQL & MongoDB
- JWT token caching on mobile

**Future Scaling**
- Spring Cloud Gateway for load balancing
- Kubernetes orchestration (Docker containers)
- Redis caching layer for sessions
- Database replicas for read scaling
- CDN for prescription images

---

## Security Considerations

- **Authentication**: JWT with 30-day expiration
- **Encryption**: HTTPS for all API calls
- **Password**: Bcrypt hashing (Spring Security)
- **Input Validation**: Bean Validation annotations
- **CORS**: Configured for mobile client
- **Sensitive Data**: Passwords never logged

---
