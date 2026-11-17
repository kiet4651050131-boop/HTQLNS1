-- ==============================================================================
-- DATABASE: htqlns_analytics
-- Phân hệ 5: Thống kê Chuyên cần, Năng suất & Cảnh báo Ngưỡng (Analytics Service)
-- Wireframe Figma: SCR_DASH_01, SCR_REP_01
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS htqlns_analytics
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE htqlns_analytics;

CREATE TABLE IF NOT EXISTS alert_thresholds (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  metric_type ENUM('LATE_COUNT_MONTH', 'ABSENT_DAYS_MONTH', 'OT_HOURS_MONTH') NOT NULL,
  threshold_value DECIMAL(6, 2) NOT NULL COMMENT 'Ngưỡng kích hoạt cảnh báo',
  severity ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'WARNING',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  report_month INT NOT NULL,
  report_year INT NOT NULL,
  total_employees INT NOT NULL DEFAULT 0,
  on_time_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00 COMMENT 'Tỷ lệ đi làm đúng giờ (%)',
  total_late_instances INT NOT NULL DEFAULT 0,
  total_leave_days DECIMAL(6, 1) NOT NULL DEFAULT 0.0,
  total_ot_hours DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  total_payroll_cost DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_snapshot_period (report_month, report_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO alert_thresholds (id, code, name, metric_type, threshold_value, severity, is_active)
VALUES
  ('th000001-0000-0000-0000-000000000001', 'TH-LATE-3', 'Cảnh báo đi muộn quá 3 lần/tháng', 'LATE_COUNT_MONTH', 3.00, 'WARNING', TRUE),
  ('th000001-0000-0000-0000-000000000002', 'TH-OT-40', 'Cảnh báo vượt trần 40 giờ OT/tháng (Luật LĐ)', 'OT_HOURS_MONTH', 40.00, 'CRITICAL', TRUE)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;