/**
 * tests/auth-org.test.js
 * Bộ kiểm thử tự động cho Auth Service & Organization Service (feature/02-auth-org)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('child_process');
const path = require('path');
const jwt = require('../shared/jwt');

describe('Kiểm thử Phân hệ Auth Service & Organization Service', () => {
  let authProcess = null;
  let orgProcess = null;

  const AUTH_PORT = 3101;
  const ORG_PORT = 3102;

  before(async () => {
    // 1. Khởi chạy auth-service trên cổng kiểm thử
    authProcess = fork(path.resolve(__dirname, '..', 'services', 'auth-service', 'index.js'), [], {
      env: { ...process.env, AUTH_PORT: String(AUTH_PORT), NODE_ENV: 'test' },
      stdio: 'pipe'
    });

    // 2. Khởi chạy organization-service trên cổng kiểm thử
    orgProcess = fork(path.resolve(__dirname, '..', 'services', 'organization-service', 'index.js'), [], {
      env: { ...process.env, ORGANIZATION_PORT: String(ORG_PORT), NODE_ENV: 'test' },
      stdio: 'pipe'
    });

    // Đợi 2 service sẵn sàng
    for (let i = 0; i < 20; i++) {
      try {
        const [r1, r2] = await Promise.all([
          fetch(`http://localhost:${AUTH_PORT}/health`),
          fetch(`http://localhost:${ORG_PORT}/health`)
        ]);
        if (r1.ok && r2.ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  });

  after(() => {
    if (authProcess) authProcess.kill();
    if (orgProcess) orgProcess.kill();
  });

  describe('1. Kiểm thử Auth Service (:3101)', () => {
    let adminToken = null;
    let employeeToken = null;
    let refreshToken = null;
    let employeeRefreshToken = null;
    const testUsername = `user_${Date.now()}`;
    const testEmail = `${testUsername}@htqlns.com`;

    test('Health check /health trả về trạng thái UP', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'UP');
      assert.strictEqual(data.service, 'auth-service');
    });

    test('Đăng nhập thành công với tài khoản Admin mặc định', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '123456' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.data.token);
      assert.ok(data.data.refreshToken);
      assert.strictEqual(data.data.user.username, 'admin');
      assert.strictEqual(data.data.user.role, 'ADMIN');

      adminToken = data.data.token;
      refreshToken = data.data.refreshToken;
    });

    test('Từ chối đăng nhập khi sai mật khẩu (HTTP 401)', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'sai_mat_khau_123' })
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    test('Đăng ký tài khoản người dùng mới thành công (HTTP 201)', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testUsername,
          email: testEmail,
          password: 'password123',
          role: 'EMPLOYEE'
        })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.username, testUsername);
      assert.strictEqual(data.data.role, 'EMPLOYEE');
    });

    test('Đăng ký công khai bỏ qua role đặc quyền và liên kết nhân sự do người dùng gửi lên', async () => {
      const username = `role_escalation_${Date.now()}`;
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          email: `${username}@htqlns.com`,
          password: 'password123',
          role: 'HR',
          emp_id: 'e0000001-0000-0000-0000-000000000001',
          biometric_enabled: true
        })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.data.role, 'EMPLOYEE');
      assert.strictEqual(data.data.emp_id, null);
    });

    test('Từ chối đăng ký tài khoản trùng lặp username (HTTP 409)', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testUsername,
          email: `other_${testEmail}`,
          password: 'password123'
        })
      });
      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    test('Đăng nhập với tài khoản vừa tạo và lấy thông tin cá nhân /api/auth/me', async () => {
      const loginRes = await fetch(`http://localhost:${AUTH_PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: 'password123' })
      });
      assert.strictEqual(loginRes.status, 200);
      const loginData = await loginRes.json();
      employeeToken = loginData.data.token;
      employeeRefreshToken = loginData.data.refreshToken;

      const meRes = await fetch(`http://localhost:${AUTH_PORT}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${employeeToken}`,
          'x-user': Buffer.from(JSON.stringify(loginData.data.user)).toString('base64')
        }
      });
      assert.strictEqual(meRes.status, 200);
      const meData = await meRes.json();
      assert.strictEqual(meData.data.username, testUsername);
      assert.strictEqual(meData.data.email, testEmail);
    });

    test('Đổi mật khẩu yêu cầu mật khẩu hiện tại và thu hồi refresh token cũ', async () => {
      const currentUser = jwt.verifyToken(employeeToken);
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`,
          'x-user': Buffer.from(JSON.stringify(currentUser)).toString('base64')
        },
        body: JSON.stringify({ oldPassword: 'password123', newPassword: 'new_password123' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);

      const refreshRes = await fetch(`http://localhost:${AUTH_PORT}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: employeeRefreshToken })
      });
      assert.strictEqual(refreshRes.status, 401);

      const loginRes = await fetch(`http://localhost:${AUTH_PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: 'new_password123' })
      });
      assert.strictEqual(loginRes.status, 200);
      const loginData = await loginRes.json();
      employeeToken = loginData.data.token;
      employeeRefreshToken = loginData.data.refreshToken;
    });

    test('Làm mới Access Token thông qua /api/auth/refresh', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.data.token);
    });

    test('Yêu cầu mã OTP khôi phục mật khẩu /api/auth/forgot-password', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
    });

    test('Admin xem danh sách người dùng hệ thống /api/auth/users', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/users`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'x-user': Buffer.from(JSON.stringify({ userId: 'u001', role: 'ADMIN' })).toString('base64')
        }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.data));
      assert.ok(data.data.length >= 4);
    });

    test('Nhân viên thường không có quyền truy cập /api/auth/users (HTTP 403)', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/users`, {
        headers: {
          Authorization: `Bearer ${employeeToken}`,
          'x-user': Buffer.from(JSON.stringify({ userId: 'u004', role: 'EMPLOYEE' })).toString('base64')
        }
      });
      assert.strictEqual(res.status, 403);
    });

    test('Đăng xuất thu hồi refresh token hiện tại', async () => {
      const res = await fetch(`http://localhost:${AUTH_PORT}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${employeeToken}`
        },
        body: JSON.stringify({ refreshToken: employeeRefreshToken })
      });
      assert.strictEqual(res.status, 200);

      const refreshRes = await fetch(`http://localhost:${AUTH_PORT}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: employeeRefreshToken })
      });
      assert.strictEqual(refreshRes.status, 401);
    });
  });

  describe('2. Kiểm thử Organization Service (:3102)', () => {
    let createdDeptId = null;
    let createdEmpId = null;
    const adminUser = { userId: 'e001', username: 'admin', role: 'ADMIN' };
    const adminHeaders = {
      'Content-Type': 'application/json',
      'x-user': Buffer.from(JSON.stringify(adminUser)).toString('base64')
    };

    test('Health check /health phản hồi UP', async () => {
      const res = await fetch(`http://localhost:${ORG_PORT}/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'UP');
      assert.strictEqual(data.service, 'organization-service');
    });

    test('Lấy danh sách cơ cấu phòng ban /api/organization/departments', async () => {
      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/departments`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.data));
      assert.ok(data.data.length >= 4);
      assert.ok(data.data.some((d) => d.code === 'PB-TECH'));
    });

    test('Lấy danh mục vị trí việc làm /api/organization/positions', async () => {
      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/positions`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.data));
      assert.ok(data.data.some((p) => p.code === 'POS-DEV'));
    });

    test('Tạo phòng ban mới thành công /api/organization/departments (HTTP 201)', async () => {
      const deptCode = `PB-TEST-${Date.now()}`;
      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/departments`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          code: deptCode,
          name: 'Phòng Thử Nghiệm Chất Lượng (QA/QC)',
          description: 'Đảm bảo chất lượng phần mềm và quy trình SOA'
        })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.data.id);
      createdDeptId = data.data.id;
    });

    test('Lấy danh sách hồ sơ nhân sự /api/organization/employees', async () => {
      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/employees`, {
        headers: adminHeaders
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.data));
      assert.ok(data.data.length >= 4);
      assert.ok(data.data.some((e) => e.code === 'EMP001'));
    });

    test('Manager chỉ xem nhân viên thuộc nhóm và không xem identity_card', async () => {
      const managerHeaders = {
        'x-user': Buffer.from(JSON.stringify({
          userId: 'manager-user',
          role: 'MANAGER',
          empId: 'e0000001-0000-0000-0000-000000000003'
        })).toString('base64')
      };
      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/employees`, {
        headers: managerHeaders
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.deepStrictEqual(data.data.map((employee) => employee.code).sort(), ['EMP003', 'EMP004']);
      assert.ok(data.data.every((employee) => !Object.hasOwn(employee, 'identity_card')));

      const forbiddenProfile = await fetch(
        `http://localhost:${ORG_PORT}/api/organization/employees/e0000001-0000-0000-0000-000000000002`,
        { headers: managerHeaders }
      );
      assert.strictEqual(forbiddenProfile.status, 403);
    });

    test('Nhân viên không được xem danh sách toàn bộ hồ sơ nhân sự', async () => {
      const employeeHeaders = {
        'x-user': Buffer.from(JSON.stringify({
          userId: 'employee-user',
          role: 'EMPLOYEE',
          empId: 'e0000001-0000-0000-0000-000000000004'
        })).toString('base64')
      };
      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/employees`, {
        headers: employeeHeaders
      });
      assert.strictEqual(res.status, 403);
    });

    test('Nhân viên chỉ xem được hồ sơ cá nhân, không truy cập hồ sơ người khác', async () => {
      const employeeHeaders = {
        'x-user': Buffer.from(JSON.stringify({
          userId: 'employee-user',
          role: 'EMPLOYEE',
          empId: 'e0000001-0000-0000-0000-000000000004'
        })).toString('base64')
      };
      const ownProfile = await fetch(`http://localhost:${ORG_PORT}/api/organization/employees/me/profile`, {
        headers: employeeHeaders
      });
      assert.strictEqual(ownProfile.status, 200);
      const ownData = await ownProfile.json();
      assert.strictEqual(ownData.data.id, 'e0000001-0000-0000-0000-000000000004');

      const otherProfile = await fetch(
        `http://localhost:${ORG_PORT}/api/organization/employees/e0000001-0000-0000-0000-000000000003`,
        { headers: employeeHeaders }
      );
      assert.strictEqual(otherProfile.status, 403);
    });

    test('Tạo mới hồ sơ nhân sự /api/organization/employees (HTTP 201)', async () => {
      const empCode = `EMP_${Date.now().toString().slice(-5)}`;
      const empEmail = `tester_${Date.now()}@htqlns.com`;

      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/employees`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          code: empCode,
          full_name: 'Vũ Văn Kiểm Thử',
          email: empEmail,
          phone: '0988776655',
          gender: 'MALE',
          department_id: createdDeptId,
          contract_type: 'OFFICIAL'
        })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.data.id);
      createdEmpId = data.data.id;
    });

    test('Cập nhật hồ sơ nhân sự /api/organization/employees/:id (HTTP 200)', async () => {
      assert.ok(createdEmpId, 'Phải có createdEmpId');
      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/employees/${createdEmpId}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          full_name: 'Vũ Văn Kiểm Thử (Đã Cập Nhật)',
          phone: '0911223344'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
    });

    test('Cập nhật trạng thái nhân viên nghỉ việc /api/organization/employees/:id (HTTP 200)', async () => {
      assert.ok(createdEmpId, 'Phải có createdEmpId');
      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/employees/${createdEmpId}`, {
        method: 'DELETE',
        headers: adminHeaders
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.data.status, 'RESIGNED');
    });

    test('Xóa phòng ban thử nghiệm /api/organization/departments/:id', async () => {
      assert.ok(createdDeptId, 'Phải có createdDeptId');
      const res = await fetch(`http://localhost:${ORG_PORT}/api/organization/departments/${createdDeptId}`, {
        method: 'DELETE',
        headers: adminHeaders
      });
      assert.strictEqual(res.status, 200);
    });
  });
});
