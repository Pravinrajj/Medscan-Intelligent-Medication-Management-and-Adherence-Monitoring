package com.medscan.backend.model;

import jakarta.persistence.*;
import lombok.Data;

@Data
@Entity
@Table(name = "drug_lookups", indexes = {
    @Index(name = "idx_drug_name", columnList = "name"),
    @Index(name = "idx_drug_salt", columnList = "saltName")
})
public class DrugLookup {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Generic / salt name, e.g. "Insulin Isophane (40IU)" */
    @Column(length = 512)
    private String saltName;

    /** Brand / product name, e.g. "Human Insulatard 40IU/ml Suspension for Injection" */
    @Column(length = 512)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    /**
     * Drug interactions as JSON — format:
     * {"drug": ["Benazepril", ...], "brand": ["Apriace", ...], "effect": ["MODERATE", ...]}
     */
    @Column(columnDefinition = "TEXT")
    private String drugInteractions;

    @Column(length = 512)
    private String manufacturer;

    private Double price;

    /** Comma-separated side effects */
    @Column(columnDefinition = "TEXT")
    private String sideEffects;

    /** Therapeutic class, e.g. "Human Insulin Basal" */
    @Column(length = 512)
    private String therapeuticClass;
}
