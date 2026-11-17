/**
 * shared/env.js
 * Quản lý và nạp biến môi trường cho toàn bộ hệ thống SOA HTQLNS
 */

const fs = require('fs');
const path = require('path');

// Tự động tìm và nạp file .env từ thư mục gốc dự án
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
      } else {
        // Fallback đọc file thủ công cho các phiên bản cũ hơn
        const envContent = fs.readFileSync(envPath, 'utf8');
        for (const line of envContent.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (!(key in process.env)) {
              process.env[key] = val;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[ENV] Không thể tự động nạp file .env:', err.message);
    }
  }
}

// Gọi hàm nạp ngay khi module được import
loadEnv();

/**
 * Cấu hình tập trung biến môi trường
 */
const env = {
  // Môi trường & Cổng
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Cấu hình Cơ sở dữ liệu MySQL
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '3306', 10),
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
  DB_NAME: process.env.DB_NAME || 'htqlns_auth',
  DB_CONNECTION_LIMIT: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),

  AUTH_DB_NAME: process.env.AUTH_DB_NAME || process.env.DB_NAME || 'htqlns_auth',
  ORGANIZATION_DB_NAME: process.env.ORGANIZATION_DB_NAME || 'htqlns_organization',
  ATTENDANCE_DB_NAME: process.env.ATTENDANCE_DB_NAME || 'htqlns_attendance',
  LEAVE_DB_NAME: process.env.LEAVE_DB_NAME || 'htqlns_leave',
  SHIFT_DB_NAME: process.env.SHIFT_DB_NAME || 'htqlns_shift',
  PAYROLL_DB_NAME: process.env.PAYROLL_DB_NAME || 'htqlns_payroll',
  NOTIFICATION_DB_NAME: process.env.NOTIFICATION_DB_NAME || 'htqlns_notification',
  ANALYTICS_DB_NAME: process.env.ANALYTICS_DB_NAME || 'htqlns_analytics',

  // Cấu hình JWT
  JWT_SECRET: process.env.JWT_SECRET || 'htqlns_super_secret_jwt_key_community_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',

  // Hạ tầng SOA (Gateway, Registry, Event Bus)
  GATEWAY_URL: process.env.GATEWAY_URL || 'http://localhost:3000',
  REGISTRY_URL: process.env.REGISTRY_URL || 'http://localhost:3500',
  EVENT_BUS_URL: process.env.EVENT_BUS_URL || 'http://localhost:3600',

  // Khóa bảo mật nội bộ giao tiếp giữa các service
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY || 'htqlns_internal_secret_token_2026',

  // Tài khoản Admin khởi tạo
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '123456',

  /**
   * Lấy giá trị biến môi trường theo key kèm fallback
   */
  get(key, defaultValue = null) {
    return process.env[key] !== undefined ? process.env[key] : defaultValue;
  },

  /**
   * Kiểm tra xem đang chạy trong môi trường production không
   */
  isProduction() {
    return this.NODE_ENV === 'production';
  }
};

module.exports = env;
