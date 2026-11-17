-- ==============================================================================
-- DATABASE: htqlns_auth
-- Phân hệ 6: Quản trị Tài khoản, Xác thực & Phân quyền (Auth Service)
-- Thiết kế theo Wireframe Figma: SCR_AUTH_01, SCR_AUTH_02, SCR_USER_01
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS htqlns_auth
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE htqlns_auth;

-- 1. Bảng users: Lưu thông tin tài khoản người dùng và thông tin xác thực
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'Định danh UUID của tài khoản',
  emp_id VARCHAR(36) NULL COMMENT 'Mã liên kết hồ sơ nhân sự (employees.id)',
  username VARCHAR(100) NOT NULL UNIQUE COMMENT 'Tên đăng nhập hệ thống',
  email VARCHAR(255) NOT NULL UNIQUE COMMENT 'Email liên hệ công việc',
  password_hash VARCHAR(255) NOT NULL COMMENT 'Mật khẩu đã băm (Bcrypt)',
  role ENUM('ADMIN', 'HR', 'MANAGER', 'EMPLOYEE') NOT NULL DEFAULT 'EMPLOYEE' COMMENT 'Vai trò hệ thống chính',
  otp_code VARCHAR(10) NULL COMMENT 'Mã xác thực OTP (quên mật khẩu / 2FA)',
  otp_expires_at DATETIME NULL COMMENT 'Thời hạn hết hạn của mã OTP',
  biometric_enabled BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Bật/tắt xác thực sinh trắc học trên Mobile App',
  last_login_at DATETIME NULL COMMENT 'Thời điểm đăng nhập gần nhất',
  status ENUM('ACTIVE', 'INACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái tài khoản',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_username (username),
  INDEX idx_users_email (email),
  INDEX idx_users_role (role),
  INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Danh sách tài khoản người dùng';

-- 2. Bảng refresh_tokens: Quản lý token cấp phát cho cơ chế Refresh JWT Token
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id VARCHAR(36) NOT NULL PRIMARY KEY COMMENT 'UUID của token',
  user_id VARCHAR(36) NOT NULL COMMENT 'ID người dùng sở hữu token',
  token VARCHAR(500) NOT NULL UNIQUE COMMENT 'Chuỗi Refresh Token',
  expires_at DATETIME NOT NULL COMMENT 'Thời điểm hết hạn token',
  revoked_at DATETIME NULL COMMENT 'Thời điểm token bị thu hồi/đăng xuất',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_refresh_tokens_user (user_id),
  INDEX idx_refresh_tokens_token (token),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Bảng lưu Refresh Token';

-- 3. Dữ liệu mẫu khởi tạo ban đầu (Mật khẩu mặc định: 123456)
-- Hash Bcrypt của '123456': $2b$10$PQamOicewwkn1d/5hgvrAOjqBkFsP0TvODArgghPL5fVmXVvqlvy6
INSERT INTO users (id, emp_id, username, email, password_hash, role, biometric_enabled, status)
VALUES
  ('u0000001-0000-0000-0000-000000000001', 'e0000001-0000-0000-0000-000000000001', 'admin', 'admin@htqlns.com', '$2b$10$PQamOicewwkn1d/5hgvrAOjqBkFsP0TvODArgghPL5fVmXVvqlvy6', 'ADMIN', TRUE, 'ACTIVE'),
  ('u0000001-0000-0000-0000-000000000002', 'e0000001-0000-0000-0000-000000000002', 'hr_admin', 'hr@htqlns.com', '$2b$10$PQamOicewwkn1d/5hgvrAOjqBkFsP0TvODArgghPL5fVmXVvqlvy6', 'HR', FALSE, 'ACTIVE'),
  ('u0000001-0000-0000-0000-000000000003', 'e0000001-0000-0000-0000-000000000003', 'manager', 'manager@htqlns.com', '$2b$10$PQamOicewwkn1d/5hgvrAOjqBkFsP0TvODArgghPL5fVmXVvqlvy6', 'MANAGER', FALSE, 'ACTIVE'),
  ('u0000001-0000-0000-0000-000000000004', 'e0000001-0000-0000-0000-000000000004', 'employee', 'employee@htqlns.com', '$2b$10$PQamOicewwkn1d/5hgvrAOjqBkFsP0TvODArgghPL5fVmXVvqlvy6', 'EMPLOYEE', TRUE, 'ACTIVE')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
