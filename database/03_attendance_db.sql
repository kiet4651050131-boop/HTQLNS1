-- ==============================================================================
-- DATABASE: htqlns_attendance
-- Phân hệ 2: Quản lý Chấm công (GPS/WiFi/FaceID) & Giải trình công (Attendance Service)
-- Thiết kế theo Wireframe Figma: SCR_ATT_01, SCR_ATT_02, SCR_ATT_03, SCR_ATT_04, SCR_ADM_02
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS htqlns_attendance
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE htqlns_attendance;

-- 1. Bảng work_locations: Cấu hình tọa độ GPS & WiFi hợp lệ của văn phòng/chi nhánh (SCR_ADM_02)
CREATE TABLE IF NOT EXISTS work_locations (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID điểm chấm công',
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã địa điểm (ví dụ: LOC-HQ, LOC-CN1)',
  name VARCHAR(150) NOT NULL COMMENT 'Tên văn phòng / chi nhánh',
  address TEXT NULL COMMENT 'Địa chỉ thực tế',
  latitude DECIMAL(10, 8) NOT NULL COMMENT 'Vĩ độ GPS trung tâm',
  longitude DECIMAL(11, 8) NOT NULL COMMENT 'Kinh độ GPS trung tâm',
  radius_meters INT NOT NULL DEFAULT 100 COMMENT 'Bán kính Geofence cho phép (mét)',
  wifi_ssid VARCHAR(100) NULL COMMENT 'Tên mạng WiFi công ty (nếu chấm công WiFi)',
  wifi_bssid VARCHAR(100) NULL COMMENT 'Địa chỉ MAC của Router WiFi',
  require_face_id BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Bắt buộc xác thực khuôn mặt hay không',
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_locations_code (code),
  INDEX idx_locations_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Danh sách vùng chấm công hợp lệ';

-- 2. Bảng attendance_logs: Bản ghi chấm công vào/ra hàng ngày của nhân viên (SCR_ATT_01, SCR_ATT_02)
CREATE TABLE IF NOT EXISTS attendance_logs (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID bản ghi công',
  emp_id VARCHAR(36) NOT NULL COMMENT 'ID nhân viên (employees.id)',
  work_date DATE NOT NULL COMMENT 'Ngày làm việc',
  shift_id VARCHAR(36) NULL COMMENT 'ID ca làm việc áp dụng trong ngày',
  location_id VARCHAR(36) NULL COMMENT 'ID địa điểm chấm công khớp',
  check_in_time DATETIME NULL COMMENT 'Thời điểm Check-in thực tế',
  check_in_lat DECIMAL(10, 8) NULL COMMENT 'Vĩ độ lúc Check-in',
  check_in_lng DECIMAL(11, 8) NULL COMMENT 'Kinh độ lúc Check-in',
  check_in_distance_m INT NULL COMMENT 'Khoảng cách tới văn phòng lúc Check-in (mét)',
  check_in_method ENUM('GPS', 'WIFI', 'FACE_ID', 'MANUAL') NOT NULL DEFAULT 'GPS',
  check_out_time DATETIME NULL COMMENT 'Thời điểm Check-out thực tế',
  check_out_lat DECIMAL(10, 8) NULL,
  check_out_lng DECIMAL(11, 8) NULL,
  check_out_distance_m INT NULL,
  check_out_method ENUM('GPS', 'WIFI', 'FACE_ID', 'MANUAL') NULL,
  late_minutes INT NOT NULL DEFAULT 0 COMMENT 'Số phút đi muộn',
  early_leave_minutes INT NOT NULL DEFAULT 0 COMMENT 'Số phút về sớm',
  actual_working_hours DECIMAL(4, 2) NOT NULL DEFAULT 0.00 COMMENT 'Tổng số giờ làm thực tế',
  status ENUM('ON_TIME', 'LATE', 'EARLY_LEAVE', 'LATE_AND_EARLY', 'ABSENT', 'ON_LEAVE') NOT NULL DEFAULT 'ON_TIME' COMMENT 'Trạng thái chuyên cần',
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_att_emp_date (emp_id, work_date),
  INDEX idx_att_emp (emp_id),
  INDEX idx_att_date (work_date),
  INDEX idx_att_status (status),
  CONSTRAINT fk_att_location FOREIGN KEY (location_id) REFERENCES work_locations (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Nhật ký chấm công hàng ngày';

-- 3. Bảng attendance_adjustments: Đơn giải trình chấm công / bổ sung giờ vào ra (SCR_ATT_03, SCR_ATT_04)
CREATE TABLE IF NOT EXISTS attendance_adjustments (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID đơn giải trình',
  emp_id VARCHAR(36) NOT NULL COMMENT 'ID nhân viên gửi giải trình',
  attendance_id VARCHAR(36) NULL COMMENT 'ID bản ghi công liên quan (nếu có)',
  work_date DATE NOT NULL COMMENT 'Ngày cần giải trình công',
  adjustment_type ENUM('FORGOT_CHECK_IN', 'FORGOT_CHECK_OUT', 'GPS_ERROR', 'OTHER') NOT NULL DEFAULT 'FORGOT_CHECK_IN',
  requested_check_in DATETIME NULL COMMENT 'Giờ vào đề xuất ghi nhận',
  requested_check_out DATETIME NULL COMMENT 'Giờ ra đề xuất ghi nhận',
  reason TEXT NOT NULL COMMENT 'Lý do giải trình',
  evidence_url VARCHAR(500) NULL COMMENT 'Ảnh chụp màn hình / minh chứng đính kèm',
  approver_id VARCHAR(36) NULL COMMENT 'ID quản lý duyệt',
  approved_at DATETIME NULL,
  reject_reason TEXT NULL,
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_adj_emp (emp_id),
  INDEX idx_adj_date (work_date),
  INDEX idx_adj_status (status),
  CONSTRAINT fk_adj_attendance FOREIGN KEY (attendance_id) REFERENCES attendance_logs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Đơn giải trình chấm công';

-- 4. Dữ liệu mẫu khởi tạo văn phòng trụ sở chính
INSERT INTO work_locations (id, code, name, address, latitude, longitude, radius_meters, wifi_ssid, require_face_id, status)
VALUES
  ('loc00001-0000-0000-0000-000000000001', 'LOC-HQ', 'Trụ sở chính HTQLNS', '170 An Dương Vương, TP. Quy Nhơn, Bình Định', 13.75914200, 109.21853600, 150, 'HTQLNS_OFFICE_5G', FALSE, 'ACTIVE')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;