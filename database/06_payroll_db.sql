-- ==============================================================================
-- DATABASE: htqlns_payroll
-- Phân hệ 4: Tính lương, Chốt kỳ lương & Phiếu lương (Payroll Service)
-- Wireframe Figma: SCR_PAY_01, SCR_ADM_04, SCR_ADM_07
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS htqlns_payroll
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE htqlns_payroll;

-- 1. Cấu hình tham số & công thức lương (SCR_ADM_04)
CREATE TABLE IF NOT EXISTS payroll_configs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  emp_id VARCHAR(36) NOT NULL UNIQUE COMMENT 'ID nhân viên',
  base_salary DECIMAL(15, 2) NOT NULL DEFAULT 15000000.00 COMMENT 'Lương cơ bản theo hợp đồng',
  lunch_allowance DECIMAL(15, 2) NOT NULL DEFAULT 730000.00 COMMENT 'Phụ cấp ăn trưa',
  transport_allowance DECIMAL(15, 2) NOT NULL DEFAULT 500000.00 COMMENT 'Phụ cấp xăng xe/điện thoại',
  insurance_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.1050 COMMENT 'Tỷ lệ trích BHXH/BHYT/BHTN (10.5%)',
  late_penalty_per_minute DECIMAL(10, 2) NOT NULL DEFAULT 2000.00 COMMENT 'Mức khấu trừ mỗi phút đi muộn',
  ot_multiplier_weekday DECIMAL(3, 2) NOT NULL DEFAULT 1.50 COMMENT 'Hệ số lương OT ngày thường',
  ot_multiplier_weekend DECIMAL(3, 2) NOT NULL DEFAULT 2.00 COMMENT 'Hệ số lương OT cuối tuần',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Kỳ lương hàng tháng (SCR_ADM_07)
CREATE TABLE IF NOT EXISTS payroll_periods (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  month INT NOT NULL,
  year INT NOT NULL,
  standard_working_days DECIMAL(4, 1) NOT NULL DEFAULT 22.0 COMMENT 'Số ngày công chuẩn trong tháng',
  status ENUM('OPEN', 'CALCULATED', 'LOCKED', 'PAID') NOT NULL DEFAULT 'OPEN',
  closed_by VARCHAR(36) NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_month_year (month, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Phiếu lương chi tiết từng nhân viên (SCR_PAY_01)
CREATE TABLE IF NOT EXISTS payslips (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  period_id VARCHAR(36) NOT NULL,
  emp_id VARCHAR(36) NOT NULL,
  month INT NOT NULL,
  year INT NOT NULL,
  base_salary DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  standard_days DECIMAL(4, 1) NOT NULL DEFAULT 22.0,
  actual_work_days DECIMAL(4, 1) NOT NULL DEFAULT 0.0,
  paid_leave_days DECIMAL(4, 1) NOT NULL DEFAULT 0.0,
  ot_hours DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  ot_pay DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Tiền lương tăng ca',
  total_allowance DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Tổng phụ cấp',
  gross_salary DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Tổng thu nhập trước khấu trừ',
  insurance_deduction DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Khấu trừ BHXH/BHYT/BHTN',
  late_deduction DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Phạt đi muộn/về sớm',
  tax_deduction DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Thuế TNCN tạm tính',
  net_salary DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Thực lĩnh cuối cùng',
  status ENUM('DRAFT', 'CONFIRMED', 'PAID') NOT NULL DEFAULT 'DRAFT',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_period_emp (period_id, emp_id),
  CONSTRAINT fk_payslip_period FOREIGN KEY (period_id) REFERENCES payroll_periods (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dữ liệu mẫu cấu hình lương cho 4 nhân sự mẫu
INSERT INTO payroll_configs (id, emp_id, base_salary, lunch_allowance, transport_allowance)
VALUES
  ('pc000001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001', 60000000.00, 1000000.00, 1500000.00),
  ('pc000001-0000-0000-0000-000000000002', 'e0000001-0000-0000-0000-000000000002', 25000000.00, 730000.00, 800000.00),
  ('pc000001-0000-0000-0000-000000000003', 'e0000001-0000-0000-0000-000000000003', 32000000.00, 730000.00, 1000000.00),
  ('pc000001-0000-0000-0000-000000000004', 'e0000001-0000-0000-0000-000000000004', 18000000.00, 730000.00, 500000.00)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;