/**
 * services/leave-service/index.js
 * Microservice Quản lý Nghỉ phép & Quỹ phép năm (Cổng :3004)
 */

const crypto = require('crypto');
const { createServiceApp, requireAuth, requireInternalKey } = require('../../shared/service-base');
const db = require('../../shared/db');
const registrar = require('../../shared/registrar');
const events = require('../../shared/events');
const { addEmployeeScope, getVisibleEmployeeIds, isDirectReport } = require('../../shared/employee-scope');

const SERVICE_NAME = 'leave-service';
const PORT = Number(process.env.LEAVE_SERVICE_PORT || 3004);
const DB_NAME = process.env.LEAVE_DB_NAME || 'htqlns_leave';

const pool = db.getPool(DB_NAME);

const app = createServiceApp(SERVICE_NAME, {
  port: PORT,
  checkHealth: async () => {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return rows && rows[0]?.ok === 1;
  }
});

// 1. Danh mục loại nghỉ phép (SCR_ADM_01)
app.get(['/api/v1/leave-types', '/api/leaves/types', '/api/leave/types'], requireAuth(), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM leave_types ORDER BY code ASC');
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

app.post(['/api/v1/leave-types', '/api/leaves/types', '/api/leave/types'], requireAuth(['ADMIN', 'HR']), async (req, res, next) => {
  try {
    const { code, name, isPaid = true, maxDaysPerYear = 12, requireAttachment = false } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, error: 'Thiếu code hoặc name' });
    }
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO leave_types (id, code, name, is_paid, max_days_per_year, require_attachment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, code.trim().toUpperCase(), name.trim(), Boolean(isPaid), maxDaysPerYear, Boolean(requireAttachment)]
    );
    const [created] = await pool.query('SELECT * FROM leave_types WHERE id = ?', [id]);
    res.status(201).json({ success: true, data: created[0] });
  } catch (err) {
    next(err);
  }
});

// 2. Tra cứu quỹ phép năm (SCR_LEAVE_03)
app.get(['/api/v1/leave-balances', '/api/leaves/balances', '/api/leave/balances'], requireAuth(), async (req, res, next) => {
  try {
    const empId = req.user.role === 'EMPLOYEE' ? req.user.empId : (req.query.empId || req.user.empId);
    if (req.user.role === 'EMPLOYEE' && !empId) {
      return res.status(403).json({ success: false, error: 'Tài khoản chưa liên kết hồ sơ nhân sự' });
    }
    if (req.user.role === 'MANAGER') {
      const visibleEmployeeIds = await getVisibleEmployeeIds(req.user);
      if (!empId || !visibleEmployeeIds.includes(empId)) {
        return res.status(403).json({ success: false, error: 'Bạn chỉ được xem quỹ phép của chính mình hoặc nhân viên thuộc nhóm quản lý' });
      }
    }
    const year = Number(req.query.year || new Date().getFullYear());

    const [rows] = await pool.query(
      `SELECT lb.*, (lb.total_days - lb.used_days - lb.pending_days) AS remaining_days,
              lt.code AS leave_code, lt.name AS leave_name, lt.is_paid
       FROM leave_balances lb
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       WHERE lb.emp_id = ? AND lb.year = ?`,
      [empId, year]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// 3. Danh sách đơn xin nghỉ phép (SCR_LEAVE_02, SCR_REQ_01)
app.get(['/api/v1/leave-requests', '/api/leaves', '/api/leave'], requireAuth(), async (req, res, next) => {
  try {
    const { status, empId, approvalQueue } = req.query;
    const conditions = [];
    const params = [];
    const employeeScope = await getVisibleEmployeeIds(req.user);
    addEmployeeScope(conditions, params, employeeScope, 'lr.emp_id');

    if (req.user.role === 'EMPLOYEE') {
      if (!req.user.empId) {
        return res.status(403).json({ success: false, error: 'Tài khoản chưa liên kết hồ sơ nhân sự' });
      }
      conditions.push('lr.emp_id = ?');
      params.push(req.user.empId);
    } else if (empId) {
      conditions.push('lr.emp_id = ?');
      params.push(empId);
    }
    if (req.user.role === 'MANAGER' && approvalQueue === 'true') {
      conditions.push('lr.emp_id <> ?');
      params.push(req.user.empId || req.user.emp_id);
    }
    if (status) {
      conditions.push('lr.status = ?');
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT lr.*, lt.code AS leave_code, lt.name AS leave_name, lt.is_paid
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       ${where}
       ORDER BY lr.created_at DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// 4. Tạo đơn xin nghỉ phép (SCR_LEAVE_01)
app.post(['/api/v1/leave-requests', '/api/leaves', '/api/leave'], requireAuth(), async (req, res, next) => {
  try {
    const empId = req.user.empId;
    const { leaveTypeId, startDate, endDate, totalDays, session = 'FULL_DAY', reason, attachmentUrl = null } = req.body;

    if (req.user.role === 'EMPLOYEE' && !empId) {
      return res.status(403).json({ success: false, error: 'Tài khoản chưa liên kết hồ sơ nhân sự' });
    }
    if (!empId || !leaveTypeId || !startDate || !endDate || !totalDays || !reason) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc' });
    }

    const year = new Date(startDate).getFullYear();
    const [balances] = await pool.query(
      'SELECT * FROM leave_balances WHERE emp_id = ? AND leave_type_id = ? AND year = ?',
      [empId, leaveTypeId, year]
    );

    if (balances.length) {
      const bal = balances[0];
      const remaining = Number(bal.total_days) - Number(bal.used_days) - Number(bal.pending_days);
      if (Number(totalDays) > remaining) {
        return res.status(400).json({
          success: false,
          error: `Số ngày phép còn lại không đủ (còn ${remaining} ngày, xin nghỉ ${totalDays} ngày)`
        });
      }
      await pool.query('UPDATE leave_balances SET pending_days = pending_days + ? WHERE id = ?', [totalDays, bal.id]);
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO leave_requests (id, emp_id, leave_type_id, start_date, end_date, total_days, session, reason, attachment_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [id, empId, leaveTypeId, startDate, endDate, totalDays, session, reason.trim(), attachmentUrl]
    );

    const [created] = await pool.query('SELECT * FROM leave_requests WHERE id = ?', [id]);
    events.publish('LEAVE_REQUEST_CREATED', { requestId: id, empId, startDate, endDate, totalDays }).catch(() => {});

    res.status(201).json({ success: true, message: 'Gửi đơn xin nghỉ phép thành công', data: created[0] });
  } catch (err) {
    next(err);
  }
});

// 5. Duyệt / Từ chối đơn xin nghỉ phép (SCR_REQ_01)
app.patch('/api/v1/leave-requests/:id/decision', requireAuth(['ADMIN', 'HR', 'MANAGER']), async (req, res, next) => {
  try {
    const { decision, rejectReason = null } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'decision phải là APPROVED hoặc REJECTED' });
    }

    const [rows] = await pool.query(
      `SELECT lr.*, lt.is_paid FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id = lt.id WHERE lr.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Không tìm thấy đơn nghỉ phép' });
    const leave = rows[0];
    if (leave.status !== 'PENDING') return res.status(400).json({ success: false, error: 'Đơn đã được xử lý' });
    if (req.user.role === 'MANAGER' && !await isDirectReport(req.user.empId || req.user.emp_id, leave.emp_id)) {
      return res.status(403).json({ success: false, error: 'Bạn chỉ được xử lý đơn nghỉ phép của nhân viên thuộc nhóm quản lý' });
    }

    const approverId = req.user.empId || req.user.userId;
    await pool.query(
      `UPDATE leave_requests SET status = ?, approver_id = ?, approved_at = NOW(), reject_reason = ? WHERE id = ?`,
      [decision, approverId, decision === 'REJECTED' ? rejectReason : null, leave.id]
    );

    // Cập nhật quỹ phép năm
    const year = new Date(leave.start_date).getFullYear();
    if (decision === 'APPROVED') {
      await pool.query(
        `UPDATE leave_balances
         SET pending_days = GREATEST(0, pending_days - ?), used_days = used_days + ?
         WHERE emp_id = ? AND leave_type_id = ? AND year = ?`,
        [leave.total_days, leave.total_days, leave.emp_id, leave.leave_type_id, year]
      );
    } else {
      await pool.query(
        `UPDATE leave_balances
         SET pending_days = GREATEST(0, pending_days - ?)
         WHERE emp_id = ? AND leave_type_id = ? AND year = ?`,
        [leave.total_days, leave.emp_id, leave.leave_type_id, year]
      );
    }

    events.publish(`LEAVE_REQUEST_${decision}`, {
      requestId: leave.id,
      empId: leave.emp_id,
      startDate: leave.start_date,
      endDate: leave.end_date,
      totalDays: leave.total_days,
      isPaid: Boolean(leave.is_paid)
    }).catch(() => {});

    const [updated] = await pool.query('SELECT * FROM leave_requests WHERE id = ?', [leave.id]);
    res.json({ success: true, message: `Đã ${decision === 'APPROVED' ? 'duyệt' : 'từ chối'} đơn nghỉ phép`, data: updated[0] });
  } catch (err) {
    next(err);
  }
});

// Internal API cho Payroll Service tổng hợp ngày nghỉ có lương trong tháng
app.get('/internal/leaves/monthly-summary', requireInternalKey, async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const employeeScope = req.query.managerId
      ? await getVisibleEmployeeIds({ role: 'MANAGER', empId: req.query.managerId })
      : null;
    const conditions = ['lr.status = ?', 'MONTH(lr.start_date) = ?', 'YEAR(lr.start_date) = ?'];
    const params = ['APPROVED', Number(month), Number(year)];
    addEmployeeScope(conditions, params, employeeScope, 'lr.emp_id');
    const [rows] = await pool.query(
      `SELECT lr.emp_id,
              SUM(CASE WHEN lt.is_paid = TRUE THEN lr.total_days ELSE 0 END) AS paid_leave_days,
              SUM(CASE WHEN lt.is_paid = FALSE THEN lr.total_days ELSE 0 END) AS unpaid_leave_days
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY lr.emp_id`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

app.useErrorHandler();
app.start(PORT, () => {
  registrar.register({ name: SERVICE_NAME, port: PORT, host: 'localhost', prefix: '/api/v1/leave-requests' });
});