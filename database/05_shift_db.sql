-- ==============================================================================
-- DATABASE: htqlns_shift
-- Phân hệ 3: Quản lý Ca làm việc, Phân ca, Tăng ca (OT) & Đổi ca (Shift Service)
-- Thiết kế theo Wireframe Figma: SCR_SHIFT_01, SCR_OT_01, SCR_OT_02, SCR_ADM_03, SCR_REQ_01
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS htqlns_shift
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE htqlns_shift;

-- 1. Bảng shifts: Danh mục ca làm việc chuẩn (SCR_ADM_03)
CREATE TABLE IF NOT EXISTS shifts (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID ca làm việc',
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã ca (ví dụ: CA-HC, CA-SANG, CA-CHIEU)',
  name VARCHAR(150) NOT NULL COMMENT 'Tên ca làm việc',
  start_time TIME NOT NULL COMMENT 'Giờ bắt đầu ca (HH:mm:ss)',
  end_time TIME NOT NULL COMMENT 'Giờ kết thúc ca (HH:mm:ss)',
  break_minutes INT NOT NULL DEFAULT 60 COMMENT 'Thời gian nghỉ giữa ca (phút)',
  grace_late_minutes INT NOT NULL DEFAULT 15 COMMENT 'Số phút cho phép đi muộn không bị phạt',
  grace_early_minutes INT NOT NULL DEFAULT 0 COMMENT 'Số phút cho phép về sớm',
  working_hours DECIMAL(4,2) NOT NULL DEFAULT 8.00 COMMENT 'Số giờ công chuẩn của ca',
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái ca',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shifts_code (code),
  INDEX idx_shifts_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Danh mục ca làm việc';

-- 2. Bảng shift_assignments: Bảng phân ca làm việc cho nhân viên theo ngày (SCR_SHIFT_01)
CREATE TABLE IF NOT EXISTS shift_assignments (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID phân ca',
  emp_id VARCHAR(36) NOT NULL COMMENT 'ID nhân viên (tham chiếu logic employees.id)',
  shift_id VARCHAR(36) NOT NULL COMMENT 'ID ca làm việc',
  work_date DATE NOT NULL COMMENT 'Ngày làm việc áp dụng',
  note TEXT NULL COMMENT 'Ghi chú phân ca',
  assigned_by VARCHAR(36) NULL COMMENT 'ID người phân ca',
  status ENUM('SCHEDULED', 'SWAPPED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED' COMMENT 'Trạng thái lịch trực',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_work_date (emp_id, work_date),
  INDEX idx_assignments_emp_date (emp_id, work_date),
  INDEX idx_assignments_shift (shift_id),
  CONSTRAINT fk_assignments_shift FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Lịch phân ca nhân viên';

-- 3. Bảng ot_requests: Đơn đăng ký tăng ca (SCR_OT_01, SCR_OT_02, SCR_REQ_01)
CREATE TABLE IF NOT EXISTS ot_requests (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID đơn tăng ca',
  emp_id VARCHAR(36) NOT NULL COMMENT 'ID nhân viên đăng ký OT',
  work_date DATE NOT NULL COMMENT 'Ngày tăng ca',
  start_time TIME NOT NULL COMMENT 'Giờ bắt đầu OT',
  end_time TIME NOT NULL COMMENT 'Giờ kết thúc OT',
  total_hours DECIMAL(4,2) NOT NULL COMMENT 'Tổng số giờ OT đăng ký',
  ot_type ENUM('WEEKDAY', 'WEEKEND', 'HOLIDAY') NOT NULL DEFAULT 'WEEKDAY' COMMENT 'Loại ngày OT (hệ số 1.5 / 2.0 / 3.0)',
  reason TEXT NOT NULL COMMENT 'Lý do / công việc thực hiện khi OT',
  approver_id VARCHAR(36) NULL COMMENT 'ID quản lý duyệt đơn',
  approved_at DATETIME NULL COMMENT 'Thời điểm phê duyệt',
  reject_reason TEXT NULL COMMENT 'Lý do từ chối (nếu có)',
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING' COMMENT 'Trạng thái duyệt đơn',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ot_emp (emp_id),
  INDEX idx_ot_date (work_date),
  INDEX idx_ot_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Đơn đăng ký tăng ca (OT)';

-- 4. Bảng shift_swaps: Yêu cầu đổi ca giữa hai nhân viên
CREATE TABLE IF NOT EXISTS shift_swaps (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID yêu cầu đổi ca',
  requester_emp_id VARCHAR(36) NOT NULL COMMENT 'ID nhân viên xin đổi ca',
  target_emp_id VARCHAR(36) NOT NULL COMMENT 'ID nhân viên nhận đổi ca',
  requester_assignment_id VARCHAR(36) NOT NULL COMMENT 'ID lịch trực của người xin đổi',
  target_assignment_id VARCHAR(36) NOT NULL COMMENT 'ID lịch trực của người nhận đổi',
  reason TEXT NOT NULL COMMENT 'Lý do đổi ca',
  approver_id VARCHAR(36) NULL COMMENT 'ID quản lý duyệt',
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_swaps_requester (requester_emp_id),
  INDEX idx_swaps_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Yêu cầu đổi ca làm việc';

-- 5. Dữ liệu mẫu khởi tạo ban đầu
INSERT INTO shifts (id, code, name, start_time, end_time, break_minutes, grace_late_minutes, grace_early_minutes, working_hours, status)
VALUES
  ('s0000001-0000-0000-0000-000000000001', 'CA-HC', 'Ca Hành Chính (08:00 - 17:30)', '08:00:00', '17:30:00', 90, 15, 0, 8.00, 'ACTIVE'),
  ('s0000001-0000-0000-0000-000000000002', 'CA-SANG', 'Ca Sáng (06:00 - 14:00)', '06:00:00', '14:00:00', 30, 10, 0, 7.50, 'ACTIVE'),
  ('s0000001-0000-0000-0000-000000000003', 'CA-CHIEU', 'Ca Chiều (14:00 - 22:00)', '14:00:00', '22:00:00', 30, 10, 0, 7.50, 'ACTIVE')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Phân ca hành chính mặc định ngày hôm nay (CURDATE) cho 4 nhân sự mẫu
INSERT INTO shift_assignments (id, emp_id, shift_id, work_date, note, assigned_by, status)
VALUES
  ('sa000001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001', 's0000001-0000-0000-0000-000000000001', CURDATE(), 'Phân ca mặc định', 'e0000001-0000-0000-0000-000000000002', 'SCHEDULED'),
  ('sa000001-0000-0000-0000-000000000002', 'e0000001-0000-0000-0000-000000000002', 's0000001-0000-0000-0000-000000000001', CURDATE(), 'Phân ca mặc định', 'e0000001-0000-0000-0000-000000000002', 'SCHEDULED'),
  ('sa000001-0000-0000-0000-000000000003', 'e0000001-0000-0000-0000-000000000003', 's0000001-0000-0000-0000-000000000001', CURDATE(), 'Phân ca mặc định', 'e0000001-0000-0000-0000-000000000002', 'SCHEDULED'),
  ('sa000001-0000-0000-0000-000000000004', 'e0000001-0000-0000-0000-000000000004', 's0000001-0000-0000-0000-000000000001', CURDATE(), 'Phân ca mặc định', 'e0000001-0000-0000-0000-000000000002', 'SCHEDULED')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;