/**
 * shared/service-base.js
 * Wrapper tiêu chuẩn cho tất cả các Microservices Express.js trong hệ thống SOA HTQLNS
 * Đóng gói sẵn: JSON parser, CORS, Request Logging, Health check (/health), Error Handler và Security
 */

const express = require('express');
const crypto = require('crypto');
const env = require('./env');
const jwt = require('./jwt');

/**
 * Khởi tạo một Express app chuẩn hóa cho Microservice
 * @param {string} serviceName - Tên định danh của service (ví dụ: 'auth-service')
 * @param {object} [options] - Cấu hình mở rộng
 * @returns {express.Application} Đối tượng Express app đã cấu hình đầy đủ
 */
function createServiceApp(serviceName = 'service', options = {}) {
  const app = express();

  // 1. Gắn Request ID để truy vết phân tán xuyên suốt các service
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });

  // 2. Cấu hình CORS (Cross-Origin Resource Sharing)
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', options.corsOrigin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-internal-key, x-request-id');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // 3. Cấu hình Middleware phân tích nội dung Request Body
  app.use(express.json({ limit: options.bodyLimit || '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: options.bodyLimit || '10mb' }));

  // Only accept the identity forwarded by the Gateway when it carries the internal key.
  app.use((req, res, next) => {
    const forwardedUser = req.headers['x-user'];
    if (!forwardedUser) return next();

    if (req.headers['x-internal-key'] !== env.INTERNAL_API_KEY) {
      return res.status(403).json({
        success: false,
        error: 'Thông tin người dùng chuyển tiếp chỉ được chấp nhận từ API Gateway',
        code: 403
      });
    }

    try {
      const user = JSON.parse(Buffer.from(forwardedUser, 'base64').toString('utf8'));
      if (!user || typeof user !== 'object' || Array.isArray(user)) {
        throw new Error('Dữ liệu người dùng không hợp lệ');
      }
      req.user = user;
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: `Thông tin người dùng chuyển tiếp không hợp lệ: ${err.message}`,
        code: 401
      });
    }

    next();
  });

  // 4. Request Logging Middleware (Ghi nhật ký thời gian xử lý yêu cầu)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : status >= 300 ? '\x1b[36m' : '\x1b[32m';
      const reset = '\x1b[0m';
      console.log(`[${new Date().toISOString()}] [${serviceName}] ${req.method} ${req.originalUrl || req.url} ${color}${status}${reset} - ${duration}ms (reqId: ${req.id})`);
    });
    next();
  });

  // 5. Health Check Endpoint chuẩn SOA
  app.get('/health', async (req, res) => {
    let dbStatus = 'SKIPPED';
    if (typeof options.checkHealth === 'function') {
      try {
        dbStatus = (await options.checkHealth()) ? 'UP' : 'DOWN';
      } catch {
        dbStatus = 'DOWN';
      }
    }

    const isHealthy = dbStatus !== 'DOWN';
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'UP' : 'DOWN',
      service: serviceName,
      port: options.port || env.PORT,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: dbStatus,
      env: env.NODE_ENV
    });
  });

  /**
   * Phương thức gắn bộ xử lý lỗi và 404 chuẩn (nên gọi sau khi định nghĩa tất cả routes)
   */
  app.useErrorHandler = function () {
    // 404 Route Not Found
    app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: `Không tìm thấy tài nguyên: ${req.method} ${req.originalUrl || req.url}`,
        code: 404
      });
    });

    // Global Error Handler
    app.use((err, req, res, next) => {
      const statusCode = err.status || err.statusCode || 500;
      console.error(`[${serviceName}] [ERROR]`, err.stack || err.message);

      res.status(statusCode).json({
        success: false,
        error: err.message || 'Lỗi máy chủ nội bộ',
        code: statusCode,
        ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {})
      });
    });
  };

  /**
   * Phương thức khởi động server dễ dàng kèm in thông tin banner
   */
  app.start = function (port, callback) {
    const listenPort = port || options.port || env.PORT;
    const server = app.listen(listenPort, () => {
      console.log(`\n======================================================`);
      console.log(`  🚀 [${serviceName.toUpperCase()}] ĐANG CHẠY TRÊN CỔNG :${listenPort}`);
      console.log(`  🔗 Health Check: http://localhost:${listenPort}/health`);
      console.log(`  📅 Khởi chạy lúc: ${new Date().toLocaleString('vi-VN')}`);
      console.log(`======================================================\n`);
      if (typeof callback === 'function') callback(server);
    });
    return server;
  };

  return app;
}

/**
 * Middleware xác thực bảo mật nội bộ giữa các microservice (Internal API Key)
 */
function requireInternalKey(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== env.INTERNAL_API_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Truy cập bị từ chối: Yêu cầu khóa nội bộ hợp lệ (x-internal-key)',
      code: 403
    });
  }
  next();
}

/**
 * Middleware xác thực JWT Token cho các API cần đăng nhập
 * @param {Array<string>} [allowedRoles] - Danh sách quyền được phép truy cập
 */
function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    // 1. Giải mã thông tin x-user chuyển tiếp từ API Gateway
    if (!req.user && req.headers['x-user']) {
      try {
        req.user = JSON.parse(Buffer.from(req.headers['x-user'], 'base64').toString('utf8'));
      } catch {}
    }

    // 2. Kiểm tra header Authorization nếu chưa có req.user
    if (!req.user) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Chưa đăng nhập hoặc thiếu Bearer Token',
          code: 401
        });
      }

      const token = authHeader.slice(7).trim();
      try {
        const payload = jwt.verifyToken(token);
        req.user = payload;
      } catch (err) {
        return res.status(401).json({
          success: false,
          error: `Token không hợp lệ: ${err.message}`,
          code: 401
        });
      }
    }

    if (allowedRoles.length > 0) {
      const userRole = req.user.role;
      if (!userRole || (!allowedRoles.includes(userRole) && !allowedRoles.includes('*'))) {
        return res.status(403).json({
          success: false,
          error: `Bạn không có quyền thực hiện hành động này. Yêu cầu một trong các quyền: [${allowedRoles.join(', ')}]`,
          code: 403
        });
      }
    }

    next();
  };
}

module.exports = {
  createServiceApp,
  requireInternalKey,
  requireAuth
};
