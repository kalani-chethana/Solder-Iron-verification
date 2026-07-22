CREATE DATABASE IF NOT EXISTS soldering_iron_validation
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE soldering_iron_validation;

CREATE TABLE IF NOT EXISTS users (
  system_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_code VARCHAR(255) NOT NULL,
  user_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (system_id),
  UNIQUE KEY uq_users_user_code (user_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS solder_irons (
  system_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  iron_code VARCHAR(255) NOT NULL,
  iron_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (system_id),
  UNIQUE KEY uq_solder_irons_iron_code (iron_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS validation_records (
  system_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  iron_id INT UNSIGNED NOT NULL,
  temperature DECIMAL(7,2) NOT NULL,
  unit ENUM('C', 'F') NOT NULL DEFAULT 'F',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (system_id),
  KEY idx_validation_user (user_id),
  KEY idx_validation_iron (iron_id),
  KEY idx_validation_created_at (created_at),
  CONSTRAINT fk_validation_user FOREIGN KEY (user_id)
    REFERENCES users (system_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_validation_iron FOREIGN KEY (iron_id)
    REFERENCES solder_irons (system_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_validation_temperature CHECK (temperature BETWEEN -100 AND 2000)
) ENGINE=InnoDB;

-- Replace or extend these starter records with your real QR and barcode values.
INSERT INTO users (user_code, user_name) VALUES
  ('USER001', 'Test User')
ON DUPLICATE KEY UPDATE user_name = VALUES(user_name);

INSERT INTO solder_irons (iron_code, iron_name) VALUES
  ('IRON001', 'Hakko Iron 1')
ON DUPLICATE KEY UPDATE iron_name = VALUES(iron_name);
