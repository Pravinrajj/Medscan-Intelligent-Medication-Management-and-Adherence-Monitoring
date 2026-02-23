package com.medscan.backend.service;

import com.medscan.backend.model.DrugLookup;
import com.medscan.backend.repository.mysql.DrugLookupRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Imports medicine data from the Kaggle medicine_data.csv on first startup.
 * This dataset contains ~195K records with rich info:
 *   sub_category, product_name, salt_composition, product_price,
 *   product_manufactured, medicine_desc, side_effects, drug_interactions
 *
 * This is the sole data source for the drug_lookups table.
 */
@Service
@Order(1)
public class DataImportService implements CommandLineRunner {

    @Autowired
    private DrugLookupRepository drugLookupRepository;

    private static final String KAGGLE_CSV_PATH = "d:/MedScan/medicine_data.csv";

    @Override
    public void run(String... args) throws Exception {
        long count = drugLookupRepository.count();
        if (count > 0) {
            System.out.println("[DataImport] drug_lookups already has " + count + " records, skipping import.");
            return;
        }
        System.out.println("[DataImport] Starting Kaggle CSV import...");
        importKaggleDataset();
        System.out.println("[DataImport] Import complete. Total records: " + drugLookupRepository.count());
    }

    private void importKaggleDataset() {
        File file = new File(KAGGLE_CSV_PATH);
        if (!file.exists()) {
            System.out.println("[DataImport] Kaggle CSV not found at: " + KAGGLE_CSV_PATH);
            return;
        }

        System.out.println("[DataImport] Importing Kaggle medicine dataset...");
        int imported = 0;
        int skipped = 0;
        List<DrugLookup> batch = new ArrayList<>(500);

        try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String header = br.readLine(); // Skip header
            if (header == null) return;

            String line;
            while ((line = br.readLine()) != null) {
                try {
                    String[] cols = parseCsvLine(line);
                    // Kaggle cols: sub_category, product_name, salt_composition, product_price,
                    //              product_manufactured, medicine_desc, side_effects, drug_interactions
                    if (cols.length < 5) {
                        skipped++;
                        continue;
                    }

                    String productName = clean(cols[1]);
                    if (productName == null || productName.isEmpty()) {
                        skipped++;
                        continue;
                    }

                    DrugLookup dl = new DrugLookup();
                    dl.setName(productName);
                    dl.setSubCategory(truncate(clean(cols[0]), 255));
                    dl.setComposition1(truncate(clean(cols[2]), 512));
                    try {
                        String priceStr = clean(cols[3]);
                        if (priceStr != null) {
                            dl.setPrice(Double.parseDouble(priceStr.replaceAll("[^0-9.]", "")));
                        }
                    } catch (Exception e) { dl.setPrice(null); }
                    dl.setManufacturer(truncate(clean(cols[4]), 512));
                    if (cols.length > 5) dl.setDescription(clean(cols[5]));
                    if (cols.length > 6) dl.setSideEffects(clean(cols[6]));
                    if (cols.length > 7) dl.setDrugInteractions(clean(cols[7]));

                    batch.add(dl);
                    imported++;

                    if (batch.size() >= 500) {
                        drugLookupRepository.saveAll(batch);
                        batch.clear();
                        if (imported % 10000 == 0) {
                            System.out.println("[DataImport] Progress: " + imported + " records imported...");
                        }
                    }
                } catch (Exception e) {
                    skipped++;
                }
            }

            if (!batch.isEmpty()) {
                drugLookupRepository.saveAll(batch);
            }
        } catch (IOException e) {
            System.err.println("[DataImport] Error reading Kaggle CSV: " + e.getMessage());
        }

        System.out.println("[DataImport] Kaggle import: " + imported + " records imported, " + skipped + " skipped.");
    }

    /**
     * Simple CSV parser that handles quoted fields with commas inside.
     */
    private String[] parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                if (inQuotes && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    current.append('"');
                    i++; // Skip escaped quote
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c == ',' && !inQuotes) {
                fields.add(current.toString());
                current = new StringBuilder();
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString());
        return fields.toArray(new String[0]);
    }

    private String clean(String val) {
        if (val == null) return null;
        val = val.trim();
        if (val.isEmpty() || val.equalsIgnoreCase("null") || val.equalsIgnoreCase("nan")) return null;
        return val;
    }

    private String truncate(String val, int maxLen) {
        if (val == null) return null;
        return val.length() > maxLen ? val.substring(0, maxLen) : val;
    }
}
