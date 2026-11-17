-- ==============================================================================
-- DATABASE: htqlns_organization
-- Phân hệ 6: Quản lý Cơ cấu Tổ chức, Phòng ban & Hồ sơ Nhân sự (Organization Service)
-- Thiết kế theo Wireframe Figma: SCR_ADM_05, SCR_ADM_06, SCR_USER_01
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS htqlns_organization
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE htqlns_organization;

-- 1. Bảng departments: Quản lý cây cơ cấu phòng ban, đơn vị trong doanh nghiệp
CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID phòng ban',
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã phòng ban (ví dụ: PB-BGD, PB-HR, PB-TECH)',
  name VARCHAR(150) NOT NULL COMMENT 'Tên đầy đủ của phòng ban',
  description TEXT NULL COMMENT 'Mô tả chức năng nhiệm vụ',
  manager_id VARCHAR(36) NULL COMMENT 'Mã nhân sự trưởng phòng (employees.id)',
  parent_id VARCHAR(36) NULL COMMENT 'Phòng ban cấp trên (nếu là phòng ban con)',
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái hoạt động',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_departments_code (code),
  INDEX idx_departments_parent (parent_id),
  INDEX idx_departments_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Danh mục phòng ban cơ cấu tổ chức';

-- 2. Bảng positions: Danh mục chức danh, vị trí việc làm và khung lương cơ sở
CREATE TABLE IF NOT EXISTS positions (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID chức vụ',
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã chức danh (ví dụ: POS-CEO, POS-HRM, POS-DEV)',
  title VARCHAR(150) NOT NULL COMMENT 'Tên chức danh công việc',
  department_id VARCHAR(36) NULL COMMENT 'Phòng ban trực thuộc',
  base_salary_min DECIMAL(15,2) NOT NULL DEFAULT 0.00 COMMENT 'Mức lương cơ sở tối thiểu',
  base_salary_max DECIMAL(15,2) NOT NULL DEFAULT 0.00 COMMENT 'Mức lương cơ sở tối đa',
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái chức vụ',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_positions_code (code),
  INDEX idx_positions_department (department_id),
  CONSTRAINT fk_positions_department FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Danh mục chức danh công việc';

-- 3. Bảng employees: Hồ sơ nhân sự chi tiết
CREATE TABLE IF NOT EXISTS employees (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID nhân sự',
  code VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã số nhân viên (ví dụ: EMP001, NV-2026-001)',
  full_name VARCHAR(150) NOT NULL COMMENT 'Họ và tên nhân viên',
  email VARCHAR(255) NOT NULL UNIQUE COMMENT 'Email công ty',
  phone VARCHAR(20) NULL COMMENT 'Số điện thoại liên lạc',
  identity_card VARCHAR(25) NULL COMMENT 'Số CMND/CCCD',
  date_of_birth DATE NULL COMMENT 'Ngày sinh',
  gender ENUM('MALE', 'FEMALE', 'OTHER') NOT NULL DEFAULT 'MALE' COMMENT 'Giới tính',
  address TEXT NULL COMMENT 'Địa chỉ thường trú',
  avatar_url VARCHAR(500) NULL COMMENT 'Đường dẫn ảnh đại diện',
  department_id VARCHAR(36) NULL COMMENT 'Phòng ban làm việc',
  position_id VARCHAR(36) NULL COMMENT 'Chức danh đảm nhiệm',
  manager_id VARCHAR(36) NULL COMMENT 'Mã người quản lý trực tiếp (employees.id)',
  join_date DATE NOT NULL COMMENT 'Ngày bắt đầu vào công ty',
  contract_type ENUM('PROBATION', 'OFFICIAL', 'PARTTIME', 'INTERN') NOT NULL DEFAULT 'OFFICIAL' COMMENT 'Loại hợp đồng lao động',
  status ENUM('ACTIVE', 'ON_LEAVE', 'RESIGNED') NOT NULL DEFAULT 'ACTIVE' COMMENT 'Tình trạng nhân sự',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employees_code (code),
  INDEX idx_employees_email (email),
  INDEX idx_employees_department (department_id),
  INDEX idx_employees_position (position_id),
  INDEX idx_employees_manager (manager_id),
  INDEX idx_employees_status (status),
  CONSTRAINT fk_employees_department FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL,
  CONSTRAINT fk_employees_position FOREIGN KEY (position_id) REFERENCES positions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Hồ sơ nhân sự công ty';

-- Thiết lập khóa ngoại manager_id của departments tham chiếu ngược tới employees (sau khi đã có bảng employees)
ALTER TABLE departments
  ADD CONSTRAINT fk_departments_manager FOREIGN KEY (manager_id) REFERENCES employees (id) ON DELETE SET NULL;

-- 4. Bảng audit_logs: Nhật ký kiểm toán thao tác hệ thống
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'UUID bản ghi nhật ký',
  action VARCHAR(100) NOT NULL COMMENT 'Hành động thực hiện (CREATE, UPDATE, DELETE, LOGIN...)',
  actor_id VARCHAR(36) NULL COMMENT 'ID người thực hiện',
  actor_name VARCHAR(150) NULL COMMENT 'Tên người thực hiện',
  resource VARCHAR(100) NOT NULL COMMENT 'Tài nguyên bị tác động (EMPLOYEE, DEPARTMENT...)',
  resource_id VARCHAR(36) NULL COMMENT 'ID tài nguyên',
  details JSON NULL COMMENT 'Chi tiết thay đổi dạng JSON',
  ip_address VARCHAR(50) NULL COMMENT 'Địa chỉ IP người thực hiện',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor (actor_id),
  INDEX idx_audit_resource (resource),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Nhật ký thao tác hệ thống';

-- 5. Dữ liệu mẫu khởi tạo ban đầu (Phòng ban & Chức danh)
INSERT INTO departments (id, code, name, description, status)
VALUES
  ('d0000001-0000-0000-0000-000000000001', 'PB-BGD', 'Ban Giám Đốc', 'Cấp lãnh đạo và điều hành chiến lược', 'ACTIVE'),
  ('d0000001-0000-0000-0000-000000000002', 'PB-HR', 'Phòng Hành chính Nhân sự', 'Quản trị nhân sự, tuyển dụng, tính lương và chế độ', 'ACTIVE'),
  ('d0000001-0000-0000-0000-000000000003', 'PB-TECH', 'Phòng Công nghệ & Phần mềm', 'Phát triển các giải pháp phần mềm và hạ tầng số', 'ACTIVE'),
  ('d0000001-0000-0000-0000-000000000004', 'PB-SALES', 'Phòng Kinh doanh & Marketing', 'Phát triển khách hàng và mở rộng thị trường', 'ACTIVE')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

INSERT INTO positions (id, code, title, department_id, base_salary_min, base_salary_max, status)
VALUES
  ('p0000001-0000-0000-0000-000000000001', 'POS-CEO', 'Tổng Giám Đốc Điều Hành', 'd0000001-0000-0000-0000-000000000001', 50000000.00, 100000000.00, 'ACTIVE'),
  ('p0000001-0000-0000-0000-000000000002', 'POS-HRM', 'Trưởng Phòng Nhân Sự', 'd0000001-0000-0000-0000-000000000002', 20000000.00, 35000000.00, 'ACTIVE'),
  ('p0000001-0000-0000-0000-000000000003', 'POS-LEAD', 'Trưởng Nhóm Kỹ Thuật (Tech Lead)', 'd0000001-0000-0000-0000-000000000003', 25000000.00, 45000000.00, 'ACTIVE'),
  ('p0000001-0000-0000-0000-000000000004', 'POS-DEV', 'Kỹ Sư Lập Trình Phần Mềm', 'd0000001-0000-0000-0000-000000000003', 12000000.00, 25000000.00, 'ACTIVE')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Khởi tạo 4 nhân sự tương ứng với 4 tài khoản trong htqlns_auth
INSERT INTO employees (id, code, full_name, email, phone, gender, department_id, position_id, join_date, contract_type, status)
VALUES
  ('e0000001-0000-0000-0000-000000000001', 'EMP001', 'Nguyễn Quản Trị (Admin)', 'admin@htqlns.com', '0901000001', 'MALE', 'd0000001-0000-0000-0000-000000000001', 'p0000001-0000-0000-0000-000000000001', '2023-01-01', 'OFFICIAL', 'ACTIVE'),
  ('e0000001-0000-0000-0000-000000000002', 'EMP002', 'Trần Thị Thu Hà (HR Manager)', 'hr@htqlns.com', '0901000002', 'FEMALE', 'd0000001-0000-0000-0000-000000000002', 'p0000001-0000-0000-0000-000000000002', '2023-02-15', 'OFFICIAL', 'ACTIVE'),
  ('e0000001-0000-0000-0000-000000000003', 'EMP003', 'Lê Hoàng Nam (Tech Lead)', 'manager@htqlns.com', '0901000003', 'MALE', 'd0000001-0000-0000-0000-000000000003', 'p0000001-0000-0000-0000-000000000003', '2023-03-01', 'OFFICIAL', 'ACTIVE'),
  ('e0000001-0000-0000-0000-000000000004', 'EMP004', 'Nguyễn Văn An (Developer)', 'employee@htqlns.com', '0901000004', 'MALE', 'd0000001-0000-0000-0000-000000000003', 'p0000001-0000-0000-0000-000000000004', '2024-01-10', 'OFFICIAL', 'ACTIVE')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Cập nhật trưởng phòng cho các phòng ban
UPDATE departments SET manager_id = 'e0000001-0000-0000-0000-000000000001' WHERE code = 'PB-BGD';
UPDATE departments SET manager_id = 'e0000001-0000-0000-0000-000000000002' WHERE code = 'PB-HR';
UPDATE departments SET manager_id = 'e0000001-0000-0000-0000-000000000003' WHERE code = 'PB-TECH';
