/**
 * shared/events.js
 * Quản lý Bắn event (publish) và Đăng ký nhận event (subscribe) qua Event Bus cho các Microservices
 * Hỗ trợ giao thức HTTP Webhook, cơ chế tự động thử lại (retry) và dự phòng lỗi (fail-safe)
 */

const crypto = require('crypto');
const express = require('express');
const env = require('./env');

/**
 * Bắn (Publish) một sự kiện lên Event Bus
 * @param {string} eventType - Tên sự kiện (ví dụ: 'user.created', 'leave.approved', 'attendance.recorded')
 * @param {object} data - Dữ liệu nghiệp vụ chi tiết của sự kiện
 * @param {object} [options] - Cấu hình mở rộng (source, correlationId, timeoutMs, throwOnError)
 * @returns {Promise<{success: boolean, eventId?: string, error?: string}>}
 */
async function publish(eventType, data = {}, options = {}) {
  const eventId = options.id || crypto.randomUUID();
  const payload = {
    id: eventId,
    eventType,
    data,
    source: options.source || process.env.SERVICE_NAME || 'htqlns-service',
    timestamp: new Date().toISOString(),
    correlationId: options.correlationId || crypto.randomUUID()
  };

  const timeoutMs = options.timeoutMs || 4000;
  const eventBusUrl = options.eventBusUrl || `${env.EVENT_BUS_URL}/events/publish`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(eventBusUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': env.INTERNAL_API_KEY
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[EVENT-BUS] Bắn event "${eventType}" thất bại (HTTP ${response.status}): ${errText}`);
      if (options.throwOnError) {
        throw new Error(`Event Bus returned status ${response.status}: ${errText}`);
      }
      return { success: false, eventId, error: `HTTP ${response.status}: ${errText}` };
    }

    const result = await response.json().catch(() => ({}));
    return { success: true, eventId, ...result };
  } catch (err) {
    console.warn(`[EVENT-BUS] Không thể kết nối tới Event Bus khi bắn event "${eventType}": ${err.message}`);
    if (options.throwOnError) {
      throw err;
    }
    return { success: false, eventId, error: err.message };
  }
}

/**
 * Đăng ký nhận sự kiện (Subscribe) từ Event Bus thông qua Webhook URL
 * @param {string|Array<string>} eventTypes - Một hoặc nhiều tên sự kiện cần lắng nghe
 * @param {string} webhookUrl - URL endpoint mà Event Bus sẽ gọi đến khi có event
 * @param {object} [options] - Cấu hình đăng ký (serviceName, retries, retryDelayMs)
 */
async function subscribe(eventTypes, webhookUrl, options = {}) {
  const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
  const serviceName = options.serviceName || process.env.SERVICE_NAME || 'anonymous-service';
  const subscribeUrl = options.eventBusUrl || `${env.EVENT_BUS_URL}/events/subscribe`;

  const results = [];

  for (const eventType of types) {
    let success = false;
    let attempt = 0;
    const maxRetries = options.retries !== undefined ? options.retries : 3;
    const delay = options.retryDelayMs || 2000;

    while (attempt <= maxRetries && !success) {
      attempt++;
      try {
        const response = await fetch(subscribeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': env.INTERNAL_API_KEY
          },
          body: JSON.stringify({
            eventType,
            webhookUrl,
            serviceName
          })
        });

        if (response.ok) {
          success = true;
          console.log(`[EVENT-BUS] ✅ Service [${serviceName}] đã subscribe thành công event "${eventType}" -> ${webhookUrl}`);
          results.push({ eventType, success: true });
        } else {
          const text = await response.text();
          console.warn(`[EVENT-BUS] Lần ${attempt}: Đăng ký "${eventType}" thất bại (HTTP ${response.status}): ${text}`);
        }
      } catch (err) {
        if (attempt <= maxRetries) {
          // Chờ để thử lại nếu Event Bus đang khởi động
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.warn(`[EVENT-BUS] Không thể kết nối tới Event Bus sau ${attempt} lần thử cho event "${eventType}": ${err.message}`);
          results.push({ eventType, success: false, error: err.message });
        }
      }
    }
  }

  return results;
}

/**
 * Tạo Express Router nhận webhook từ Event Bus và phân phối tới các hàm xử lý
 * @param {Record<string, Function>} handlers - Bản đồ ánh xạ eventType -> async (event) => {}
 * @returns {express.Router}
 */
function createWebhookRouter(handlers = {}) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const event = req.body;
    if (!event || !event.eventType) {
      return res.status(400).json({ success: false, error: 'Thiếu trường eventType trong payload' });
    }

    const { eventType, id } = event;
    const handler = handlers[eventType] || handlers['*'];

    if (!handler) {
      // Nhận event thành công nhưng không có logic cần xử lý
      return res.status(200).json({ success: true, processed: false, message: `Bỏ qua event "${eventType}" (không có handler)` });
    }

    try {
      await handler(event);
      return res.status(200).json({ success: true, processed: true, eventId: id });
    } catch (err) {
      console.error(`[EVENT-BUS] Lỗi xử lý webhook cho event "${eventType}":`, err.stack || err.message);
      return res.status(500).json({ success: false, error: err.message, eventId: id });
    }
  });

  return router;
}

module.exports = {
  publish,
  subscribe,
  createWebhookRouter
};
