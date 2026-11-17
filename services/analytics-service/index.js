/**
 * services/analytics-service/index.js
 * Microservice Dashboard Chuyên cần, Năng suất & Cảnh báo Ngưỡng (Cổng :3008)
 */

const crypto = require('crypto');
const { createServiceApp, requireAuth } = require('../../shared/service-base');
const db = require('../../shared/db');
const registrar = require('../../shared/registrar');
const env = require('../../shared/env');

const SERVICE_NAME = 'analytics-service';
const PORT = Number(process.env.ANALYTICS_SERVICE_PORT || 3008);
const DB_NAME = process.env.ANALYTICS_DB_NAME || 'htqlns_analytics';

const ATTENDANCE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://localhost:3003';
const LEAVE_URL = process.env.LEAVE_SERVICE_URL || 'http://localhost:3004';
const SHIFT_URL = process.env.SHIFT_SERVICE_URL || 'http://localhost:3005';
const PAYROLL_URL = process.env.PAYROLL_SERVICE_URL || 'http://localhost:3006';

const pool = db.getPool(DB_NAME);

const app = createServiceApp(SERVICE_NAME, {
  port: PORT,
  checkHealth: async () => {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return rows && rows[0]?.ok === 1;
  }
});

async function fetchInternal(url, serviceName) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'x-internal-key': env.INTERNAL_API_KEY },
      signal: AbortSignal.timeout(3000)
    });
  } catch (err) {
    const unavailable = new Error(`Không thể kết nối ${serviceName}: ${err.message}`);
    unavailable.status = 503;
    throw unavailable;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    const unavailable = new Error(`${serviceName} trả về dữ liệu không hợp lệ`);
    unavailable.status = 503;
    throw unavailable;
  }

  if (!res.ok || !json.success) {
    const unavailable = new Error(`${serviceName} không thể cung cấp dữ liệu${json.error ? `: ${json.error}` : ''}`);
    unavailable.status = 503;
    throw unavailable;
  }

  return json.data;
}

// 1. Dashboard tổng hợp chỉ số chuyên cần, OT, nghỉ phép và quỹ lương (SCR_DASH_01)
app.get(['/api/v1/analytics/dashboard', '/api/analytics/dashboard', '/api/analytics'], requireAuth(['ADMIN', 'HR', 'MANAGER']), async (req, res, next) => {
  try {
    const managerId = req.user.role === 'MANAGER' ? (req.user.empId || req.user.emp_id) : null;
    if (req.user.role === 'MANAGER' && !managerId) {
      return res.status(403).json({ success: false, error: 'Tài khoản quản lý chưa liên kết hồ sơ nhân sự' });
    }
    const month = Number(req.query.month || new Date().getMonth() + 1);
    const year = Number(req.query.year || new Date().getFullYear());
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 9999) {
      return res.status(400).json({ success: false, error: 'Tháng hoặc năm thống kê không hợp lệ' });
    }

    const managerScope = managerId ? `&managerId=${encodeURIComponent(managerId)}` : '';
    const [attList, leaveList, otList, payrollSum] = await Promise.all([
      fetchInternal(`${ATTENDANCE_URL}/internal/attendances/monthly-summary?month=${month}&year=${year}${managerScope}`, 'Attendance Service'),
      fetchInternal(`${LEAVE_URL}/internal/leaves/monthly-summary?month=${month}&year=${year}${managerScope}`, 'Leave Service'),
      fetchInternal(`${SHIFT_URL}/internal/ot/summary?month=${month}&year=${year}${managerScope}`, 'Shift Service'),
      fetchInternal(`${PAYROLL_URL}/internal/payrolls/summary?month=${month}&year=${year}${managerScope}`, 'Payroll Service')
    ]);
    if (!Array.isArray(attList) || !Array.isArray(leaveList) || !Array.isArray(otList) || !payrollSum) {
      const invalid = new Error('Dữ liệu tổng hợp từ dịch vụ thành phần không đúng định dạng');
      invalid.status = 503;
      throw invalid;
    }

    const totalWorkDays = attList.reduce((acc, r) => acc + Number(r.actual_work_days || 0), 0);
    const totalOnTimeDays = attList.reduce((acc, r) => acc + Number(r.on_time_days || 0), 0);
    const totalLateDays = attList.reduce((acc, r) => acc + Number(r.late_days || 0), 0);
    const totalAbsentDays = attList.reduce((acc, r) => acc + Number(r.absent_days || 0), 0);
    const totalLateMinutes = attList.reduce((acc, r) => acc + Number(r.total_late_minutes || 0), 0);
    const totalWorkingHours = attList.reduce((acc, r) => acc + Number(r.total_working_hours || 0), 0);
    const totalLeaveDays = leaveList.reduce((acc, r) => acc + Number(r.paid_leave_days || 0) + Number(r.unpaid_leave_days || 0), 0);
    const totalOtHours = otList.reduce((acc, r) => acc + Number(r.total_ot_hours || 0), 0);
    const lateEmployees = attList
      .filter((r) => Number(r.late_days || 0) > 0)
      .map((r) => ({
        empId: r.emp_id,
        lateDays: Number(r.late_days || 0),
        lateMinutes: Number(r.total_late_minutes || 0)
      }));

    // Kiểm tra cảnh báo vượt ngưỡng OT (> 40h/tháng)
    const alerts = [];
    for (const ot of otList) {
      if (Number(ot.total_ot_hours) > 40) {
        alerts.push({
          type: 'OT_THRESHOLD_EXCEEDED',
          empId: ot.emp_id,
          value: Number(ot.total_ot_hours),
          message: `Nhân sự ${ot.emp_id} có tổng giờ OT ${ot.total_ot_hours}h vượt ngưỡng 40h/tháng`
        });
      }
    }

    res.json({
      success: true,
      data: {
        period: { month, year },
        kpis: {
          totalWorkDays,
          totalOnTimeDays,
          totalLateDays,
          totalAbsentDays,
          totalLateMinutes,
          totalWorkingHours,
          totalLeaveDays,
          totalOtHours,
          totalNetPayroll: ['ADMIN', 'HR'].includes(req.user.role) ? Number(payrollSum.total_net_salary || 0) : null,
          activeHeadcount: Number(payrollSum.employee_count ?? attList.length)
        },
        lateEmployees,
        alerts
      }
    });
  } catch (err) {
    next(err);
  }
});

// 2. Danh sách cấu hình ngưỡng cảnh báo (SCR_REP_01)
app.get(['/api/v1/analytics/thresholds', '/api/analytics/thresholds'], requireAuth(['ADMIN', 'HR']), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM alert_thresholds');
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

app.useErrorHandler();
app.start(PORT, () => {
  registrar.register({ name: SERVICE_NAME, port: PORT, host: 'localhost', prefix: '/api/v1/analytics' });
});