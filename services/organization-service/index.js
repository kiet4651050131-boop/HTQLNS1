/**
 * services/organization-service/index.js
 * Organization Service – Quản lý Cơ cấu Tổ chức, Phòng ban & Hồ sơ Nhân sự (HTQLNS)
 * Cổng: 3002 | Database: htqlns_organization
 * Thiết kế theo Wireframe Figma: SCR_ADM_05, SCR_ADM_06, SCR_USER_01
 */

require('../../shared/env');
const crypto = require('crypto');
const env = require('../../shared/env');
const db = require('../../shared/db');
const { createServiceApp, requireAuth } = require('../../shared/service-base');
const { registerService } = require('../../shared/registrar');
const events = require('../../shared/events');
const {
  success,
  created,
  error,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict
} = require('../../shared/httpx');
const { createOpenApiSpec } = require('../../shared/openapi');

const PORT = Number(process.env.ORGANIZATION_PORT || 3002);
const DB_NAME = process.env.ORGANIZATION_DB_NAME || 'htqlns_organization';

// ==============================================================================
// DỮ LIỆU DỰ PHÒNG TRONG BỘ NHỚ (In-memory fallback khi chưa có MySQL)
// ==============================================================================
const memoryDepartments = new Map([
  [
    'd0000001-0000-0000-0000-000000000001',
    {
      id: 'd0000001-0000-0000-0000-000000000001',
      code: 'PB-BGD',
      name: 'Ban Giám Đốc',
      description: 'Cấp lãnh đạo và điều hành chiến lược',
      manager_id: 'e0000001-0000-0000-0000-000000000001',
      parent_id: null,
      status: 'ACTIVE'
    }
  ],
  [
    'd0000001-0000-0000-0000-000000000002',
    {
      id: 'd0000001-0000-0000-0000-000000000002',
      code: 'PB-HR',
      name: 'Phòng Hành chính Nhân sự',
      description: 'Quản trị nhân sự, tuyển dụng, tính lương và chế độ',
      manager_id: 'e0000001-0000-0000-0000-000000000002',
      parent_id: null,
      status: 'ACTIVE'
    }
  ],
  [
    'd0000001-0000-0000-0000-000000000003',
    {
      id: 'd0000001-0000-0000-0000-000000000003',
      code: 'PB-TECH',
      name: 'Phòng Công nghệ & Phần mềm',
      description: 'Phát triển các giải pháp phần mềm và hạ tầng số',
      manager_id: 'e0000001-0000-0000-0000-000000000003',
      parent_id: null,
      status: 'ACTIVE'
    }
  ],
  [
    'd0000001-0000-0000-0000-000000000004',
    {
      id: 'd0000001-0000-0000-0000-000000000004',
      code: 'PB-SALES',
      name: 'Phòng Kinh doanh & Marketing',
      description: 'Phát triển khách hàng và mở rộng thị trường',
      manager_id: null,
      parent_id: null,
      status: 'ACTIVE'
    }
  ]
]);

const memoryPositions = new Map([
  [
    'p0000001-0000-0000-0000-000000000001',
    {
      id: 'p0000001-0000-0000-0000-000000000001',
      code: 'POS-CEO',
      title: 'Tổng Giám Đốc Điều Hành',
      department_id: 'd0000001-0000-0000-0000-000000000001',
      base_salary_min: 50000000,
      base_salary_max: 100000000,
      status: 'ACTIVE'
    }
  ],
  [
    'p0000001-0000-0000-0000-000000000002',
    {
      id: 'p0000001-0000-0000-0000-000000000002',
      code: 'POS-HRM',
      title: 'Trưởng Phòng Nhân Sự',
      department_id: 'd0000001-0000-0000-0000-000000000002',
      base_salary_min: 20000000,
      base_salary_max: 35000000,
      status: 'ACTIVE'
    }
  ],
  [
    'p0000001-0000-0000-0000-000000000003',
    {
      id: 'p0000001-0000-0000-0000-000000000003',
      code: 'POS-LEAD',
      title: 'Trưởng Nhóm Kỹ Thuật (Tech Lead)',
      department_id: 'd0000001-0000-0000-0000-000000000003',
      base_salary_min: 25000000,
      base_salary_max: 45000000,
      status: 'ACTIVE'
    }
  ],
  [
    'p0000001-0000-0000-0000-000000000004',
    {
      id: 'p0000001-0000-0000-0000-000000000004',
      code: 'POS-DEV',
      title: 'Kỹ Sư Lập Trình Phần Mềm',
      department_id: 'd0000001-0000-0000-0000-000000000003',
      base_salary_min: 12000000,
      base_salary_max: 25000000,
      status: 'ACTIVE'
    }
  ]
]);

const memoryEmployees = new Map([
  [
    'e0000001-0000-0000-0000-000000000001',
    {
      id: 'e0000001-0000-0000-0000-000000000001',
      code: 'EMP001',
      full_name: 'Nguyễn Quản Trị (Admin)',
      email: 'admin@htqlns.com',
      phone: '0901000001',
      gender: 'MALE',
      department_id: 'd0000001-0000-0000-0000-000000000001',
      position_id: 'p0000001-0000-0000-0000-000000000001',
      manager_id: null,
      join_date: '2023-01-01',
      contract_type: 'OFFICIAL',
      status: 'ACTIVE'
    }
  ],
  [
    'e0000001-0000-0000-0000-000000000002',
    {
      id: 'e0000001-0000-0000-0000-000000000002',
      code: 'EMP002',
      full_name: 'Trần Thị Thu Hà (HR Manager)',
      email: 'hr@htqlns.com',
      phone: '0901000002',
      gender: 'FEMALE',
      department_id: 'd0000001-0000-0000-0000-000000000002',
      position_id: 'p0000001-0000-0000-0000-000000000002',
      manager_id: 'e0000001-0000-0000-0000-000000000001',
      join_date: '2023-02-15',
      contract_type: 'OFFICIAL',
      status: 'ACTIVE'
    }
  ],
  [
    'e0000001-0000-0000-0000-000000000003',
    {
      id: 'e0000001-0000-0000-0000-000000000003',
      code: 'EMP003',
      full_name: 'Lê Hoàng Nam (Tech Lead)',
      email: 'manager@htqlns.com',
      phone: '0901000003',
      gender: 'MALE',
      department_id: 'd0000001-0000-0000-0000-000000000003',
      position_id: 'p0000001-0000-0000-0000-000000000003',
      manager_id: 'e0000001-0000-0000-0000-000000000001',
      join_date: '2023-03-01',
      contract_type: 'OFFICIAL',
      status: 'ACTIVE'
    }
  ],
  [
    'e0000001-0000-0000-0000-000000000004',
    {
      id: 'e0000001-0000-0000-0000-000000000004',
      code: 'EMP004',
      full_name: 'Nguyễn Văn An (Developer)',
      email: 'employee@htqlns.com',
      phone: '0901000004',
      gender: 'MALE',
      department_id: 'd0000001-0000-0000-0000-000000000003',
      position_id: 'p0000001-0000-0000-0000-000000000004',
      manager_id: 'e0000001-0000-0000-0000-000000000003',
      join_date: '2024-01-10',
      contract_type: 'OFFICIAL',
      status: 'ACTIVE'
    }
  ]
]);

const memoryAuditLogs = [];

async function isDbAvailable() {
  try {
    await db.query('SELECT 1', [], DB_NAME);
    return true;
  } catch {
    return false;
  }
}

// Khởi tạo Express Service App
const app = createServiceApp('organization-service', {
  port: PORT,
  checkHealth: async () => {
    if (process.env.REQUIRE_DB === 'true') {
      return isDbAvailable();
    }
    return true;
  }
});

// Middleware giải mã thông tin x-user
app.use((req, res, next) => {
  const forwardedUser = req.headers['x-user'];
  if (forwardedUser && !req.user) {
    try {
      req.user = JSON.parse(Buffer.from(forwardedUser, 'base64').toString('utf8'));
    } catch {}
  }
  next();
});

// Ghi audit log
async function logAudit(action, actor, resource, resourceId, details, req) {
  const record = {
    id: crypto.randomUUID(),
    action,
    actor_id: actor?.userId || actor?.id || null,
    actor_name: actor?.username || 'system',
    resource,
    resource_id: resourceId,
    details: details ? JSON.stringify(details) : null,
    ip_address: req?.socket?.remoteAddress || '127.0.0.1',
    created_at: new Date().toISOString()
  };

  const useDb = await isDbAvailable();
  if (useDb) {
    try {
      await db.query(
        `INSERT INTO audit_logs (id, action, actor_id, actor_name, resource, resource_id, details, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.action, record.actor_id, record.actor_name, record.resource, record.resource_id, record.details, record.ip_address],
        DB_NAME
      );
    } catch {}
  } else {
    memoryAuditLogs.unshift(record);
    if (memoryAuditLogs.length > 500) memoryAuditLogs.pop();
  }
}

// ==============================================================================
// 1. QUẢN LÝ PHÒNG BAN (DEPARTMENTS)
// ==============================================================================

// Danh sách phòng ban
const getDepartmentsHandler = async (req, res) => {
  try {
    const useDb = await isDbAvailable();
    let departments = [];

    if (useDb) {
      departments = await db.query(
        `SELECT d.*, e.full_name AS manager_name,
                (SELECT COUNT(*) FROM employees emp WHERE emp.department_id = d.id AND emp.status = 'ACTIVE') AS employee_count
         FROM departments d
         LEFT JOIN employees e ON d.manager_id = e.id
         ORDER BY d.created_at ASC`,
        [],
        DB_NAME
      );
    } else {
      departments = Array.from(memoryDepartments.values()).map((d) => {
        const mgr = d.manager_id ? memoryEmployees.get(d.manager_id) : null;
        const count = Array.from(memoryEmployees.values()).filter((e) => e.department_id === d.id && e.status === 'ACTIVE').length;
        return {
          ...d,
          manager_name: mgr ? mgr.full_name : null,
          employee_count: count
        };
      });
    }

    return success(res, departments);
  } catch (err) {
    return error(res, 'Lỗi lấy danh sách phòng ban: ' + err.message);
  }
};

app.get('/api/organization/departments', requireAuth(), getDepartmentsHandler);
app.get('/api/departments', requireAuth(), getDepartmentsHandler);

// Chi tiết một phòng ban
const getDepartmentDetailHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const useDb = await isDbAvailable();
    let dept = null;

    if (useDb) {
      const rows = await db.query(
        `SELECT d.*, e.full_name AS manager_name
         FROM departments d
         LEFT JOIN employees e ON d.manager_id = e.id
         WHERE d.id = ? OR d.code = ? LIMIT 1`,
        [id, id],
        DB_NAME
      );
      dept = rows[0] || null;
    } else {
      dept = memoryDepartments.get(id) || Array.from(memoryDepartments.values()).find((d) => d.code === id) || null;
    }

    if (!dept) return notFound(res, 'Không tìm thấy phòng ban');
    return success(res, dept);
  } catch (err) {
    return error(res, err.message);
  }
};

app.get('/api/organization/departments/:id', requireAuth(), getDepartmentDetailHandler);
app.get('/api/departments/:id', requireAuth(), getDepartmentDetailHandler);

// Tạo mới phòng ban (ADMIN, HR)
const createDepartmentHandler = async (req, res) => {
  try {
    const { code, name, description, manager_id, parent_id } = req.body;
    if (!code || !name) {
      return badRequest(res, 'Yêu cầu cung cấp mã và tên phòng ban');
    }

    const id = crypto.randomUUID();
    const useDb = await isDbAvailable();

    if (useDb) {
      const existing = await db.query('SELECT id FROM departments WHERE code = ?', [code], DB_NAME);
      if (existing.length > 0) return conflict(res, 'Mã phòng ban đã tồn tại');

      await db.query(
        `INSERT INTO departments (id, code, name, description, manager_id, parent_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [id, code, name, description || null, manager_id || null, parent_id || null],
        DB_NAME
      );
    } else {
      for (const d of memoryDepartments.values()) {
        if (d.code === code) return conflict(res, 'Mã phòng ban đã tồn tại');
      }
      memoryDepartments.set(id, {
        id,
        code,
        name,
        description,
        manager_id,
        parent_id,
        status: 'ACTIVE'
      });
    }

    await logAudit('CREATE_DEPARTMENT', req.user, 'DEPARTMENT', id, { code, name }, req);
    events.publish('department.created', { id, code, name }, { source: 'organization-service' });

    return created(res, { id, code, name }, 'Tạo phòng ban thành công');
  } catch (err) {
    return error(res, err.message);
  }
};

app.post('/api/organization/departments', requireAuth(['ADMIN', 'HR']), createDepartmentHandler);
app.post('/api/departments', requireAuth(['ADMIN', 'HR']), createDepartmentHandler);

// Cập nhật phòng ban (ADMIN, HR)
const updateDepartmentHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, description, manager_id, parent_id, status } = req.body;
    const useDb = await isDbAvailable();

    if (useDb) {
      await db.query(
        `UPDATE departments SET
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          manager_id = COALESCE(?, manager_id),
          parent_id = COALESCE(?, parent_id),
          status = COALESCE(?, status)
         WHERE id = ?`,
        [name, description, manager_id, parent_id, status, id],
        DB_NAME
      );
    } else {
      const dept = memoryDepartments.get(id);
      if (!dept) return notFound(res, 'Không tìm thấy phòng ban');
      if (name) dept.name = name;
      if (description !== undefined) dept.description = description;
      if (manager_id !== undefined) dept.manager_id = manager_id;
      if (parent_id !== undefined) dept.parent_id = parent_id;
      if (status) dept.status = status;
    }

    await logAudit('UPDATE_DEPARTMENT', req.user, 'DEPARTMENT', id, req.body, req);
    return success(res, { id }, 200, 'Cập nhật phòng ban thành công');
  } catch (err) {
    return error(res, err.message);
  }
};

app.put('/api/organization/departments/:id', requireAuth(['ADMIN', 'HR']), updateDepartmentHandler);
app.put('/api/departments/:id', requireAuth(['ADMIN', 'HR']), updateDepartmentHandler);

// Xóa phòng ban (ADMIN, HR)
const deleteDepartmentHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const useDb = await isDbAvailable();

    if (useDb) {
      await db.query('DELETE FROM departments WHERE id = ?', [id], DB_NAME);
    } else {
      memoryDepartments.delete(id);
    }

    await logAudit('DELETE_DEPARTMENT', req.user, 'DEPARTMENT', id, null, req);
    return success(res, { id }, 200, 'Xóa phòng ban thành công');
  } catch (err) {
    return error(res, err.message);
  }
};

app.delete('/api/organization/departments/:id', requireAuth(['ADMIN', 'HR']), deleteDepartmentHandler);
app.delete('/api/departments/:id', requireAuth(['ADMIN', 'HR']), deleteDepartmentHandler);

// ==============================================================================
// 2. QUẢN LÝ CHỨC DANH (POSITIONS)
// ==============================================================================

const getPositionsHandler = async (req, res) => {
  try {
    const useDb = await isDbAvailable();
    let positions = [];

    if (useDb) {
      positions = await db.query(
        `SELECT p.*, d.name AS department_name
         FROM positions p
         LEFT JOIN departments d ON p.department_id = d.id
         ORDER BY p.created_at ASC`,
        [],
        DB_NAME
      );
    } else {
      positions = Array.from(memoryPositions.values()).map((p) => {
        const d = p.department_id ? memoryDepartments.get(p.department_id) : null;
        return {
          ...p,
          department_name: d ? d.name : null
        };
      });
    }

    return success(res, positions);
  } catch (err) {
    return error(res, err.message);
  }
};

app.get('/api/organization/positions', requireAuth(), getPositionsHandler);
app.get('/api/positions', requireAuth(), getPositionsHandler);

const createPositionHandler = async (req, res) => {
  try {
    const { code, title, department_id, base_salary_min, base_salary_max } = req.body;
    if (!code || !title) {
      return badRequest(res, 'Yêu cầu cung cấp mã và tên chức vụ');
    }

    const id = crypto.randomUUID();
    const useDb = await isDbAvailable();

    if (useDb) {
      const existing = await db.query('SELECT id FROM positions WHERE code = ?', [code], DB_NAME);
      if (existing.length > 0) return conflict(res, 'Mã chức danh đã tồn tại');

      await db.query(
        `INSERT INTO positions (id, code, title, department_id, base_salary_min, base_salary_max, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [id, code, title, department_id || null, base_salary_min || 0, base_salary_max || 0],
        DB_NAME
      );
    } else {
      for (const p of memoryPositions.values()) {
        if (p.code === code) return conflict(res, 'Mã chức danh đã tồn tại');
      }
      memoryPositions.set(id, {
        id,
        code,
        title,
        department_id,
        base_salary_min: base_salary_min || 0,
        base_salary_max: base_salary_max || 0,
        status: 'ACTIVE'
      });
    }

    await logAudit('CREATE_POSITION', req.user, 'POSITION', id, { code, title }, req);
    return created(res, { id, code, title }, 'Tạo chức danh thành công');
  } catch (err) {
    return error(res, err.message);
  }
};

app.post('/api/organization/positions', requireAuth(['ADMIN', 'HR']), createPositionHandler);
app.post('/api/positions', requireAuth(['ADMIN', 'HR']), createPositionHandler);

// ==============================================================================
// 3. QUẢN LÝ HỒ SƠ NHÂN SỰ (EMPLOYEES)
// ==============================================================================

const getEmployeesHandler = async (req, res) => {
  try {
    if (!req.user) return unauthorized(res, 'Yêu cầu đăng nhập');
    if (!['ADMIN', 'HR', 'MANAGER'].includes(req.user.role)) {
      return forbidden(res, 'Chỉ ADMIN, HR hoặc MANAGER mới có quyền xem danh sách nhân sự');
    }

    const { department_id, status, keyword } = req.query;
    const useDb = await isDbAvailable();
    let employees = [];

    if (useDb) {
      let sql = `
        SELECT e.*, d.name AS department_name, p.title AS position_title, m.full_name AS manager_name
        FROM employees e
        LEFT JOIN departments d ON e.department_id = d.id
        LEFT JOIN positions p ON e.position_id = p.id
        LEFT JOIN employees m ON e.manager_id = m.id
        WHERE 1=1
      `;
      const params = [];

      if (department_id) {
        sql += ' AND e.department_id = ?';
        params.push(department_id);
      }
      if (req.user.role === 'MANAGER') {
        const managerEmpId = req.user.empId || req.user.emp_id;
        if (!managerEmpId) return forbidden(res, 'Tài khoản quản lý chưa liên kết hồ sơ nhân sự');
        sql += ' AND (e.manager_id = ? OR e.id = ?)';
        params.push(managerEmpId, managerEmpId);
      }
      if (status) {
        sql += ' AND e.status = ?';
        params.push(status);
      }
      if (keyword) {
        sql += ' AND (e.full_name LIKE ? OR e.code LIKE ? OR e.email LIKE ?)';
        const kw = `%${keyword}%`;
        params.push(kw, kw, kw);
      }

      sql += ' ORDER BY e.created_at DESC';
      employees = await db.query(sql, params, DB_NAME);
    } else {
      employees = Array.from(memoryEmployees.values()).map((e) => {
        const d = e.department_id ? memoryDepartments.get(e.department_id) : null;
        const p = e.position_id ? memoryPositions.get(e.position_id) : null;
        const m = e.manager_id ? memoryEmployees.get(e.manager_id) : null;
        return {
          ...e,
          department_name: d ? d.name : null,
          position_title: p ? p.title : null,
          manager_name: m ? m.full_name : null
        };
      });

      if (department_id) {
        employees = employees.filter((e) => e.department_id === department_id);
      }
      if (req.user.role === 'MANAGER') {
        const managerEmpId = req.user.empId || req.user.emp_id;
        if (!managerEmpId) return forbidden(res, 'Tài khoản quản lý chưa liên kết hồ sơ nhân sự');
        employees = employees.filter((e) => e.manager_id === managerEmpId || e.id === managerEmpId);
      }
      if (status) {
        employees = employees.filter((e) => e.status === status);
      }
      if (keyword) {
        const kw = keyword.toLowerCase();
        employees = employees.filter(
          (e) =>
            e.full_name.toLowerCase().includes(kw) ||
            e.code.toLowerCase().includes(kw) ||
            e.email.toLowerCase().includes(kw)
        );
      }
    }

    if (req.user.role === 'MANAGER') {
      employees = employees.map(({ identity_card, ...employee }) => employee);
    }
    return success(res, employees);
  } catch (err) {
    return error(res, 'Lỗi lấy danh sách nhân sự: ' + err.message);
  }
};

app.get('/api/organization/employees', requireAuth(['ADMIN', 'HR', 'MANAGER']), getEmployeesHandler);
app.get('/api/employees', requireAuth(['ADMIN', 'HR', 'MANAGER']), getEmployeesHandler);

// Hồ sơ nhân sự của tài khoản đang đăng nhập
app.get('/api/organization/employees/me/profile', requireAuth(), async (req, res) => {
  try {
    const currentUser = req.user;
    if (!currentUser) return unauthorized(res);

    const empId = currentUser.empId || currentUser.emp_id;
    let employee = null;
    const useDb = await isDbAvailable();

    if (useDb) {
      if (empId) {
        const rows = await db.query('SELECT * FROM employees WHERE id = ? LIMIT 1', [empId], DB_NAME);
        employee = rows[0];
      }
      if (!employee && currentUser.email) {
        const rows = await db.query('SELECT * FROM employees WHERE email = ? LIMIT 1', [currentUser.email], DB_NAME);
        employee = rows[0];
      }
    } else {
      if (empId) employee = memoryEmployees.get(empId);
      if (!employee && currentUser.email) {
        employee = Array.from(memoryEmployees.values()).find((e) => e.email === currentUser.email);
      }
    }

    if (!employee) return notFound(res, 'Chưa tìm thấy hồ sơ nhân sự liên kết với tài khoản này');
    return success(res, employee);
  } catch (err) {
    return error(res, err.message);
  }
});

// Chi tiết hồ sơ một nhân sự
const getEmployeeDetailHandler = async (req, res) => {
  try {
    if (!req.user) return unauthorized(res, 'Yêu cầu đăng nhập');
    if (!['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'].includes(req.user.role)) {
      return forbidden(res, 'Vai trò hiện tại không được xem hồ sơ nhân sự');
    }

    const id = req.params.id;
    const useDb = await isDbAvailable();
    let emp = null;

    if (useDb) {
      const rows = await db.query(
        `SELECT e.*, d.name AS department_name, p.title AS position_title, m.full_name AS manager_name
         FROM employees e
         LEFT JOIN departments d ON e.department_id = d.id
         LEFT JOIN positions p ON e.position_id = p.id
         LEFT JOIN employees m ON e.manager_id = m.id
         WHERE e.id = ? OR e.code = ? LIMIT 1`,
        [id, id],
        DB_NAME
      );
      emp = rows[0] || null;
    } else {
      emp = memoryEmployees.get(id) || Array.from(memoryEmployees.values()).find((e) => e.code === id) || null;
    }

    if (!emp) return notFound(res, 'Không tìm thấy hồ sơ nhân sự');

    const userEmpId = req.user.empId || req.user.emp_id;
    const canView = ['ADMIN', 'HR'].includes(req.user.role)
      || (req.user.role === 'MANAGER' && userEmpId && (emp.manager_id === userEmpId || emp.id === userEmpId))
      || (req.user.role === 'EMPLOYEE' && userEmpId === emp.id);
    if (!canView) return forbidden(res, 'Bạn không có quyền xem hồ sơ nhân sự này');

    if (req.user.role === 'MANAGER') delete emp.identity_card;
    return success(res, emp);
  } catch (err) {
    return error(res, err.message);
  }
};

app.get('/api/organization/employees/:id', requireAuth(['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']), getEmployeeDetailHandler);
app.get('/api/employees/:id', requireAuth(['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']), getEmployeeDetailHandler);

// Tạo mới hồ sơ nhân sự (ADMIN, HR)
const createEmployeeHandler = async (req, res) => {
  try {
    const {
      code,
      full_name,
      email,
      phone,
      identity_card,
      gender,
      department_id,
      position_id,
      manager_id,
      join_date,
      contract_type
    } = req.body;

    if (!code || !full_name || !email) {
      return badRequest(res, 'Yêu cầu cung cấp mã nhân viên, họ tên và email');
    }

    const id = crypto.randomUUID();
    const joinDateVal = join_date || new Date().toISOString().split('T')[0];
    const contractTypeVal = contract_type || 'OFFICIAL';
    const useDb = await isDbAvailable();

    if (useDb) {
      const existing = await db.query('SELECT id FROM employees WHERE code = ? OR email = ?', [code, email], DB_NAME);
      if (existing.length > 0) return conflict(res, 'Mã nhân viên hoặc email đã tồn tại');

      await db.query(
        `INSERT INTO employees (id, code, full_name, email, phone, identity_card, gender, department_id, position_id, manager_id, join_date, contract_type, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [
          id,
          code,
          full_name,
          email,
          phone || null,
          identity_card || null,
          gender || 'MALE',
          department_id || null,
          position_id || null,
          manager_id || null,
          joinDateVal,
          contractTypeVal
        ],
        DB_NAME
      );
    } else {
      for (const e of memoryEmployees.values()) {
        if (e.code === code || e.email === email) return conflict(res, 'Mã nhân sự hoặc email đã tồn tại');
      }
      memoryEmployees.set(id, {
        id,
        code,
        full_name,
        email,
        phone,
        identity_card,
        gender: gender || 'MALE',
        department_id,
        position_id,
        manager_id,
        join_date: joinDateVal,
        contract_type: contractTypeVal,
        status: 'ACTIVE'
      });
    }

    await logAudit('CREATE_EMPLOYEE', req.user, 'EMPLOYEE', id, { code, full_name, email }, req);

    // Bắn sự kiện lên Event Bus
    events.publish('employee.created', {
      id,
      code,
      fullName: full_name,
      email,
      departmentId: department_id,
      positionId: position_id
    }, { source: 'organization-service' });

    return created(res, { id, code, full_name, email }, 'Tạo hồ sơ nhân sự thành công');
  } catch (err) {
    return error(res, err.message);
  }
};

app.post('/api/organization/employees', requireAuth(['ADMIN', 'HR']), createEmployeeHandler);
app.post('/api/employees', requireAuth(['ADMIN', 'HR']), createEmployeeHandler);

// Cập nhật hồ sơ nhân sự (ADMIN, HR)
const updateEmployeeHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const { full_name, phone, identity_card, department_id, position_id, manager_id, status, contract_type } = req.body;
    const useDb = await isDbAvailable();

    if (useDb) {
      await db.query(
        `UPDATE employees SET
          full_name = COALESCE(?, full_name),
          phone = COALESCE(?, phone),
          identity_card = COALESCE(?, identity_card),
          department_id = COALESCE(?, department_id),
          position_id = COALESCE(?, position_id),
          manager_id = COALESCE(?, manager_id),
          status = COALESCE(?, status),
          contract_type = COALESCE(?, contract_type)
         WHERE id = ?`,
        [full_name, phone, identity_card, department_id, position_id, manager_id, status, contract_type, id],
        DB_NAME
      );
    } else {
      const emp = memoryEmployees.get(id);
      if (!emp) return notFound(res, 'Không tìm thấy hồ sơ nhân sự');
      if (full_name) emp.full_name = full_name;
      if (phone !== undefined) emp.phone = phone;
      if (identity_card !== undefined) emp.identity_card = identity_card;
      if (department_id !== undefined) emp.department_id = department_id;
      if (position_id !== undefined) emp.position_id = position_id;
      if (manager_id !== undefined) emp.manager_id = manager_id;
      if (status) emp.status = status;
      if (contract_type) emp.contract_type = contract_type;
    }

    await logAudit('UPDATE_EMPLOYEE', req.user, 'EMPLOYEE', id, req.body, req);

    events.publish('employee.updated', {
      id,
      departmentId: department_id,
      positionId: position_id,
      status
    }, { source: 'organization-service' });

    return success(res, { id }, 200, 'Cập nhật hồ sơ nhân sự thành công');
  } catch (err) {
    return error(res, err.message);
  }
};

app.put('/api/organization/employees/:id', requireAuth(['ADMIN', 'HR']), updateEmployeeHandler);
app.put('/api/employees/:id', requireAuth(['ADMIN', 'HR']), updateEmployeeHandler);

// Đánh dấu nhân viên nghỉ việc hoặc xóa (ADMIN, HR)
const deleteEmployeeHandler = async (req, res) => {
  try {
    const id = req.params.id;
    const useDb = await isDbAvailable();

    if (useDb) {
      await db.query("UPDATE employees SET status = 'RESIGNED' WHERE id = ?", [id], DB_NAME);
    } else {
      const emp = memoryEmployees.get(id);
      if (emp) emp.status = 'RESIGNED';
    }

    await logAudit('RESIGN_EMPLOYEE', req.user, 'EMPLOYEE', id, { status: 'RESIGNED' }, req);

    events.publish('employee.resigned', { id }, { source: 'organization-service' });
    return success(res, { id, status: 'RESIGNED' }, 200, 'Đã cập nhật trạng thái nhân sự thành Nghỉ việc (RESIGNED)');
  } catch (err) {
    return error(res, err.message);
  }
};

app.delete('/api/organization/employees/:id', requireAuth(['ADMIN', 'HR']), deleteEmployeeHandler);
app.delete('/api/employees/:id', requireAuth(['ADMIN', 'HR']), deleteEmployeeHandler);

// ==============================================================================
// 4. NHẬT KÝ HỆ THỐNG (AUDIT LOGS - ADMIN ONLY)
// ==============================================================================
app.get('/api/organization/audit-logs', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const currentUser = req.user;
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return forbidden(res, 'Chỉ ADMIN mới có quyền truy cập nhật ký kiểm toán hệ thống');
    }

    const useDb = await isDbAvailable();
    let logs = [];

    if (useDb) {
      logs = await db.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100', [], DB_NAME);
    } else {
      logs = memoryAuditLogs.slice(0, 100);
    }

    return success(res, logs);
  } catch (err) {
    return error(res, err.message);
  }
});

// ==============================================================================
// 5. WEBHOOK NHẬN SỰ KIỆN TỪ EVENT BUS
// ==============================================================================
app.use(
  '/events',
  events.createWebhookRouter({
    'user.registered': async (event) => {
      const { userId, email, empId } = event.data || {};
      console.log(`[ORG-SERVICE] Nhận event user.registered: tài khoản "${email}" (id: ${userId})`);
      // Nếu user đăng ký chưa có emp_id, thử liên kết với employee theo email
      if (!empId && email) {
        const useDb = await isDbAvailable();
        if (useDb) {
          try {
            const rows = await db.query('SELECT id FROM employees WHERE email = ? LIMIT 1', [email], DB_NAME);
            if (rows.length > 0) {
              const matchedEmpId = rows[0].id;
              await db.query('UPDATE htqlns_auth.users SET emp_id = ? WHERE id = ?', [matchedEmpId, userId]);
              console.log(`[ORG-SERVICE] Đã tự động gắn emp_id ${matchedEmpId} cho user ${userId}`);
            }
          } catch {}
        }
      }
    }
  })
);

// OpenAPI Spec
app.get('/api-docs.json', (req, res) => {
  const spec = createOpenApiSpec('organization-service', {
    description: 'Organization Service – Quản lý Phòng ban & Nhân sự HTQLNS',
    paths: {
      '/api/organization/departments': {
        get: { summary: 'Lấy danh sách cơ cấu phòng ban' },
        post: { summary: 'Tạo phòng ban mới' }
      },
      '/api/organization/positions': {
        get: { summary: 'Lấy danh mục chức danh việc làm' }
      },
      '/api/organization/employees': {
        get: { summary: 'Lấy danh sách hồ sơ nhân sự' },
        post: { summary: 'Tạo mới hồ sơ nhân sự' }
      }
    }
  });
  res.json(spec);
});

app.useErrorHandler();

const server = app.start(PORT, () => {
  try {
    registerService({
      name: 'organization-service',
      port: PORT,
      url: process.env.SERVICE_URL || `http://localhost:${PORT}`
    });
  } catch (err) {
    console.warn('[ORGANIZATION-SERVICE] Không thể đăng ký với Registry:', err.message);
  }

  // Subscribe nhận sự kiện từ Event Bus
  setTimeout(async () => {
    try {
      await events.subscribe(['user.registered'], `http://localhost:${PORT}/events`, {
        serviceName: 'organization-service'
      });
    } catch {}
  }, 2000);
});

module.exports = { app, server };
