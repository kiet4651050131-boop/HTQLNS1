/**
 * services/attendance-service/index.js
 * Microservice Quản lý Chấm công (GPS/WiFi/FaceID) & Giải trình công (Cổng :3003)
 * Màn hình Figma: SCR_ATT_01, SCR_ATT_02, SCR_ATT_03, SCR_ATT_04, SCR_ADM_02
 */

const crypto = require('crypto');
const { createServiceApp, requireAuth, requireInternalKey } = require('../../shared/service-base');
const db = require('../../shared/db');
const registrar = require('../../shared/registrar');
const events = require('../../shared/events');
const env = require('../../shared/env');
const { addEmployeeScope, getVisibleEmployeeIds, isDirectReport } = require('../../shared/employee-scope');

const SERVICE_NAME = 'attendance-service';
const PORT = Number(process.env.ATTENDANCE_SERVICE_PORT || 3003);
const DB_NAME = process.env.ATTENDANCE_DB_NAME || 'htqlns_attendance';
const SHIFT_SERVICE_URL = process.env.SHIFT_SERVICE_URL || 'http://localhost:3005';

const pool = db.getPool(DB_NAME);

const app = createServiceApp(SERVICE_NAME, {
  port: PORT,
  checkHealth: async () => {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return rows && rows[0]?.ok === 1;
  }
});

// ==============================================================================
// HÀM TIỆN ÍCH: TÍNH KHOẢNG CÁCH GPS (HAVERSINE) & GỌI SHIFT-SERVICE
// ==============================================================================

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Bán kính Trái Đất (mét)
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

async function fetchEmployeeShift(empId, workDate) {
  try {
    const url = `${SHIFT_SERVICE_URL}/internal/shifts/schedule?empId=${encodeURIComponent(empId)}&date=${encodeURIComponent(workDate)}`;
    const resp = await fetch(url, {
      headers: { 'x-internal-key': env.INTERNAL_API_KEY }
    });
    const json = await resp.json();
    return json.success ? json.data : null;
  } catch (err) {
    console.warn(`[${SERVICE_NAME}] Không gọi được shift-service:`, err.message);
    return null;
  }
}

function parseTimeOnDate(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`);
}

// ==============================================================================
// 1. CẤU HÌNH ĐỊA ĐIỂM CHẤM CÔNG GPS / WIFI (SCR_ADM_02)
// ==============================================================================

app.get(['/api/v1/work-locations', '/api/work-locations', '/api/attendance/work-locations'], requireAuth(), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM work_locations ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

app.post(['/api/v1/work-locations', '/api/work-locations', '/api/attendance/work-locations'], requireAuth(['ADMIN', 'HR']), async (req, res, next) => {
  try {
    const {
      code,
      name,
      address = null,
      latitude,
      longitude,
      radiusMeters = 100,
      wifiSsid = null,
      wifiBssid = null,
      requireFaceId = false
    } = req.body;

    if (!code || !name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu thông tin bắt buộc: code, name, latitude, longitude'
      });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO work_locations (id, code, name, address, latitude, longitude, radius_meters, wifi_ssid, wifi_bssid, require_face_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, code.trim().toUpperCase(), name.trim(), address, latitude, longitude, radiusMeters, wifiSsid, wifiBssid, Boolean(requireFaceId)]
    );

    const [created] = await pool.query('SELECT * FROM work_locations WHERE id = ?', [id]);
    res.status(201).json({ success: true, message: 'Thêm địa điểm chấm công thành công', data: created[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Mã địa điểm đã tồn tại' });
    }
    next(err);
  }
});

// ==============================================================================
// 2. CHẤM CÔNG CHECK-IN / CHECK-OUT (SCR_ATT_01)
// ==============================================================================

app.post(['/api/v1/attendances/check-in', '/api/attendance/check-in'], requireAuth(), async (req, res, next) => {
  try {
    const empId = req.user.empId;
    if (!empId) {
      return res.status(400).json({ success: false, error: 'Tài khoản chưa liên kết hồ sơ nhân sự (empId)' });
    }

    const { latitude, longitude, wifiSsid, method = 'GPS', bypassGeofence = false } = req.body;
    const now = new Date();
    const workDate = now.toISOString().slice(0, 10);

    // Kiểm tra đã check-in hôm nay chưa
    const [existing] = await pool.query(
      'SELECT * FROM attendance_logs WHERE emp_id = ? AND work_date = ?',
      [empId, workDate]
    );
    if (existing.length && existing[0].check_in_time) {
      return res.status(400).json({
        success: false,
        error: 'Bạn đã chấm công vào (Check-in) ngày hôm nay rồi',
        data: existing[0]
      });
    }

    // Kiểm tra vùng hợp lệ (GPS Geofence hoặc WiFi SSID)
    const [locations] = await pool.query('SELECT * FROM work_locations WHERE status = "ACTIVE"');
    let matchedLocation = null;
    let minDistance = null;

    for (const loc of locations) {
      if (method === 'WIFI' && wifiSsid && loc.wifi_ssid === wifiSsid) {
        matchedLocation = loc;
        minDistance = 0;
        break;
      }
      if (latitude !== undefined && longitude !== undefined) {
        const dist = calculateDistanceMeters(Number(latitude), Number(longitude), Number(loc.latitude), Number(loc.longitude));
        if (minDistance === null || dist < minDistance) {
          minDistance = dist;
        }
        if (dist <= Number(loc.radius_meters)) {
          matchedLocation = loc;
          minDistance = dist;
          break;
        }
      }
    }

    if (!matchedLocation && !bypassGeofence) {
      return res.status(403).json({
        success: false,
        error: `Ngoài phạm vi chấm công cho phép (cách văn phòng gần nhất ${minDistance ?? '?'}m)`,
        code: 'OUT_OF_RANGE',
        distanceMeters: minDistance
      });
    }

    // Lấy thông tin ca làm việc từ shift-service để tính đi muộn
    const shift = await fetchEmployeeShift(empId, workDate);
    let lateMinutes = 0;
    let status = 'ON_TIME';

    if (shift && shift.start_time) {
      const shiftStart = parseTimeOnDate(workDate, shift.start_time);
      const graceMs = Number(shift.grace_late_minutes || 0) * 60 * 1000;
      if (now.getTime() > shiftStart.getTime() + graceMs) {
        lateMinutes = Math.floor((now.getTime() - shiftStart.getTime()) / 60000);
        status = 'LATE';
      }
    }

    const id = existing.length ? existing[0].id : crypto.randomUUID();
    if (existing.length) {
      await pool.query(
        `UPDATE attendance_logs
         SET shift_id = ?, location_id = ?, check_in_time = ?, check_in_lat = ?, check_in_lng = ?,
             check_in_distance_m = ?, check_in_method = ?, late_minutes = ?, status = ?
         WHERE id = ?`,
        [shift?.shift_id || null, matchedLocation?.id || null, now, latitude || null, longitude || null, minDistance, method, lateMinutes, status, id]
      );
    } else {
      await pool.query(
        `INSERT INTO attendance_logs
         (id, emp_id, work_date, shift_id, location_id, check_in_time, check_in_lat, check_in_lng, check_in_distance_m, check_in_method, late_minutes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, empId, workDate, shift?.shift_id || null, matchedLocation?.id || null, now, latitude || null, longitude || null, minDistance, method, lateMinutes, status]
      );
    }

    const [saved] = await pool.query('SELECT * FROM attendance_logs WHERE id = ?', [id]);

    if (status === 'LATE') {
      events.publish('ATTENDANCE_LATE', {
        attendanceId: id,
        empId,
        workDate,
        lateMinutes
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      message: status === 'LATE'
        ? `Check-in thành công (Đi muộn ${lateMinutes} phút)`
        : 'Check-in đúng giờ thành công',
      data: saved[0]
    });
  } catch (err) {
    next(err);
  }
});

app.post(['/api/v1/attendances/check-out', '/api/attendance/check-out'], requireAuth(), async (req, res, next) => {
  try {
    const empId = req.user.empId;
    const { latitude, longitude, method = 'GPS' } = req.body;
    const now = new Date();
    const workDate = now.toISOString().slice(0, 10);

    const [rows] = await pool.query(
      'SELECT * FROM attendance_logs WHERE emp_id = ? AND work_date = ?',
      [empId, workDate]
    );
    if (!rows.length || !rows[0].check_in_time) {
      return res.status(400).json({ success: false, error: 'Bạn chưa Check-in hôm nay nên không thể Check-out' });
    }

    const record = rows[0];
    const checkInTime = new Date(record.check_in_time);
    const workedHours = Math.max(0, Number(((now.getTime() - checkInTime.getTime()) / 3600000).toFixed(2)));

    // Kiểm tra về sớm theo ca làm việc
    const shift = await fetchEmployeeShift(empId, workDate);
    let earlyLeaveMinutes = 0;
    let status = record.status;

    if (shift && shift.end_time) {
      const shiftEnd = parseTimeOnDate(workDate, shift.end_time);
      const graceMs = Number(shift.grace_early_minutes || 0) * 60 * 1000;
      if (now.getTime() < shiftEnd.getTime() - graceMs) {
        earlyLeaveMinutes = Math.floor((shiftEnd.getTime() - now.getTime()) / 60000);
        status = record.late_minutes > 0 ? 'LATE_AND_EARLY' : 'EARLY_LEAVE';
      }
    }

    await pool.query(
      `UPDATE attendance_logs
       SET check_out_time = ?, check_out_lat = ?, check_out_lng = ?, check_out_method = ?,
           early_leave_minutes = ?, actual_working_hours = ?, status = ?
       WHERE id = ?`,
      [now, latitude || null, longitude || null, method, earlyLeaveMinutes, workedHours, status, record.id]
    );

    const [updated] = await pool.query('SELECT * FROM attendance_logs WHERE id = ?', [record.id]);
    res.json({
      success: true,
      message: 'Check-out thành công',
      data: updated[0]
    });
  } catch (err) {
    next(err);
  }
});

// ==============================================================================
// 3. LỊCH SỬ CHẤM CÔNG & ĐƠN GIẢI TRÌNH CÔNG (SCR_ATT_02, SCR_ATT_03, SCR_ATT_04)
// ==============================================================================

app.get(['/api/v1/attendances', '/api/attendance'], requireAuth(), async (req, res, next) => {
  try {
    const { empId, fromDate, toDate, status } = req.query;
    const targetEmpId = req.user.role === 'EMPLOYEE' ? req.user.empId : empId;
    if (req.user.role === 'EMPLOYEE' && !targetEmpId) {
      return res.status(403).json({ success: false, error: 'Tài khoản chưa liên kết hồ sơ nhân sự' });
    }

    const conditions = [];
    const params = [];
    const employeeScope = await getVisibleEmployeeIds(req.user);
    addEmployeeScope(conditions, params, employeeScope, 'a.emp_id');

    if (targetEmpId) {
      conditions.push('a.emp_id = ?');
      params.push(targetEmpId);
    }
    if (fromDate) {
      conditions.push('a.work_date >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push('a.work_date <= ?');
      params.push(toDate);
    }
    if (status) {
      conditions.push('a.status = ?');
      params.push(status);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT a.*, w.name AS location_name
       FROM attendance_logs a
       LEFT JOIN work_locations w ON a.location_id = w.id
       ${whereClause}
       ORDER BY a.work_date DESC`,
      params
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// Gửi đơn giải trình công (SCR_ATT_03)
app.post(['/api/v1/attendance-adjustments', '/api/attendance/explanations', '/api/attendance/adjustments'], requireAuth(), async (req, res, next) => {
  try {
    const empId = req.user.empId;
    const { workDate, adjustmentType = 'FORGOT_CHECK_IN', requestedCheckIn, requestedCheckOut, reason, evidenceUrl = null } = req.body;

    if (!empId || !workDate || !reason) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc: workDate, reason' });
    }

    const [attRows] = await pool.query('SELECT id FROM attendance_logs WHERE emp_id = ? AND work_date = ?', [empId, workDate]);
    const attendanceId = attRows.length ? attRows[0].id : null;

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO attendance_adjustments
       (id, emp_id, attendance_id, work_date, adjustment_type, requested_check_in, requested_check_out, reason, evidence_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [id, empId, attendanceId, workDate, adjustmentType, requestedCheckIn || null, requestedCheckOut || null, reason.trim(), evidenceUrl]
    );

    const [created] = await pool.query('SELECT * FROM attendance_adjustments WHERE id = ?', [id]);
    res.status(201).json({ success: true, message: 'Gửi đơn giải trình công thành công', data: created[0] });
  } catch (err) {
    next(err);
  }
});

// Duyệt đơn giải trình công (SCR_ATT_04)
app.patch('/api/v1/attendance-adjustments/:id/decision', requireAuth(['ADMIN', 'HR', 'MANAGER']), async (req, res, next) => {
  try {
    const { decision, rejectReason = null } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'decision phải là APPROVED hoặc REJECTED' });
    }

    const [rows] = await pool.query('SELECT * FROM attendance_adjustments WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy đơn giải trình' });
    }
    const adj = rows[0];
    if (adj.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: 'Đơn giải trình đã được xử lý' });
    }
    if (req.user.role === 'MANAGER' && !await isDirectReport(req.user.empId || req.user.emp_id, adj.emp_id)) {
      return res.status(403).json({ success: false, error: 'Bạn chỉ được xử lý giải trình của nhân viên thuộc nhóm quản lý' });
    }

    const approverId = req.user.empId || req.user.userId;
    await pool.query(
      `UPDATE attendance_adjustments
       SET status = ?, approver_id = ?, approved_at = NOW(), reject_reason = ?
       WHERE id = ?`,
      [decision, approverId, decision === 'REJECTED' ? rejectReason : null, adj.id]
    );

    // Nếu duyệt thành công -> cập nhật lại bảng attendance_logs thành ON_TIME
    if (decision === 'APPROVED') {
      const logId = adj.attendance_id || crypto.randomUUID();
      if (adj.attendance_id) {
        await pool.query(
          `UPDATE attendance_logs
           SET check_in_time = COALESCE(?, check_in_time),
               check_out_time = COALESCE(?, check_out_time),
               late_minutes = 0, early_leave_minutes = 0, status = 'ON_TIME',
               note = CONCAT(COALESCE(note, ''), ' [Đã duyệt giải trình]')
           WHERE id = ?`,
          [adj.requested_check_in, adj.requested_check_out, adj.attendance_id]
        );
      } else {
        await pool.query(
          `INSERT INTO attendance_logs (id, emp_id, work_date, check_in_time, check_out_time, check_in_method, actual_working_hours, status, note)
           VALUES (?, ?, ?, ?, ?, 'MANUAL', 8.00, 'ON_TIME', 'Tạo từ đơn giải trình được duyệt')`,
          [logId, adj.emp_id, adj.work_date, adj.requested_check_in, adj.requested_check_out]
        );
      }
    }

    const [updated] = await pool.query('SELECT * FROM attendance_adjustments WHERE id = ?', [adj.id]);
    res.json({ success: true, message: 'Đã xử lý đơn giải trình công', data: updated[0] });
  } catch (err) {
    next(err);
  }
});

// ==============================================================================
// 4. INTERNAL API CHO PAYROLL & ANALYTICS SERVICE
// ==============================================================================

app.get('/internal/attendances/monthly-summary', requireInternalKey, async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const employeeScope = req.query.managerId
      ? await getVisibleEmployeeIds({ role: 'MANAGER', empId: req.query.managerId })
      : null;
    const conditions = ['MONTH(work_date) = ?', 'YEAR(work_date) = ?'];
    const params = [Number(month), Number(year)];
    addEmployeeScope(conditions, params, employeeScope, 'emp_id');
    const [rows] = await pool.query(
      `SELECT emp_id,
              COUNT(*) AS total_logged_days,
              SUM(CASE WHEN status IN ('ON_TIME', 'LATE', 'EARLY_LEAVE', 'LATE_AND_EARLY') THEN 1 ELSE 0 END) AS actual_work_days,
              SUM(CASE WHEN status = 'ON_TIME' THEN 1 ELSE 0 END) AS on_time_days,
              SUM(CASE WHEN status IN ('LATE', 'LATE_AND_EARLY') THEN 1 ELSE 0 END) AS late_days,
              SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) AS absent_days,
              SUM(CASE WHEN status = 'ON_LEAVE' THEN 1 ELSE 0 END) AS paid_leave_days,
              SUM(late_minutes) AS total_late_minutes,
              SUM(early_leave_minutes) AS total_early_leave_minutes,
              SUM(actual_working_hours) AS total_working_hours
       FROM attendance_logs
       WHERE ${conditions.join(' AND ')}
       GROUP BY emp_id`,
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
    prefix: '/api/v1/attendances'
  });
});