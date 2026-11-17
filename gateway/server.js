/**
 * gateway/server.js
 * API Gateway – Cổng vào duy nhất của Hệ thống HTQLNS
 * Đảm nhiệm:
 *  - Định tuyến thông minh /api/* tới các Microservice dựa trên Service Discovery (Registry)
 *  - Thực thi Chính sách bảo mật (config/policies.json): JWT Authentication, RBAC, Rate Limiting, CORS
 *  - Tổng hợp tài liệu OpenAPI, giám sát dịch vụ (/api/system/*)
 *  - Phục vụ giao diện người dùng tĩnh (public/)
 */

require('../shared/env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../shared/env');
const { readBody, readJson, send } = require('../shared/httpx');
const jwt = require('../shared/jwt');
const { serviceClient } = require('../shared/client');
const { registerService } = require('../shared/registrar');
const log = require('../shared/log')('api-gateway');

const PORT = Number(process.env.GATEWAY_PORT || process.env.PORT || 3000);
const POLICY_FILE = process.env.POLICY_FILE || path.resolve(__dirname, '..', 'config', 'policies.json');
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// 1. Quản lý chính sách Gateway (tự động nạp lại khi file thay đổi)
let policies = null;

function loadPolicies() {
  try {
    if (fs.existsSync(POLICY_FILE)) {
      const raw = fs.readFileSync(POLICY_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.routes)) {
        policies = parsed;
        log.info(`Đã nạp chính sách Gateway (${parsed.routes.length} routes)`);
        return;
      }
    }
  } catch (err) {
    log.error('Lỗi phân tích cú pháp policies.json:', err.message);
  }

  // Fallback cấu hình mặc định tối thiểu nếu chưa có file
  if (!policies) {
    policies = {
      routes: [],
      limits: { bodyBytes: 10485760, global: { windowMs: 60000, max: 1000 } },
      cors: { origins: ['*'] }
    };
  }
}

loadPolicies();
try {
  fs.watchFile(POLICY_FILE, { interval: 2000 }, loadPolicies);
} catch {
  // Bỏ qua nếu fs.watchFile không hỗ trợ trên hệ điều hành này
}

// 2. Tìm kiếm Route và Quy tắc phù hợp nhất
function findMatchingRoute(pathname) {
  if (!policies || !Array.isArray(policies.routes)) return null;
  let bestMatch = null;

  for (const route of policies.routes) {
    const prefix = route.prefix;
    if (pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
      if (!bestMatch || prefix.length > bestMatch.prefix.length) {
        bestMatch = route;
      }
    }
  }
  return bestMatch;
}

function findMatchingRule(route, method) {
  if (!route || !Array.isArray(route.rules)) return null;
  return route.rules.find((r) => r.methods.includes('*') || r.methods.includes(method));
}

// 3. Cơ chế Rate Limiting (Cửa sổ cố định trong bộ nhớ)
const rateLimitBuckets = new Map();

function checkRateLimit(key, limitConfig) {
  if (!limitConfig || !limitConfig.max) return { ok: true };

  const now = Date.now();
  const windowMs = limitConfig.windowMs || 60000;
  const max = limitConfig.max;

  let bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateLimitBuckets.set(key, bucket);
  }

  bucket.count++;
  const remaining = Math.max(0, max - bucket.count);
  const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);

  return {
    ok: bucket.count <= max,
    count: bucket.count,
    remaining,
    retryAfter
  };
}

// Định kỳ dọn dẹp các bucket đã hết hạn
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}, 60000).unref();

// 4. Xử lý xác thực Token (JWT Authentication)
function extractAndVerifyUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return { error: 'Yêu cầu đăng nhập (Thiếu header Authorization)', statusCode: 401 };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { error: 'Định dạng token không hợp lệ (Yêu cầu Bearer <token>)', statusCode: 401 };
  }

  try {
    const token = parts[1];
    const payload = jwt.verifyToken(token, env.JWT_SECRET);
    return { user: payload };
  } catch (err) {
    return { error: `Token không hợp lệ hoặc đã hết hạn: ${err.message}`, statusCode: 401 };
  }
}

// 5. Cấu hình Headers CORS
function getCorsHeaders(req) {
  const allowedOrigins = policies?.cors?.origins || ['*'];
  const requestOrigin = req.headers.origin;

  let allowOrigin = '*';
  if (allowedOrigins.includes('*')) {
    allowOrigin = '*';
  } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    allowOrigin = requestOrigin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-request-id, x-internal-key',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  };
}

// 6. Phục vụ tài nguyên tĩnh (public/ HTML, CSS, JS, Ảnh)
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStaticFile(req, res, pathname) {
  let relativePath = decodeURIComponent(pathname);
  if (relativePath === '/' || relativePath === '') {
    relativePath = '/index.html';
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  // Chống Directory Traversal (an toàn trên cả Windows lẫn Linux)
  const safePublic = path.resolve(PUBLIC_DIR).toLowerCase();
  const safePath = path.normalize(filePath).toLowerCase();
  if (!safePath.startsWith(safePublic)) {
    return send(res, 403, { success: false, error: 'Truy cập bị từ chối' });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // Nếu không tìm thấy file và yêu cầu không có đuôi mở rộng, fallback về index.html
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath) && !path.extname(relativePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexPath).pipe(res);
    }
    return send(res, 404, { success: false, error: 'Không tìm thấy tài nguyên giao diện' });
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=3600'
  });
  fs.createReadStream(filePath).pipe(res);
}

// 7. Tổng hợp tài liệu OpenAPI từ các Service
async function handleApiDocs(req, res) {
  try {
    const regRes = await fetch(`${env.REGISTRY_URL}/services`, {
      headers: { 'x-internal-key': env.INTERNAL_API_KEY },
      signal: AbortSignal.timeout(3000)
    }).catch(() => null);

    const allPaths = {};
    if (regRes && regRes.ok) {
      const data = await regRes.json();
      const services = data.services || {};

      for (const [svcName, instList] of Object.entries(services)) {
        const upInst = instList.find((i) => i.status === 'UP');
        if (upInst && upInst.url) {
          try {
            const specRes = await fetch(`${upInst.url}/api-docs.json`, {
              signal: AbortSignal.timeout(1500)
            });
            if (specRes.ok) {
              const spec = await specRes.json();
              if (spec && spec.paths) {
                Object.assign(allPaths, spec.paths);
              }
            }
          } catch {
            // Service might not expose /api-docs.json
          }
        }
      }
    }

    const aggregatedSpec = {
      openapi: '3.0.0',
      info: {
        title: 'Hệ thống Quản lý Chấm công - Tính lương & Nhân sự (HTQLNS) – SOA API Gateway',
        version: '1.0.0',
        description: 'Tài liệu tích hợp toàn bộ các Microservices trong hệ thống HTQLNS'
      },
      servers: [{ url: env.GATEWAY_URL || `http://localhost:${PORT}` }],
      paths: allPaths
    };

    return send(res, 200, aggregatedSpec);
  } catch (err) {
    return send(res, 500, { success: false, error: err.message });
  }
}

// 8. Gateway Server chính
const server = http.createServer(async (req, res) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || '127.0.0.1';
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;
  let username = '-';

  res.on('finish', () => {
    if (pathname.startsWith('/api')) {
      const duration = Date.now() - startTime;
      const status = res.statusCode;
      log.info(`${req.method} ${pathname} ${status} - ${duration}ms [user: ${username}, ip: ${clientIp}]`);
    }
  });

  const cors = getCorsHeaders(req);
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = (statusCode, headers = {}) => {
    return originalWriteHead(statusCode, {
      ...cors,
      'x-request-id': requestId,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      ...headers
    });
  };

  try {
    // A. Xử lý OPTIONS (CORS preflight)
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // B. Kiểm tra Global Rate Limit
    const globalLimit = policies?.limits?.global || { windowMs: 60000, max: 1000 };
    const globalCheck = checkRateLimit(`global|${clientIp}`, globalLimit);
    if (!globalCheck.ok) {
      return send(res, 429, {
        success: false,
        error: 'Quá nhiều yêu cầu từ địa chỉ IP này. Vui lòng thử lại sau.'
      }, { 'Retry-After': String(globalCheck.retryAfter) });
    }

    // C. Health check của API Gateway
    if (pathname === '/health') {
      return send(res, 200, {
        status: 'UP',
        service: 'api-gateway',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        gatewayPort: PORT
      });
    }

    // D. Tài liệu OpenAPI tổng hợp
    if (pathname === '/api-docs' || pathname === '/api-docs.json') {
      return await handleApiDocs(req, res);
    }

    // E. Phục vụ Web tĩnh (Nếu không bắt đầu bằng /api/)
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, { success: false, error: 'Phương thức không được hỗ trợ cho giao diện tĩnh' });
      }
      return serveStaticFile(req, res, pathname);
    }

    // F. Các endpoint hệ thống do chính API Gateway quản lý (/api/system/*)
    if (pathname.startsWith('/api/system/')) {
      const authResult = extractAndVerifyUser(req);
      if (authResult.error) {
        return send(res, authResult.statusCode, { success: false, error: authResult.error });
      }
      username = authResult.user.username || authResult.user.sub || 'user';

      // 1. Xem danh sách dịch vụ và instance từ Registry (GET /api/system/services)
      if (pathname === '/api/system/services' && req.method === 'GET') {
        if (!['ADMIN', 'HR'].includes(authResult.user.role)) {
          return send(res, 403, { success: false, error: 'Chỉ ADMIN hoặc HR mới có quyền xem hạ tầng dịch vụ' });
        }
        try {
          const regRes = await fetch(`${env.REGISTRY_URL}/services`, {
            headers: { 'x-internal-key': env.INTERNAL_API_KEY },
            signal: AbortSignal.timeout(3000)
          });
          const data = await regRes.json();
          return send(res, 200, { success: true, data });
        } catch (err) {
          return send(res, 503, { success: false, error: `Không thể kết nối Service Registry: ${err.message}` });
        }
      }

      // 2. Xem và sửa đổi chính sách Gateway (GET/PUT /api/system/policies)
      if (pathname === '/api/system/policies') {
        if (authResult.user.role !== 'ADMIN') {
          return send(res, 403, { success: false, error: 'Chỉ ADMIN mới có quyền truy cập cấu hình chính sách Gateway' });
        }

        if (req.method === 'GET') {
          return send(res, 200, { success: true, data: policies });
        }

        if (req.method === 'PUT') {
          const newPolicies = await readJson(req);
          if (!newPolicies.routes || !Array.isArray(newPolicies.routes)) {
            return send(res, 400, { success: false, error: 'Cấu hình chính sách không hợp lệ (thiếu mảng routes)' });
          }
          policies = {
            ...policies,
            ...newPolicies,
            routes: newPolicies.routes,
            updatedAt: new Date().toISOString()
          };
          try {
            fs.writeFileSync(POLICY_FILE, JSON.stringify(policies, null, 2), 'utf8');
          } catch (e) {
            log.warn('Không thể ghi file policies.json xuống đĩa:', e.message);
          }
          log.info('Đã cập nhật chính sách Gateway thành công qua API');
          return send(res, 200, { success: true, message: 'Đã lưu cấu hình chính sách Gateway', data: policies });
        }
      }
    }

    // G. Định tuyến động theo chính sách
    const route = findMatchingRoute(pathname);
    if (!route) {
      return send(res, 404, { success: false, error: `Không tìm thấy API định tuyến cho đường dẫn: ${pathname}` });
    }

    const rule = findMatchingRule(route, req.method);
    if (!rule) {
      return send(res, 405, { success: false, error: `Phương thức ${req.method} không được phép cho ${pathname}` });
    }

    // H. Áp dụng Rate Limit theo Route cụ thể
    if (rule.rateLimit) {
      const routeLimitCheck = checkRateLimit(`${route.prefix}|${clientIp}`, rule.rateLimit);
      if (!routeLimitCheck.ok) {
        return send(res, 429, {
          success: false,
          error: 'Thao tác quá thường xuyên trên chức năng này. Vui lòng thử lại sau.'
        }, { 'Retry-After': String(routeLimitCheck.retryAfter) });
      }
    }

    // I. Kiểm tra Xác thực & Phân quyền RBAC
    let authenticatedUser = null;
    if (rule.auth !== false) {
      const authResult = extractAndVerifyUser(req);
      if (authResult.error) {
        return send(res, authResult.statusCode, { success: false, error: authResult.error });
      }

      authenticatedUser = authResult.user;
      username = authenticatedUser.username || authenticatedUser.sub || 'user';

      const allowedRoles = rule.roles || ['*'];
      if (!allowedRoles.includes('*') && (!authenticatedUser.role || !allowedRoles.includes(authenticatedUser.role))) {
        return send(res, 403, {
          success: false,
          error: `Bạn không có quyền thực hiện hành động này. Yêu cầu một trong các quyền: [${allowedRoles.join(', ')}]`
        });
      }
    }

    // J. Đọc Request Body nếu có (POST, PUT, PATCH, DELETE)
    const maxBodyBytes = policies?.limits?.bodyBytes || 10485760;
    const bodyBuffer = (req.method === 'GET' || req.method === 'HEAD') ? undefined : await readBody(req, maxBodyBytes);

    // K. Chuẩn bị Forward Headers tới downstream Microservice
    const forwardHeaders = {
      'x-request-id': requestId,
      'x-forwarded-for': clientIp,
      'x-internal-key': env.INTERNAL_API_KEY
    };

    if (req.headers['content-type']) {
      forwardHeaders['content-type'] = req.headers['content-type'];
    }

    if (req.headers['authorization']) {
      forwardHeaders['authorization'] = req.headers['authorization'];
    }

    if (authenticatedUser) {
      forwardHeaders['x-user'] = Buffer.from(JSON.stringify(authenticatedUser)).toString('base64');
    }

    // L. Chuyển tiếp yêu cầu (Proxy Forward)
    try {
      const response = await serviceClient.forward(route.service, req.url, {
        method: req.method,
        headers: forwardHeaders,
        body: bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer : undefined,
        timeout: 10000
      });

      const responseHeaders = {
        'Content-Type': response.headers['content-type'] || 'application/json; charset=utf-8'
      };

      if (response.headers['location']) {
        responseHeaders['Location'] = response.headers['location'];
      }

      res.writeHead(response.status, {
        ...responseHeaders,
        'Content-Length': response.buffer.length
      });
      res.end(response.buffer);
    } catch (err) {
      if (err.status === 503) {
        return send(res, 503, {
          success: false,
          error: `Dịch vụ "${route.service}" hiện chưa sẵn sàng hoặc đang khởi động, vui lòng thử lại sau ít phút`,
          service: route.service
        }, { 'Retry-After': '5' });
      }
      throw err;
    }
  } catch (err) {
    if (err.status === 413 || err.status === 400) {
      return send(res, err.status, { success: false, error: err.message });
    }
    log.error('Lỗi ngoại lệ tại API Gateway:', err);
    if (!res.headersSent) {
      send(res, 500, { success: false, error: 'Lỗi hệ thống tại API Gateway' });
    }
  }
});

let registrarInstance = null;

server.listen(PORT, () => {
  log.info(`🚀 API Gateway HTQLNS đang lắng nghe tại http://localhost:${PORT}`);
  // Tự động đăng ký API Gateway lên Registry
  try {
    registrarInstance = registerService({
      name: 'api-gateway',
      port: PORT,
      url: env.GATEWAY_URL || `http://localhost:${PORT}`
    });
  } catch (err) {
    log.warn('Chưa thể tự động đăng ký Gateway lên Registry:', err.message);
  }
});

async function gracefulShutdown() {
  log.info('Đang dừng API Gateway...');
  if (registrarInstance) {
    await registrarInstance.stop();
  }
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
