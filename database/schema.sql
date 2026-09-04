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

-- One immutable measurement per completed validation.
-- user_id references tsfs.tblemployee.sysID.
-- iron_id references tsfs.tblsheduledserviceitems.SysID.
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
  CONSTRAINT chk_validation_temperature CHECK (temperature BETWEEN -100 AND 2000)
) ENGINE=InnoDB;
