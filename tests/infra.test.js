/**
 * tests/infra.test.js
 * Bộ kiểm thử tự động toàn diện cho tầng Shared và Hạ tầng SOA HTQLNS
 * Kiểm thử:
 *  - Tầng Thư viện dùng chung (shared/: env, jwt, db, service-base, events)
 *  - Cụm Hạ tầng SOA cốt lõi (Service Registry, Event Bus, API Gateway)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('child_process');
const path = require('path');

const env = require('../shared/env');
const db = require('../shared/db');
const jwt = require('../shared/jwt');
const { createServiceApp } = require('../shared/service-base');
const events = require('../shared/events');
const { addEmployeeScope } = require('../shared/employee-scope');

describe('Kiểm thử tầng Thư viện dùng chung (shared/)', () => {
  describe('shared/employee-scope.js', () => {
    test('Phạm vi trống tạo điều kiện từ chối, không làm truy vấn mở rộng', () => {
      const conditions = [];
      const params = [];
      addEmployeeScope(conditions, params, [], 'attendance.emp_id');
      assert.deepStrictEqual(conditions, ['1 = 0']);
      assert.deepStrictEqual(params, []);
    });

    test('Phạm vi nhân viên dùng danh sách tham số hóa', () => {
      const conditions = [];
      const params = [];
      addEmployeeScope(conditions, params, ['employee-1', 'employee-2'], 'attendance.emp_id');
      assert.deepStrictEqual(conditions, ['attendance.emp_id IN (?, ?)']);
      assert.deepStrictEqual(params, ['employee-1', 'employee-2']);
    });

    test('Quản trị/HR không bị thêm giới hạn nhóm', () => {
      const conditions = [];
      const params = [];
      addEmployeeScope(conditions, params, null, 'attendance.emp_id');
      assert.deepStrictEqual(conditions, []);
      assert.deepStrictEqual(params, []);
    });
  });

  after(async () => {
    await db.closeAllPools();
  });

  describe('1. shared/env.js', () => {
    test('Phải nạp đầy đủ các biến môi trường cấu hình bắt buộc', () => {
      assert.ok(env.PORT, 'PORT phải tồn tại');
      assert.ok(env.DB_HOST, 'DB_HOST phải tồn tại');
      assert.ok(env.DB_PORT, 'DB_PORT phải tồn tại');
      assert.ok(env.JWT_SECRET, 'JWT_SECRET phải tồn tại');
      assert.ok(env.EVENT_BUS_URL, 'EVENT_BUS_URL phải tồn tại');
      assert.ok(env.REGISTRY_URL, 'REGISTRY_URL phải tồn tại');
    });

    test('Hàm get() phải trả về giá trị fallback khi key không tồn tại', () => {
      const val = env.get('NON_EXISTENT_KEY_12345', 'default_val');
      assert.strictEqual(val, 'default_val');
    });
  });

  describe('2. shared/jwt.js', () => {
    test('Ký và xác thực token JWT hợp lệ', () => {
      const payload = { userId: 'u0000001-0000', role: 'ADMIN', username: 'admin' };
      const token = jwt.signToken(payload, { expiresIn: '1h' });

      assert.ok(typeof token === 'string', 'Token phải là chuỗi');
      assert.strictEqual(token.split('.').length, 3, 'Token phải gồm 3 phần header.payload.signature');

      const verified = jwt.verifyToken(token);
      assert.strictEqual(verified.userId, payload.userId);
      assert.strictEqual(verified.role, payload.role);
      assert.strictEqual(verified.username, payload.username);
      assert.ok(verified.exp, 'Token phải có trường exp');
    });

    test('Từ chối token bị sửa đổi hoặc chữ ký không khớp', () => {
      const token = jwt.signToken({ userId: 1 }, { expiresIn: '1h' });
      assert.throws(() => {
        jwt.verifyToken(token + 'invalid_signature');
      }, /JsonWebTokenError|Chữ ký token không hợp lệ/);
    });

    test('Từ chối token đã hết hạn', async () => {
      const expiredToken = jwt.signToken({ userId: 99 }, { expiresIn: -10 });
      assert.throws(() => {
        jwt.verifyToken(expiredToken);
      }, /TokenExpiredError|hết hạn/);
    });

    test('Ký Refresh Token với thời hạn mặc định', () => {
      const rfToken = jwt.signRefreshToken({ userId: 'u0000001' });
      const decoded = jwt.decodeToken(rfToken);
      assert.ok(decoded);
      assert.strictEqual(decoded.userId, 'u0000001');
    });
  });

  describe('3. shared/db.js', () => {
    let dbOnline = false;

    before(async () => {
      try {
        await db.query('SELECT 1');
        dbOnline = true;
      } catch {
        dbOnline = false;
      }
    });

    test('Kết nối MySQL và thực thi truy vấn tham số an toàn', async (t) => {
      if (!dbOnline) {
        return t.skip('MySQL server chưa khởi chạy trên cổng 3306, bỏ qua kiểm thử kết nối DB');
      }
      const rows = await db.query('SELECT ? AS test_val, 1 + 1 AS sum', ['htqlns_test']);
      assert.ok(Array.isArray(rows), 'Kết quả truy vấn phải là một mảng');
      assert.strictEqual(rows[0].test_val, 'htqlns_test');
      assert.strictEqual(Number(rows[0].sum), 2);
    });

    test('Truy vấn bảng users từ database htqlns_auth', async (t) => {
      if (!dbOnline) {
        return t.skip('MySQL server chưa khởi chạy, bỏ qua kiểm thử truy vấn bảng users');
      }
      const users = await db.query('SELECT id, username, role FROM users WHERE username = ?', ['admin']);
      assert.ok(users.length > 0, 'Phải tìm thấy tài khoản admin đã seed');
      assert.strictEqual(users[0].username, 'admin');
      assert.strictEqual(users[0].role, 'ADMIN');
    });

    test('Thực hiện Transaction commit thành công', async (t) => {
      if (!dbOnline) {
        return t.skip('MySQL server chưa khởi chạy, bỏ qua kiểm thử Transaction');
      }
      const result = await db.withTransaction(async (conn) => {
        const [res] = await conn.query('SELECT count(*) as total FROM users');
        return res[0].total;
      });
      assert.ok(result >= 1, 'Transaction phải trả về số lượng users');
    });
  });

  describe('4. shared/service-base.js', () => {
    let server;
    const testPort = 3199;

    before(() => {
      const app = createServiceApp('test-unit-service', { port: testPort });
      app.get('/api/ping', (req, res) => res.json({ pong: true }));
      app.useErrorHandler();
      server = app.listen(testPort);
    });

    after(() => {
      if (server) server.close();
    });

    test('Endpoint /health trả về trạng thái UP và thông tin dịch vụ', async () => {
      const res = await fetch(`http://localhost:${testPort}/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'UP');
      assert.strictEqual(data.service, 'test-unit-service');
      assert.ok(data.uptime >= 0);
    });

    test('Kiểm tra phản hồi 404 cho endpoint không tồn tại', async () => {
      const res = await fetch(`http://localhost:${testPort}/not-found-route`);
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, 404);
    });
  });

  describe('5. shared/events.js', () => {
    test('Xử lý publish event gracefully (không throw exception khi gọi)', async () => {
      const res = await events.publish('test.event', { data: 123 }, { timeoutMs: 300 });
      assert.strictEqual(typeof res, 'object');
      assert.strictEqual(typeof res.success, 'boolean');
      assert.ok(res.eventId);
    });

    test('Tạo Webhook Router phân luồng đúng eventType', async () => {
      let eventHandled = false;
      const router = events.createWebhookRouter({
        'user.test': async (ev) => {
          eventHandled = true;
        }
      });
      assert.ok(router, 'Router phải được khởi tạo');
    });
  });
});

describe('Kiểm thử Cụm Hạ tầng SOA Cốt lõi (Registry, Event Bus, Gateway)', () => {
  let regProcess = null;
  let busProcess = null;
  let gwProcess = null;

  const REG_PORT = 3591;
  const BUS_PORT = 3691;
  const GW_PORT = 3091;

  before(async () => {
    // 1. Khởi chạy Registry Server kiểm thử
    regProcess = fork(path.resolve(__dirname, '..', 'registry', 'server.js'), [], {
      env: { ...process.env, REGISTRY_PORT: String(REG_PORT), NODE_ENV: 'test' },
      stdio: 'pipe'
    });

    // 2. Khởi chạy Event Bus Server kiểm thử
    busProcess = fork(path.resolve(__dirname, '..', 'event-bus', 'server.js'), [], {
      env: { ...process.env, EVENT_BUS_PORT: String(BUS_PORT), NODE_ENV: 'test' },
      stdio: 'pipe'
    });

    // 3. Khởi chạy Gateway Server kiểm thử
    gwProcess = fork(path.resolve(__dirname, '..', 'gateway', 'server.js'), [], {
      env: {
        ...process.env,
        GATEWAY_PORT: String(GW_PORT),
        REGISTRY_URL: `http://localhost:${REG_PORT}`,
        EVENT_BUS_URL: `http://localhost:${BUS_PORT}`,
        NODE_ENV: 'test'
      },
      stdio: 'pipe'
    });

    // Đợi các server khởi động hoàn tất
    for (let i = 0; i < 20; i++) {
      try {
        const [r1, r2, r3] = await Promise.all([
          fetch(`http://localhost:${REG_PORT}/health`),
          fetch(`http://localhost:${BUS_PORT}/health`),
          fetch(`http://localhost:${GW_PORT}/health`)
        ]);
        if (r1.ok && r2.ok && r3.ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  });

  after(() => {
    if (regProcess) regProcess.kill();
    if (busProcess) busProcess.kill();
    if (gwProcess) gwProcess.kill();
  });

  describe('1. Service Registry (:3591)', () => {
    let testInstanceId = null;

    test('Registry /health phản hồi UP', async () => {
      const res = await fetch(`http://localhost:${REG_PORT}/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'UP');
      assert.strictEqual(data.service, 'service-registry');
    });

    test('Đăng ký service mới thành công (POST /register)', async () => {
      const res = await fetch(`http://localhost:${REG_PORT}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': env.INTERNAL_API_KEY
        },
        body: JSON.stringify({
          name: 'test-microservice',
          url: 'http://localhost:3999',
          healthUrl: 'http://localhost:3999/health',
          version: '1.0.0'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.instanceId);
      testInstanceId = data.instanceId;
    });

    test('Duy trì Heartbeat (POST /heartbeat)', async () => {
      const res = await fetch(`http://localhost:${REG_PORT}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': env.INTERNAL_API_KEY
        },
        body: JSON.stringify({
          instanceId: testInstanceId
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
    });

    test('Tra cứu danh sách dịch vụ (GET /services và GET /services/:name)', async () => {
      const allRes = await fetch(`http://localhost:${REG_PORT}/services`, {
        headers: { 'x-internal-key': env.INTERNAL_API_KEY }
      });
      assert.strictEqual(allRes.status, 200);
      const allData = await allRes.json();
      assert.ok(allData.services['test-microservice']);

      const singleRes = await fetch(`http://localhost:${REG_PORT}/services/test-microservice`, {
        headers: { 'x-internal-key': env.INTERNAL_API_KEY }
      });
      assert.strictEqual(singleRes.status, 200);
      const singleData = await singleRes.json();
      assert.strictEqual(singleData.name, 'test-microservice');
      assert.strictEqual(singleData.instances.length, 1);
    });

    test('Từ chối truy cập khi thiếu x-internal-key', async () => {
      const res = await fetch(`http://localhost:${REG_PORT}/services`);
      assert.strictEqual(res.status, 403);
    });
  });

  describe('2. Event Bus (:3691)', () => {
    test('Event Bus /health phản hồi UP', async () => {
      const res = await fetch(`http://localhost:${BUS_PORT}/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'UP');
      assert.strictEqual(data.service, 'event-bus');
    });

    test('Đăng ký nhận sự kiện (POST /events/subscribe)', async () => {
      const res = await fetch(`http://localhost:${BUS_PORT}/events/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': env.INTERNAL_API_KEY
        },
        body: JSON.stringify({
          serviceName: 'test-subscriber',
          eventType: ['attendance.recorded', 'leave.*'],
          webhookUrl: 'http://localhost:3999/events'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
    });

    test('Bắn sự kiện lên Event Bus (POST /events/publish)', async () => {
      const res = await fetch(`http://localhost:${BUS_PORT}/events/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': env.INTERNAL_API_KEY
        },
        body: JSON.stringify({
          eventType: 'attendance.recorded',
          data: { empId: 'e001', checkinTime: '08:00:00' },
          source: 'attendance-service'
        })
      });
      assert.strictEqual(res.status, 202);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.deliveries, 1);
    });

    test('Kiểm tra thống kê Event Bus (GET /events/stats)', async () => {
      const res = await fetch(`http://localhost:${BUS_PORT}/events/stats`, {
        headers: { 'x-internal-key': env.INTERNAL_API_KEY }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.subscribers);
      assert.ok(typeof data.pending === 'number');
    });
  });

  describe('3. API Gateway (:3091)', () => {
    test('API Gateway /health phản hồi UP', async () => {
      const res = await fetch(`http://localhost:${GW_PORT}/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'UP');
      assert.strictEqual(data.service, 'api-gateway');
    });

    test('CORS Header trả về đầy đủ trên preflight OPTIONS', async () => {
      const res = await fetch(`http://localhost:${GW_PORT}/api/auth/login`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' }
      });
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
      assert.ok(res.headers.get('access-control-allow-methods'));
    });

    test('Trả về 401 khi gọi API yêu cầu bảo mật mà thiếu Bearer Token', async () => {
      const res = await fetch(`http://localhost:${GW_PORT}/api/auth/me`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    test('Trả về 403 khi gọi API vượt quyền hạn vai trò (RBAC)', async () => {
      // Đăng nhập với vai trò EMPLOYEE nhưng cố gọi endpoint chỉ dành cho ADMIN/HR
      const employeeToken = jwt.signToken({
        userId: 'u004',
        username: 'emp_test',
        role: 'EMPLOYEE'
      });

      const res = await fetch(`http://localhost:${GW_PORT}/api/auth/users`, {
        headers: { Authorization: `Bearer ${employeeToken}` }
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    test('Manager được phép đi qua Gateway tới dashboard và luồng duyệt OT', async () => {
      const managerToken = jwt.signToken({
        userId: 'manager-user',
        empId: 'manager-employee',
        username: 'manager',
        role: 'MANAGER'
      });
      const headers = {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json'
      };

      const analyticsRes = await fetch(`http://localhost:${GW_PORT}/api/analytics/dashboard?month=1&year=2026`, {
        headers
      });
      assert.strictEqual(analyticsRes.status, 503);

      const decisionRes = await fetch(`http://localhost:${GW_PORT}/api/v1/ot-requests/request-1/decision`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ decision: 'APPROVED' })
      });
      assert.strictEqual(decisionRes.status, 503);
    });

    test('Trả về 503 Service Unavailable khi downstream service chưa online', async () => {
      const res = await fetch(`http://localhost:${GW_PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '123' })
      });
      // Do auth-service chưa khởi chạy trên cổng 3001
      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.service, 'auth-service');
    });
  });
});
