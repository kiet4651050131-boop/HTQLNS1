/**
 * services/notification-service/index.js
 * Microservice Quản lý Thông báo & Cảnh báo Xuyên suốt (Cổng :3007)
 * Lắng nghe sự kiện từ Event Bus để tự động tạo thông báo cho nhân viên & quản lý
 */

const crypto = require('crypto');
const { createServiceApp, requireAuth } = require('../../shared/service-base');
const db = require('../../shared/db');
const registrar = require('../../shared/registrar');
const events = require('../../shared/events');

const SERVICE_NAME = 'notification-service';
const PORT = Number(process.env.NOTIFICATION_SERVICE_PORT || 3007);
const DB_NAME = process.env.NOTIFICATION_DB_NAME || 'htqlns_notification';

const pool = db.getPool(DB_NAME);

const app = createServiceApp(SERVICE_NAME, {
  port: PORT,
  checkHealth: async () => {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return rows && rows[0]?.ok === 1;
  }
});

async function createNotification({ empId = null, targetRole = null, type = 'SYSTEM', title, content, referenceId = null }) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO notifications (id, emp_id, target_role, type, title, content, reference_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, empId, targetRole, type, title, content, referenceId]
  );
}

// Đăng ký lắng nghe các sự kiện từ Event Bus (Pub/Sub)
function setupEventSubscriptions() {
  if (typeof events.subscribe !== 'function') return;

  events.subscribe('ATTENDANCE_LATE', async (payload) => {
    await createNotification({
      empId: payload.empId,
      type: 'ATTENDANCE_ALERT',
      title: 'Cảnh báo đi muộn',
      content: `Bạn đã check-in muộn ${payload.lateMinutes} phút vào ngày ${payload.workDate}.`,
      referenceId: payload.attendanceId
    });
  });

  events.subscribe('LEAVE_REQUEST_CREATED', async (payload) => {
    await createNotification({
      targetRole: 'MANAGER',
      type: 'LEAVE_STATUS',
      title: 'Có đơn xin nghỉ phép mới chờ duyệt',
      content: `Nhân sự ${payload.empId} vừa gửi đơn xin nghỉ ${payload.totalDays} ngày (${payload.startDate} → ${payload.endDate}).`,
      referenceId: payload.requestId
    });
  });

  events.subscribe('LEAVE_REQUEST_APPROVED', async (payload) => {
    await createNotification({
      empId: payload.empId,
      type: 'LEAVE_STATUS',
      title: 'Đơn xin nghỉ phép đã được duyệt',
      content: `Đơn nghỉ phép từ ${payload.startDate} đến ${payload.endDate} (${payload.totalDays} ngày) của bạn đã được phê duyệt.`,
      referenceId: payload.requestId
    });
  });

  events.subscribe('LEAVE_REQUEST_REJECTED', async (payload) => {
    await createNotification({
      empId: payload.empId,
      type: 'LEAVE_STATUS',
      title: 'Đơn xin nghỉ phép bị từ chối',
      content: `Đơn nghỉ phép từ ${payload.startDate} đến ${payload.endDate} của bạn đã bị từ chối.`,
      referenceId: payload.requestId
    });
  });

  events.subscribe('OT_REQUEST_APPROVED', async (payload) => {
    await createNotification({
      empId: payload.empId,
      type: 'OT_STATUS',
      title: 'Đơn đăng ký tăng ca (OT) đã được duyệt',
      content: `Đăng ký tăng ca ${payload.totalHours} giờ ngày ${payload.workDate} của bạn đã được phê duyệt.`,
      referenceId: payload.requestId
    });
  });

  events.subscribe('PAYSLIP_PUBLISHED', async (payload) => {
    await createNotification({
      targetRole: 'EMPLOYEE',
      type: 'PAYROLL',
      title: `Phiếu lương tháng ${payload.month}/${payload.year} đã phát hành`,
      content: `Bảng lương kỳ ${payload.month}/${payload.year} đã được chốt. Vui lòng kiểm tra mục Phiếu lương.`,
      referenceId: payload.periodId
    });
  });
}

// API lấy danh sách thông báo của người dùng đang đăng nhập (SCR_NOTIF_01)
app.get(['/api/v1/notifications', '/api/notifications', '/api/notification'], requireAuth(), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM notifications
       WHERE emp_id = ? OR target_role = ?
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.empId || '', req.user.role || '']
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// Đánh dấu đã đọc 1 thông báo
app.patch(['/api/v1/notifications/:id/read', '/api/notifications/:id/read'], requireAuth(), async (req, res, next) => {
  try {
    await pool.query('UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Đã đánh dấu đã đọc' });
  } catch (err) {
    next(err);
  }
});

app.useErrorHandler();
app.start(PORT, () => {
  setupEventSubscriptions();
  registrar.register({ name: SERVICE_NAME, port: PORT, host: 'localhost', prefix: '/api/v1/notifications' });
});