/**
 * services/shift-service/index.js
 * Microservice Quản lý Ca làm việc, Phân ca & Tăng ca OT (Cổng :3005)
 * Màn hình Figma: SCR_SHIFT_01, SCR_OT_01, SCR_OT_02, SCR_ADM_03, SCR_REQ_01
 */

const crypto = require('crypto');
const { createServiceApp, requireAuth, requireInternalKey } = require('../../shared/service-base');
const db = require('../../shared/db');
const registrar = require('../../shared/registrar');
const events = require('../../shared/events');
const { addEmployeeScope, getVisibleEmployeeIds, isDirectReport } = require('../../shared/employee-scope');

const SERVICE_NAME = 'shift-service';
const PORT = Number(process.env.SHIFT_SERVICE_PORT || 3005);
const DB_NAME = process.env.SHIFT_DB_NAME || 'htqlns_shift';

const pool = db.getPool(DB_NAME);

const app = createServiceApp(SERVICE_NAME, {
  port: PORT,
  checkHealth: async () => {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return rows && rows[0]?.ok === 1;
  }
});

// ==============================================================================
// 1. QUẢN LÝ DANH MỤC CA LÀM VIỆC (SCR_ADM_03)
// ==============================================================================

// Lấy danh sách ca làm việc
app.get(['/api/v1/shifts', '/api/shifts', '/api/shift'], requireAuth(), async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM shifts';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY start_time ASC';

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// Tạo ca làm việc mới (ADMIN, HR)
app.post(['/api/v1/shifts', '/api/shifts', '/api/shift'], requireAuth(['ADMIN', 'HR']), async (req, res, next) => {
  try {
    const {
      code,
      name,
      startTime,
      endTime,
      breakMinutes = 60,
      graceLateMinutes = 15,
      graceEarlyMinutes = 0,
      workingHours = 8.0
    } = req.body;

    if (!code || !name || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu thông tin bắt buộc: code, name, startTime, endTime'
      });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO shifts (id, code, name, start_time, end_time, break_minutes, grace_late_minutes, grace_early_minutes, working_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, code.trim().toUpperCase(), name.trim(), startTime, endTime, breakMinutes, graceLateMinutes, graceEarlyMinutes, workingHours]
    );

    const [created] = await pool.query('SELECT * FROM shifts WHERE id = ?', [id]);
    res.status(201).json({ success: true, message: 'Tạo ca làm việc thành công', data: created[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Mã ca làm việc đã tồn tại' });
    }
    next(err);
  }
});

// Cập nhật ca làm việc (ADMIN, HR)
app.put(['/api/v1/shifts/:id', '/api/shifts/:id', '/api/shift/:id'], requireAuth(['ADMIN', 'HR']), async (req, res, next) => {
  try {
    const { name, startTime, endTime, breakMinutes, graceLateMinutes, graceEarlyMinutes, workingHours, status } = req.body;
    const [existing] = await pool.query('SELECT * FROM shifts WHERE id = ?', [req.params.id]);
    if (!existing.length) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy ca làm việc' });
    }

    const current = existing[0];
    await pool.query(
      `UPDATE shifts
       SET name = ?, start_time = ?, end_time = ?, break_minutes = ?,
           grace_late_minutes = ?, grace_early_minutes = ?, working_hours = ?, status = ?
       WHERE id = ?`,
      [
        name ?? current.name,
        startTime ?? current.start_time,
        endTime ?? current.end_time,
        breakMinutes ?? current.break_minutes,
        graceLateMinutes ?? current.grace_late_minutes,
        graceEarlyMinutes ?? current.grace_early_minutes,
        workingHours ?? current.working_hours,
        status ?? current.status,
        req.params.id
      ]
    );

    const [updated] = await pool.query('SELECT * FROM shifts WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Cập nhật ca làm việc thành công', data: updated[0] });
  } catch (err) {
    next(err);
  }
});

// ==============================================================================
// 2. PHÂN CA & LỊCH TRỰC NHÂN VIÊN (SCR_SHIFT_01)
// ==============================================================================

// Xem lịch phân ca (theo khoảng ngày & empId)
app.get(['/api/v1/shift-assignments', '/api/shifts/assignments', '/api/shift/assignments'], requireAuth(), async (req, res, next) => {
  try {
    const { empId, fromDate, toDate } = req.query;
    const targetEmpId = req.user.role === 'EMPLOYEE' ? req.user.empId : empId;
    if (req.user.role === 'EMPLOYEE' && !targetEmpId) {
      return res.status(403).json({ success: false, error: 'Tài khoản chưa liên kết hồ sơ nhân sự' });
    }

    const conditions = [];
    const params = [];
    const employeeScope = await getVisibleEmployeeIds(req.user);
    addEmployeeScope(conditions, params, employeeScope, 'sa.emp_id');

    if (targetEmpId) {
      conditions.push('sa.emp_id = ?');
      params.push(targetEmpId);
    }
    if (fromDate) {
      conditions.push('sa.work_date >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push('sa.work_date <= ?');
      params.push(toDate);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT sa.*, s.code AS shift_code, s.name AS shift_name,
              s.start_time, s.end_time, s.grace_late_minutes, s.working_hours
       FROM shift_assignments sa
       JOIN shifts s ON sa.shift_id = s.id
       ${whereClause}
       ORDER BY sa.work_date DESC`,
      params
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// Phân ca cho một hoặc nhiều nhân viên (ADMIN, HR, MANAGER)
app.post(['/api/v1/shift-assignments', '/api/shifts/assignments', '/api/shift/assignments'], requireAuth(['ADMIN', 'HR', 'MANAGER']), async (req, res, next) => {
  try {
    const { empIds, shiftId, workDates, note = null } = req.body;
    if (!Array.isArray(empIds) || !empIds.length || !shiftId || !Array.isArray(workDates) || !workDates.length) {
      return res.status(400).json({
        success: false,
        error: 'Yêu cầu danh sách empIds, shiftId và danh sách workDates'
      });
    }
    if (req.user.role === 'MANAGER') {
      const visibleEmployeeIds = await getVisibleEmployeeIds(req.user);
      if (empIds.some((empId) => !visibleEmployeeIds.includes(empId))) {
        return res.status(403).json({ success: false, error: 'Bạn chỉ được phân ca cho chính mình hoặc nhân viên thuộc nhóm quản lý' });
      }
    }

    const [shifts] = await pool.query('SELECT id FROM shifts WHERE id = ? AND status = "ACTIVE"', [shiftId]);
    if (!shifts.length) {
      return res.status(404).json({ success: false, error: 'Ca làm việc không tồn tại hoặc đã ngưng hoạt động' });
    }

    let affected = 0;
    for (const empId of empIds) {
      for (const workDate of workDates) {
        const id = crypto.randomUUID();
        await pool.query(
          `INSERT INTO shift_assignments (id, emp_id, shift_id, work_date, note, assigned_by, status)
           VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED')
           ON DUPLICATE KEY UPDATE shift_id = VALUES(shift_id), note = VALUES(note), assigned_by = VALUES(assigned_by), status = 'SCHEDULED'`,
          [id, empId, shiftId, workDate, note, req.user.empId || req.user.userId]
        );
        affected++;
      }
    }

    res.status(201).json({
      success: true,
      message: `Đã phân ca thành công cho ${affected} lượt ngày công`
    });
  } catch (err) {
    next(err);
  }
});

// ==============================================================================
// 3. ĐĂNG KÝ & DUYỆT TĂNG CA OT (SCR_OT_01, SCR_OT_02, SCR_REQ_01)
// ==============================================================================

// Danh sách đơn tăng ca
app.get(['/api/v1/ot-requests', '/api/ot'], requireAuth(), async (req, res, next) => {
  try {
    const { status, empId } = req.query;
    const conditions = [];
    const params = [];
    const employeeScope = await getVisibleEmployeeIds(req.user);
    addEmployeeScope(conditions, params, employeeScope, 'emp_id');

    if (req.user.role === 'EMPLOYEE') {
      if (!req.user.empId) {
        return res.status(403).json({ success: false, error: 'Tài khoản chưa liên kết hồ sơ nhân sự' });
      }
      conditions.push('emp_id = ?');
      params.push(req.user.empId);
    } else if (empId) {
      conditions.push('emp_id = ?');
      params.push(empId);
    }

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT * FROM ot_requests ${whereClause} ORDER BY created_at DESC`,
      params
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// Tạo đơn đăng ký OT
app.post(['/api/v1/ot-requests', '/api/ot'], requireAuth(), async (req, res, next) => {
  try {
    const empId = req.body.empId && ['ADMIN', 'HR'].includes(req.user.role)
      ? req.body.empId
      : req.user.empId;

    const { workDate, startTime, endTime, totalHours, otType = 'WEEKDAY', reason } = req.body;

    if (!empId || !workDate || !startTime || !endTime || !totalHours || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu thông tin bắt buộc: workDate, startTime, endTime, totalHours, reason'
      });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO ot_requests (id, emp_id, work_date, start_time, end_time, total_hours, ot_type, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [id, empId, workDate, startTime, endTime, totalHours, otType, reason.trim()]
    );

    const [created] = await pool.query('SELECT * FROM ot_requests WHERE id = ?', [id]);

    // Bắn event sang Event Bus cho notification-service
    events.publish('OT_REQUEST_CREATED', {
      requestId: id,
      empId,
      workDate,
      totalHours
    }).catch(() => {});

    res.status(201).json({ success: true, message: 'Gửi đơn đăng ký tăng ca thành công', data: created[0] });
  } catch (err) {
    next(err);
  }
});

// Phê duyệt hoặc Từ chối đơn OT (ADMIN, HR, MANAGER)
app.patch('/api/v1/ot-requests/:id/decision', requireAuth(['ADMIN', 'HR', 'MANAGER']), async (req, res, next) => {
  try {
    const { decision, rejectReason = null } = req.body; // 'APPROVED' | 'REJECTED'
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'decision phải là APPROVED hoặc REJECTED' });
    }

    const [rows] = await pool.query('SELECT * FROM ot_requests WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy đơn đăng ký tăng ca' });
    }
    if (rows[0].status !== 'PENDING') {
      return res.status(400).json({ success: false, error: 'Đơn đã được xử lý trước đó' });
    }
    if (req.user.role === 'MANAGER' && !await isDirectReport(req.user.empId || req.user.emp_id, rows[0].emp_id)) {
      return res.status(403).json({ success: false, error: 'Bạn chỉ được xử lý đơn OT của nhân viên thuộc nhóm quản lý' });
    }

    const approverId = req.user.empId || req.user.userId;
    await pool.query(
      `UPDATE ot_requests
       SET status = ?, approver_id = ?, approved_at = NOW(), reject_reason = ?
       WHERE id = ?`,
      [decision, approverId, decision === 'REJECTED' ? rejectReason : null, req.params.id]
    );

    const [updated] = await pool.query('SELECT * FROM ot_requests WHERE id = ?', [req.params.id]);

    events.publish(`OT_REQUEST_${decision}`, {
      requestId: req.params.id,
      empId: rows[0].emp_id,
      approverId,
      workDate: rows[0].work_date,
      totalHours: rows[0].total_hours
    }).catch(() => {});

    res.json({
      success: true,
      message: decision === 'APPROVED' ? 'Đã phê duyệt đơn tăng ca' : 'Đã từ chối đơn tăng ca',
      data: updated[0]
    });
  } catch (err) {
    next(err);
  }
});

// ==============================================================================
// 4. INTERNAL API CHO CÁC MICROSERVICE KHÁC (attendance-service, payroll-service)
// ==============================================================================

// Lấy ca làm việc của 1 nhân viên trong ngày (attendance-service gọi khi check-in/out)
app.get('/internal/shifts/schedule', requireInternalKey, async (req, res, next) => {
  try {
    const { empId, date } = req.query;
    if (!empId || !date) {
      return res.status(400).json({ success: false, error: 'Thiếu empId hoặc date' });
    }

    const [rows] = await pool.query(
      `SELECT sa.id AS assignment_id, sa.work_date, sa.status AS assignment_status,
              s.id AS shift_id, s.code, s.name, s.start_time, s.end_time,
              s.grace_late_minutes, s.grace_early_minutes, s.working_hours
       FROM shift_assignments sa
       JOIN shifts s ON sa.shift_id = s.id
       WHERE sa.emp_id = ? AND sa.work_date = ? AND sa.status = 'SCHEDULED'
       LIMIT 1`,
      [empId, date]
    );

    // Fallback về Ca Hành Chính (CA-HC) nếu nhân viên chưa được phân ca riêng ngày hôm đó
    if (!rows.length) {
      const [defaultShift] = await pool.query(
        `SELECT NULL AS assignment_id, ? AS work_date, 'DEFAULT' AS assignment_status,
                id AS shift_id, code, name, start_time, end_time,
                grace_late_minutes, grace_early_minutes, working_hours
         FROM shifts WHERE code = 'CA-HC' AND status = 'ACTIVE' LIMIT 1`,
        [date]
      );
      return res.json({ success: true, data: defaultShift[0] || null });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Tổng hợp giờ OT đã duyệt trong tháng (payroll-service gọi khi tính lương)
app.get('/internal/ot/summary', requireInternalKey, async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const employeeScope = req.query.managerId
      ? await getVisibleEmployeeIds({ role: 'MANAGER', empId: req.query.managerId })
      : null;
    const conditions = ['status = ?', 'MONTH(work_date) = ?', 'YEAR(work_date) = ?'];
    const params = ['APPROVED', Number(month), Number(year)];
    addEmployeeScope(conditions, params, employeeScope, 'emp_id');
    const [rows] = await pool.query(
      `SELECT emp_id, ot_type, SUM(total_hours) AS total_ot_hours
       FROM ot_requests
       WHERE ${conditions.join(' AND ')}
       GROUP BY emp_id, ot_type`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

app.useErrorHandler();

app.start(PORT, () => {
  registrar.register({
    name: SERVICE_NAME,
    port: PORT,
    host: 'localhost',
    prefix: '/api/v1/shifts'
  });
});