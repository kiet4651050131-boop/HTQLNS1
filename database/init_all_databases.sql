-- ==============================================================================
-- KỊCH BẢN KHỞI TẠO TỔNG HỢP TOÀN BỘ HỆ THỐNG CSDL HTQLNS
-- Kiến trúc Hướng Dịch Vụ (SOA) với MySQL Database riêng biệt cho từng Microservice
-- ==============================================================================

-- 1. Khởi tạo Cơ sở dữ liệu Xác thực & Tài khoản người dùng (htqlns_auth)
SOURCE 01_auth_db.sql;

-- 2. Khởi tạo Cơ sở dữ liệu Cơ cấu Tổ chức & Nhân sự (htqlns_organization)
SOURCE 02_organization_db.sql;

-- 3. Khởi tạo Cơ sở dữ liệu Quản lý Chấm công (htqlns_attendance)
SOURCE 03_attendance_db.sql;

-- 4. Khởi tạo Cơ sở dữ liệu Quản lý Nghỉ phép (htqlns_leave)
SOURCE 04_leave_db.sql;

-- 5. Khởi tạo Cơ sở dữ liệu Ca làm việc & Tăng ca (htqlns_shift)
SOURCE 05_shift_db.sql;

-- 6. Khởi tạo Cơ sở dữ liệu Tính lương & Phúc lợi (htqlns_payroll)
SOURCE 06_payroll_db.sql;

-- 7. Khởi tạo Cơ sở dữ liệu Thông báo hệ thống (htqlns_notification)
SOURCE 07_notification_db.sql;

-- 8. Khởi tạo Cơ sở dữ liệu Thống kê & Báo cáo (htqlns_analytics)
SOURCE 08_analytics_db.sql;
