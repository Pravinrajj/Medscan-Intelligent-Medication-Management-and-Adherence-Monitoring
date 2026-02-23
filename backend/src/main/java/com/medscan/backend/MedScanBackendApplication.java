package com.medscan.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.data.mongodb.repository.config.EnableMongoRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableJpaRepositories(
		basePackages = "com.medscan.backend.repository.mysql"
)
@EnableMongoRepositories(
		basePackages = "com.medscan.backend.repository.mongo"
)

@EnableScheduling
public class MedScanBackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(MedScanBackendApplication.class, args);
	}

}
