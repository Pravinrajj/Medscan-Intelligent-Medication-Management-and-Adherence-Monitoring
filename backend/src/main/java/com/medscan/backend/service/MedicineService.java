package com.medscan.backend.service;

import com.medscan.backend.model.Medicine;
import com.medscan.backend.repository.mysql.MedicineRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class MedicineService implements CommandLineRunner {

    @Autowired
    private MedicineRepository medicineRepository;

    public List<Medicine> searchMedicines(String query) {
        return medicineRepository.findByNameContainingIgnoreCase(query);
    }

    public Medicine saveMedicine(Medicine medicine) {
        // Find-or-create: avoid duplicates by name
        Medicine existing = medicineRepository.findByNameIgnoreCase(medicine.getName());
        if (existing != null) {
            return existing;
        }
        return medicineRepository.save(medicine);
    }

    public Medicine getMedicineById(Long id) {
        return medicineRepository.findById(id).orElse(null);
    }

    /**
     * Seed initial medicines on startup if the table is empty.
     */
    @Override
    public void run(String... args) throws Exception {
        if (medicineRepository.count() == 0) {
            seedMedicines();
            System.out.println("Seeded " + medicineRepository.count() + " medicines.");
        }
    }

    private void seedMedicines() {
        String[][] seedData = {
            {"Paracetamol", "GSK", "TABLET", "500mg", "Analgesic and antipyretic for pain and fever relief"},
            {"Amoxicillin", "Cipla", "TABLET", "250mg", "Broad-spectrum antibiotic for bacterial infections"},
            {"Ibuprofen", "Abbott", "TABLET", "400mg", "NSAID for pain, inflammation, and fever"},
            {"Metformin", "Sun Pharma", "TABLET", "500mg", "Oral anti-diabetic for Type 2 diabetes"},
            {"Amlodipine", "Pfizer", "TABLET", "5mg", "Calcium channel blocker for hypertension"},
            {"Omeprazole", "AstraZeneca", "TABLET", "20mg", "Proton pump inhibitor for acid reflux"},
            {"Cetirizine", "Dr. Reddy's", "TABLET", "10mg", "Antihistamine for allergies"},
            {"Azithromycin", "Zydus", "TABLET", "500mg", "Macrolide antibiotic for respiratory infections"},
            {"Losartan", "Merck", "TABLET", "50mg", "ARB for hypertension and kidney protection"},
            {"Atorvastatin", "Pfizer", "TABLET", "10mg", "Statin for cholesterol management"},
            {"Cough Syrup DM", "Bayer", "SYRUP", "15mg/5ml", "Dextromethorphan cough suppressant"},
            {"Insulin Glargine", "Sanofi", "INJECTION", "100U/ml", "Long-acting insulin for diabetes"},
            {"Salbutamol Inhaler", "Cipla", "OTHER", "100mcg", "Bronchodilator for asthma relief"},
            {"Vitamin D3", "HealthKart", "TABLET", "60000IU", "Cholecalciferol supplement"},
            {"Aspirin", "Bayer", "TABLET", "75mg", "Antiplatelet for cardiovascular protection"},
        };

        for (String[] row : seedData) {
            Medicine m = new Medicine();
            m.setName(row[0]);
            m.setManufacturer(row[1]);
            m.setType(Medicine.MedicineType.valueOf(row[2]));
            m.setDosageStrength(row[3]);
            m.setDescription(row[4]);
            medicineRepository.save(m);
        }
    }
}
