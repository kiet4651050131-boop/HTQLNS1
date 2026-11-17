/**
 * services/payroll-service/index.js
 * Microservice Tính lương, Chốt kỳ lương & Phiếu lương Payslip (Cổng :3006)
 */

const crypto = require('crypto');
const { createServiceApp, requireAuth, requireInternalKey } = require('../../shared/service-base');
const db = require('../../shared/db');
const registrar = require('../../shared/registrar');
const events = require('../../shared/events');
const env = require('../../shared/env');
const { addEmployeeScope, getVisibleEmployeeIds } = require('../../shared/employee-scope');

const SERVICE_NAME = 'payroll-service';
const PORT = Number(process.env.PAYROLL_SERVICE_PORT || 3006);
const DB_NAME = process.env.PAYROLL_DB_NAME || 'htqlns_payroll';

const ATTENDANCE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://localhost:3003';
const LEAVE_URL = process.env.LEAVE_SERVICE_URL || 'http://localhost:3004';
const SHIFT_URL = process.env.SHIFT_SERVICE_URL || 'http://localhost:3005';

const pool = db.getPool(DB_NAME);

const app = createServiceApp(SERVICE_NAME, {
  port: PORT,
  checkHealth: async () => {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return rows && rows[0]?.ok === 1;
  }
});

async function fetchInternalJson(url) {
  try {
    const res = await fetch(url, { headers: { 'x-internal-key': env.INTERNAL_API_KEY } });
    const data = await res.json();
    return data.success ? data.data : [];
  } catch {
    return [];
  }
}

// 1. Cấu hình lương nhân viên (SCR_ADM_04)
app.get(['/api/v1/payroll-configs', '/api/payroll/configs', '/api/payroll'], requireAuth(['ADMIN', 'HR']), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM payroll_configs');
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// 2. Chạy tính lương tự động cho toàn bộ nhân viên theo tháng/năm (SCR_ADM_07)
app.post(['/api/v1/payrolls/calculate', '/api/payroll/calculate'], requireAuth(['ADMIN', 'HR']), async (req, res, next) => {
  try {
    const month = Number(req.body.month || new Date().getMonth() + 1);
    const year = Number(req.body.year || new Date().getFullYear());
    const standardDays = Number(req.body.standardWorkingDays || 22);

    // Tạo hoặc lấy kỳ lương
    let [periods] = await pool.query('SELECT * FROM payroll_periods WHERE month = ? AND year = ?', [month, year]);
    let periodId;
    if (!periods.length) {
      periodId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO payroll_periods (id, month, year, standard_working_days, status) VALUES (?, ?, ?, ?, "CALCULATED")',
        [periodId, month, year, standardDays]
      );
    } else {
      if (periods[0].status === 'LOCKED' || periods[0].status === 'PAID') {
        return res.status(400).json({ success: false, error: 'Kỳ lương đã chốt, không thể tính lại' });
      }
      periodId = periods[0].id;
      await pool.query('UPDATE payroll_periods SET standard_working_days = ?, status = "CALCULATED" WHERE id = ?', [standardDays, periodId]);
    }

    // Tổng hợp dữ liệu từ 3 microservice: Attendance, Leave, Shift (OT)
    const [configs] = await pool.query('SELECT * FROM payroll_configs');
    const attSummary = await fetchInternalJson(`${ATTENDANCE_URL}/internal/attendances/monthly-summary?month=${month}&year=${year}`);
    const leaveSummary = await fetchInternalJson(`${LEAVE_URL}/internal/leaves/monthly-summary?month=${month}&year=${year}`);
    const otSummary = await fetchInternalJson(`${SHIFT_URL}/internal/ot/summary?month=${month}&year=${year}`);

    const attMap = Object.fromEntries(attSummary.map((r) => [r.emp_id, r]));
    const leaveMap = Object.fromEntries(leaveSummary.map((r) => [r.emp_id, r]));

    for (const cfg of configs) {
      const att = attMap[cfg.emp_id] || { actual_work_days: 0, total_late_minutes: 0 };
      const lv = leaveMap[cfg.emp_id] || { paid_leave_days: 0 };
      const empOts = otSummary.filter((o) => o.emp_id === cfg.emp_id);

      const baseSalary = Number(cfg.base_salary);
      const dailyRate = baseSalary / standardDays;
      const hourlyRate = dailyRate / 8;

      const actualWorkDays = Number(att.actual_work_days || 0);
      const paidLeaveDays = Number(lv.paid_leave_days || 0);
      const totalPaidDays = Math.min(standardDays, actualWorkDays + paidLeaveDays);

      let otHours = 0;
      let otPay = 0;
      for (const item of empOts) {
        const hrs = Number(item.total_ot_hours || 0);
        const mult = item.ot_type === 'WEEKEND' ? Number(cfg.ot_multiplier_weekend) : Number(cfg.ot_multiplier_weekday);
        otHours += hrs;
        otPay += hrs * hourlyRate * mult;
      }

      const salaryByDays = dailyRate * totalPaidDays;
      const totalAllowance = Number(cfg.lunch_allowance) + Number(cfg.transport_allowance);
      const grossSalary = Math.round(salaryByDays + otPay + totalAllowance);

      const insuranceDeduction = Math.round(baseSalary * Number(cfg.insurance_rate));
      const lateDeduction = Math.round(Number(att.total_late_minutes || 0) * Number(cfg.late_penalty_per_minute));
      const taxableIncome = Math.max(0, grossSalary - insuranceDeduction - 11000000);
      const taxDeduction = Math.round(taxableIncome * 0.05);

      const netSalary = Math.max(0, grossSalary - insuranceDeduction - lateDeduction - taxDeduction);

      const payslipId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO payslips
         (id, period_id, emp_id, month, year, base_salary, standard_days, actual_work_days, paid_leave_days,
          ot_hours, ot_pay, total_allowance, gross_salary, insurance_deduction, late_deduction, tax_deduction, net_salary, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
         ON DUPLICATE KEY UPDATE
           actual_work_days = VALUES(actual_work_days), paid_leave_days = VALUES(paid_leave_days),
           ot_hours = VALUES(ot_hours), ot_pay = VALUES(ot_pay), gross_salary = VALUES(gross_salary),
           insurance_deduction = VALUES(insurance_deduction), late_deduction = VALUES(late_deduction),
           tax_deduction = VALUES(tax_deduction), net_salary = VALUES(net_salary)`,
        [
          payslipId, periodId, cfg.emp_id, month, year, baseSalary, standardDays, actualWorkDays, paidLeaveDays,
          otHours, Math.round(otPay), totalAllowance, grossSalary, insuranceDeduction, lateDeduction, taxDeduction, netSalary
        ]
      );
    }

    const [payslips] = await pool.query('SELECT * FROM payslips WHERE period_id = ?', [periodId]);
    res.json({ success: true, message: `Đã tính bảng lương tháng ${month}/${year} cho ${payslips.length} nhân sự`, data: payslips });
  } catch (err) {
    next(err);
  }
});

// 3. Xem danh sách phiếu lương / Phiếu lương cá nhân (SCR_PAY_01)
app.get(['/api/v1/payslips', '/api/payslips'], requireAuth(['ADMIN', 'HR', 'EMPLOYEE']), async (req, res, next) => {
  try {
    const { month, year, empId } = req.query;
    const conditions = [];
    const params = [];

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
    if (month) { conditions.push('month = ?'); params.push(Number(month)); }
    if (year) { conditions.push('year = ?'); params.push(Number(year)); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(`SELECT * FROM payslips ${where} ORDER BY year DESC, month DESC`, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// 4. Chốt kỳ lương & phát hành phiếu lương (SCR_ADM_07)
app.post(['/api/v1/payrolls/publish', '/api/payroll/publish'], requireAuth(['ADMIN', 'HR']), async (req, res, next) => {
  try {
    const { month, year } = req.body;
    const [periods] = await pool.query('SELECT * FROM payroll_periods WHERE month = ? AND year = ?', [Number(month), Number(year)]);
    if (!periods.length) return res.status(404).json({ success: false, error: 'Chưa có bảng tính lương kỳ này' });

    const period = periods[0];
    await pool.query('UPDATE payroll_periods SET status = "LOCKED", closed_by = ?, closed_at = NOW() WHERE id = ?', [req.user.empId || req.user.userId, period.id]);
    await pool.query('UPDATE payslips SET status = "CONFIRMED" WHERE period_id = ?', [period.id]);

    events.publish('PAYSLIP_PUBLISHED', { month: Number(month), year: Number(year), periodId: period.id }).catch(() => {});
    res.json({ success: true, message: `Đã chốt và phát hành phiếu lương tháng ${month}/${year}` });
  } catch (err) {
    next(err);
  }
});

// Internal API cho Analytics Service
app.get('/internal/payrolls/summary', requireInternalKey, async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const employeeScope = req.query.managerId
      ? await getVisibleEmployeeIds({ role: 'MANAGER', empId: req.query.managerId })
      : null;
    const conditions = ['month = ?', 'year = ?'];
    const params = [Number(month), Number(year)];
    addEmployeeScope(conditions, params, employeeScope, 'emp_id');
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS employee_count, COALESCE(SUM(net_salary), 0) AS total_net_salary
       FROM payslips
       WHERE ${conditions.join(' AND ')}`,
      params
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

app.useErrorHandler();
app.start(PORT, () => {
  registrar.register({ name: SERVICE_NAME, port: PORT, host: 'localhost', prefix: '/api/v1/payslips' });
});