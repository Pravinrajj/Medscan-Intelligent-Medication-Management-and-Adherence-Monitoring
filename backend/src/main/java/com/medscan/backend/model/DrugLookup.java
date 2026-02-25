package com.medscan.backend.model;

import jakarta.persistence.*;
import lombok.Data;

@Data
@Entity
@Table(name = "drug_lookups", indexes = {
    @Index(name = "idx_drug_name", columnList = "name")
})
public class DrugLookup {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 512)
    private String name;

    private Double price;

    @Column(length = 512)
    private String manufacturer;

    @Column(length = 512)
    private String composition1;

    // Fields from Kaggle medicine_data.csv
    @Column(length = 255)
    private String subCategory;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(columnDefinition = "TEXT")
    private String sideEffects;

    @Column(columnDefinition = "TEXT")
    private String drugInteractions;
}
