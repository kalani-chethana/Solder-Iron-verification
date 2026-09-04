CREATE DATABASE IF NOT EXISTS soldering_iron_validation
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE soldering_iron_validation;

-- Soldering Iron Validation System Database Schema
--
-- Note: Both operators (users) and equipment (soldering irons) are queried
-- directly from the TSFS database:
--   - Users: tsfs.tblemployee (EmpNo, InitialWithName, Department, Designation)
--   - Irons: tsfs.tblsheduledserviceitems (ItemNumber, ItemName, SerialNumber, UseDepartment)

-- Temperature Profiles
CREATE TABLE IF NOT EXISTS temperature_profiles (
  profile_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  profile_name VARCHAR(100) NOT NULL,
  department VARCHAR(50) NULL,
  target_temp DECIMAL(7,2) NOT NULL,
  tolerance DECIMAL(7,2) NOT NULL DEFAULT 20.00,
  min_temp DECIMAL(7,2) GENERATED ALWAYS AS (target_temp - tolerance) STORED,
  max_temp DECIMAL(7,2) GENERATED ALWAYS AS (target_temp + tolerance) STORED,
  unit ENUM('C', 'F') NOT NULL DEFAULT 'F',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id),
  UNIQUE KEY uq_profile_name (profile_name)
) ENGINE=InnoDB;

-- Iron Profile Assignment
CREATE TABLE IF NOT EXISTS iron_profiles (
  iron_id INT UNSIGNED NOT NULL,
  profile_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (iron_id),
  CONSTRAINT fk_iron_profile FOREIGN KEY (profile_id)
    REFERENCES temperature_profiles (profile_id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- One immutable measurement per completed validation.
-- user_id references tsfs.tblemployee.sysID.
-- iron_id references tsfs.tblsheduledserviceitems.SysID.
CREATE TABLE IF NOT EXISTS validation_records (
  system_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  iron_id INT UNSIGNED NOT NULL,
  temperature DECIMAL(7,2) NOT NULL,
  target_temp DECIMAL(7,2) NULL,
  tolerance DECIMAL(7,2) NULL,
  unit ENUM('C', 'F') NOT NULL DEFAULT 'F',
  status ENUM('PASS', 'FAIL') NOT NULL DEFAULT 'PASS',
  profile_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (system_id),
  KEY idx_validation_user (user_id),
  KEY idx_validation_iron (iron_id),
  KEY idx_validation_created_at (created_at),
  CONSTRAINT chk_validation_temperature CHECK (temperature BETWEEN -100 AND 2000)
) ENGINE=InnoDB;

-- Starter Temperature Profiles
INSERT INTO temperature_profiles (profile_name, department, target_temp, tolerance, unit) VALUES
  ('Cabling – Normal(20)', 'Cabling', 720.00, 20.00, 'F'),
  ('Calibration-Normal(20)', 'Calibration', 650.00, 20.00, 'F'),
  ('Maintenance-Normal(20)', 'Maintenance', 750.00, 20.00, 'F'),
  ('Process Engineering (20)', 'Process Engineering', 750.00, 20.00, 'F'),
  ('Repair-Normal(20)', 'Repairs', 720.00, 20.00, 'F'),
  ('welding-normal(20)', 'Welding', 720.00, 20.00, 'F'),
  ('Wiring - Normal(20)', 'Wiring', 600.00, 20.00, 'F'),
  ('Engineering - Normal(20)', 'Engineering', 720.00, 20.00, 'F'),
  ('TC0 - Normal(20)', 'TC0', 720.00, 20.00, 'F')
ON DUPLICATE KEY UPDATE target_temp = VALUES(target_temp), tolerance = VALUES(tolerance);
