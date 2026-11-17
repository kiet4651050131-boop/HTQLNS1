-- ==============================================================================
-- DATABASE: htqlns_leave
-- Phân hệ 1: Quản lý Nghỉ phép & Quỹ phép năm (Leave Service)
-- Wireframe Figma: SCR_LEAVE_01, SCR_LEAVE_02, SCR_LEAVE_03, SCR_ADM_01, SCR_REQ_01
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS htqlns_leave
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE htqlns_leave;

-- 1. Danh mục loại nghỉ phép (SCR_ADM_01)
CREATE TABLE IF NOT EXISTS leave_types (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã loại phép (AL, SL, UL, ML...)',
  name VARCHAR(150) NOT NULL COMMENT 'Tên loại nghỉ phép',
  is_paid BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Có hưởng lương hay không',
  max_days_per_year DECIMAL(4,1) NOT NULL DEFAULT 12.0 COMMENT 'Số ngày tối đa/năm (0 = không giới hạn)',
  require_attachment BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Yêu cầu giấy tờ minh chứng',
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Quỹ phép năm của từng nhân viên (SCR_LEAVE_01, SCR_LEAVE_03)
CREATE TABLE IF NOT EXISTS leave_balances (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  emp_id VARCHAR(36) NOT NULL,
  leave_type_id VARCHAR(36) NOT NULL,
  year INT NOT NULL,
  total_days DECIMAL(4,1) NOT NULL DEFAULT 12.0 COMMENT 'Tổng ngày phép được cấp',
  used_days DECIMAL(4,1) NOT NULL DEFAULT 0.0 COMMENT 'Số ngày đã nghỉ',
  pending_days DECIMAL(4,1) NOT NULL DEFAULT 0.0 COMMENT 'Số ngày đang chờ duyệt',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_type_year (emp_id, leave_type_id, year),
  CONSTRAINT fk_balance_type FOREIGN KEY (leave_type_id) REFERENCES leave_types (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Đơn xin nghỉ phép (SCR_LEAVE_01, SCR_LEAVE_02, SCR_REQ_01)
CREATE TABLE IF NOT EXISTS leave_requests (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  emp_id VARCHAR(36) NOT NULL,
  leave_type_id VARCHAR(36) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days DECIMAL(4,1) NOT NULL COMMENT 'Số ngày xin nghỉ (hỗ trợ 0.5 ngày)',
  session ENUM('FULL_DAY', 'MORNING', 'AFTERNOON') NOT NULL DEFAULT 'FULL_DAY',
  reason TEXT NOT NULL,
  attachment_url VARCHAR(500) NULL,
  approver_id VARCHAR(36) NULL,
  approved_at DATETIME NULL,
  reject_reason TEXT NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_leave_emp (emp_id),
  INDEX idx_leave_status (status),
  CONSTRAINT fk_leave_type FOREIGN KEY (leave_type_id) REFERENCES leave_types (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dữ liệu mẫu
INSERT INTO leave_types (id, code, name, is_paid, max_days_per_year, require_attachment, status)
VALUES
  ('lt000001-0000-0000-0000-000000000001', 'AL', 'Nghỉ phép năm (Annual Leave)', TRUE, 12.0, FALSE, 'ACTIVE'),
  ('lt000001-0000-0000-0000-000000000002', 'SL', 'Nghỉ ốm hưởng BHXH (Sick Leave)', TRUE, 30.0, TRUE, 'ACTIVE'),
  ('lt000001-0000-0000-0000-000000000003', 'UL', 'Nghỉ không hưởng lương (Unpaid Leave)', FALSE, 0.0, FALSE, 'ACTIVE'),
  ('lt000001-0000-0000-0000-000000000004', 'PL', 'Nghỉ chế độ việc riêng (Hiếu/Hỉ)', TRUE, 3.0, FALSE, 'ACTIVE')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

INSERT INTO leave_balances (id, emp_id, leave_type_id, year, total_days, used_days, pending_days)
VALUES
  ('lb000001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001', 'lt000001-0000-0000-0000-000000000001', YEAR(CURDATE()), 12.0, 0.0, 0.0),
  ('lb000001-0000-0000-0000-000000000002', 'e0000001-0000-0000-0000-000000000002', 'lt000001-0000-0000-0000-000000000001', YEAR(CURDATE()), 12.0, 1.0, 0.0),
  ('lb000001-0000-0000-0000-000000000003', 'e0000001-0000-0000-0000-000000000003', 'lt000001-0000-0000-0000-000000000001', YEAR(CURDATE()), 12.0, 0.0, 0.0),
  ('lb000001-0000-0000-0000-000000000004', 'e0000001-0000-0000-0000-000000000004', 'lt000001-0000-0000-0000-000000000001', YEAR(CURDATE()), 12.0, 2.0, 0.0)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;