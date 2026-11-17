/**
 * event-bus/server.js
 * Event Bus – Trung gian truyền thông điệp bất đồng bộ (Pub/Sub) trong kiến trúc SOA HTQLNS
 * Hỗ trợ lưu trữ bền vững (Durable Queue), cơ chế thử lại lũy thừa (Exponential Backoff) và Dead-Letter Queue (DLQ)
 */

require('../shared/env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../shared/env');
const { readJson, send, guardInternal } = require('../shared/httpx');
const { serviceClient } = require('../shared/client');
const log = require('../shared/log')('event-bus');

const PORT = Number(process.env.EVENT_BUS_PORT || 3600);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DATA_FILE = process.env.EVENT_BUS_DATA || path.join(DATA_DIR, 'event-bus.json');
const MAX_ATTEMPTS = Number(process.env.BUS_MAX_ATTEMPTS || 5);
const RETRY_BASE_MS = Number(process.env.BUS_RETRY_BASE_MS || 1000);
const MAX_INFLIGHT = 10;

/**
 * Cấu trúc trạng thái Event Bus
 * state.subs: {
 *   [subKey]: { serviceName, topics: string[], webhookUrl?: string, path?: string }
 * }
 */
let state = {
  subs: {},
  queue: [],
  dlq: []
};

const seenEventIds = new Set();
let inflightCount = 0;
let deliveredTotal = 0;

// Khôi phục trạng thái từ file
try {
  if (fs.existsSync(DATA_FILE)) {
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(rawData);
    state = {
      subs: parsed.subs || {},
      queue: parsed.queue || [],
      dlq: parsed.dlq || []
    };
    log.info(`Khôi phục trạng thái: ${Object.keys(state.subs).length} subscribers, ${state.queue.length} tin chờ xử lý, ${state.dlq.length} tin DLQ`);
  }
} catch (err) {
  log.warn('Không thể đọc file lưu trữ hàng đợi:', err.message);
}

// Lưu trạng thái xuống đĩa an toàn
let saveTimer = null;
function saveState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(
      tmpFile,
      JSON.stringify(state, (key, value) => (key === 'inflight' ? undefined : value), 2)
    );
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    log.error('Lỗi khi ghi file lưu trữ Event Bus:', err.message);
  }
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}

// Kiểm tra so khớp tên sự kiện (Exact match, wildcard '*' hoặc 'prefix.*')
function isTopicMatch(pattern, topic) {
  if (!pattern || !topic) return false;
  if (pattern === '*' || pattern === topic) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return topic.startsWith(`${prefix}.`);
  }
  return false;
}

// Bắn sự kiện vào hàng đợi của các subscriber phù hợp
function enqueueEvent(event) {
  const eventId = event.id;
  if (seenEventIds.has(eventId)) {
    return { eventId, duplicate: true, deliveries: 0 };
  }

  seenEventIds.add(eventId);
  if (seenEventIds.size > 5000) {
    const oldestKey = seenEventIds.values().next().value;
    seenEventIds.delete(oldestKey);
  }

  let deliveriesCount = 0;
  for (const [subKey, sub] of Object.entries(state.subs)) {
    const isMatched = (sub.topics || []).some((pattern) => isTopicMatch(pattern, event.eventType));
    if (isMatched) {
      state.queue.push({
        deliveryId: crypto.randomUUID(),
        subKey,
        serviceName: sub.serviceName,
        webhookUrl: sub.webhookUrl,
        path: sub.path || '/events',
        event,
        attempts: 0,
        nextAt: Date.now()
      });
      deliveriesCount++;
    }
  }

  schedulePersist();
  return { eventId, deliveries: deliveriesCount };
}

// Giao thông điệp (Webhook delivery)
async function dispatchDelivery(delivery) {
  try {
    const payload = delivery.event;
    let responseOk = false;

    if (delivery.webhookUrl) {
      // 1. Gửi trực tiếp tới Webhook URL đã cung cấp
      const res = await fetch(delivery.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': env.INTERNAL_API_KEY
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000)
      });
      responseOk = res.ok;
      if (!res.ok) {
        throw new Error(`Webhook endpoint HTTP ${res.status}`);
      }
    } else if (delivery.serviceName) {
      // 2. Định tuyến qua Service Discovery của Registry
      const res = await serviceClient.call(delivery.serviceName, delivery.path || '/events', {
        method: 'POST',
        body: payload,
        timeout: 4000
      });
      responseOk = Boolean(res);
    } else {
      throw new Error('Subscriber thiếu cả webhookUrl lẫn serviceName');
    }

    if (responseOk) {
      state.queue = state.queue.filter((d) => d !== delivery);
      deliveredTotal++;
    }
  } catch (err) {
    delivery.attempts++;
    delivery.lastError = String(err.message || err);

    if (delivery.attempts >= MAX_ATTEMPTS) {
      state.queue = state.queue.filter((d) => d !== delivery);
      state.dlq.push({
        ...delivery,
        failedAt: new Date().toISOString()
      });
      log.warn(`❌ Chuyển vào DLQ: Event "${delivery.event?.eventType}" -> [${delivery.subKey}] (Lỗi: ${delivery.lastError})`);
    } else {
      const backoffDelay = Math.min(30000, RETRY_BASE_MS * Math.pow(2, delivery.attempts));
      delivery.nextAt = Date.now() + backoffDelay;
    }
  } finally {
    delivery.inflight = false;
    inflightCount--;
    schedulePersist();
  }
}

// Vòng lặp chuyển phát tin nhắn
const deliveryInterval = setInterval(() => {
  const now = Date.now();
  for (const delivery of state.queue) {
    if (inflightCount >= MAX_INFLIGHT) break;
    if (!delivery.inflight && delivery.nextAt <= now) {
      delivery.inflight = true;
      inflightCount++;
      dispatchDelivery(delivery);
    }
  }
}, 150);
deliveryInterval.unref();

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = urlObj.pathname;

    // 1. Health check công khai
    if (pathname === '/health') {
      return send(res, 200, {
        status: 'UP',
        service: 'event-bus',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        subscribersCount: Object.keys(state.subs).length,
        queueLength: state.queue.length,
        dlqLength: state.dlq.length,
        deliveredTotal
      });
    }

    // 2. Bảo mật khóa nội bộ x-internal-key
    if (!guardInternal(req, res)) return;

    // 3. Đăng ký nhận sự kiện (POST /events/subscribe hoặc POST /subscribe)
    if (req.method === 'POST' && (pathname === '/events/subscribe' || pathname === '/subscribe')) {
      const body = await readJson(req);

      let serviceName = body.serviceName || body.service || 'anonymous-service';
      let topics = [];
      if (body.eventType) {
        topics = Array.isArray(body.eventType) ? body.eventType : [body.eventType];
      } else if (body.topics) {
        topics = Array.isArray(body.topics) ? body.topics : [body.topics];
      } else if (body.topic) {
        topics = [body.topic];
      }

      if (topics.length === 0) {
        return send(res, 400, { success: false, error: 'Cần cung cấp ít nhất một eventType hoặc topics' });
      }

      const webhookUrl = body.webhookUrl || null;
      const customPath = body.path || '/events';
      const subKey = `${serviceName}:${webhookUrl || customPath}`;

      // Hợp nhất các topics đã đăng ký
      const prev = state.subs[subKey];
      const mergedTopics = Array.from(new Set([...(prev?.topics || []), ...topics]));

      state.subs[subKey] = {
        serviceName,
        topics: mergedTopics,
        webhookUrl,
        path: customPath,
        updatedAt: new Date().toISOString()
      };

      log.info(`➕ Subscriber [${subKey}]: ${mergedTopics.join(', ')}`);
      schedulePersist();
      return send(res, 200, { success: true, ok: true, subKey, topics: mergedTopics });
    }

    // 4. Bắn sự kiện lên Event Bus (POST /events/publish hoặc POST /publish)
    if (req.method === 'POST' && (pathname === '/events/publish' || pathname === '/publish')) {
      const body = await readJson(req);
      const eventType = body.eventType || body.topic;

      if (!eventType) {
        return send(res, 400, { success: false, error: 'Thiếu trường eventType hoặc topic' });
      }

      const eventPayload = {
        id: body.id || crypto.randomUUID(),
        eventType,
        data: body.data !== undefined ? body.data : (body.payload !== undefined ? body.payload : {}),
        source: body.source || 'unknown',
        timestamp: body.timestamp || body.ts || new Date().toISOString(),
        correlationId: body.correlationId || crypto.randomUUID()
      };

      const result = enqueueEvent(eventPayload);
      return send(res, 202, {
        success: true,
        eventId: result.eventId,
        deliveries: result.deliveries,
        duplicate: Boolean(result.duplicate)
      });
    }

    // 5. Thống kê hàng đợi (GET /events/stats hoặc GET /stats)
    if (req.method === 'GET' && (pathname === '/events/stats' || pathname === '/stats')) {
      return send(res, 200, {
        success: true,
        subscribers: state.subs,
        pending: state.queue.length,
        deadLetters: state.dlq.length,
        delivered: deliveredTotal
      });
    }

    // 6. Xem danh sách Dead-Letter Queue (GET /events/dead-letters hoặc GET /dead-letters)
    if (req.method === 'GET' && (pathname === '/events/dead-letters' || pathname === '/dead-letters')) {
      return send(res, 200, { success: true, deadLetters: state.dlq });
    }

    // 7. Thử lại một tin trong Dead-Letter Queue (POST /events/dead-letters/:id/retry hoặc POST /dead-letters/:id/retry)
    const retryDlqMatch = pathname.match(/^\/(?:events\/)?dead-letters\/([^/]+)\/retry$/);
    if (req.method === 'POST' && retryDlqMatch) {
      const deliveryId = retryDlqMatch[1];
      const idx = state.dlq.findIndex((d) => d.deliveryId === deliveryId);
      if (idx === -1) {
        return send(res, 404, { success: false, error: 'Không tìm thấy tin nhắn trong DLQ' });
      }

      const [item] = state.dlq.splice(idx, 1);
      item.attempts = 0;
      item.nextAt = Date.now();
      delete item.failedAt;
      state.queue.push(item);

      schedulePersist();
      log.info(`🔄 Phục hồi và gửi lại tin nhắn DLQ (id: ${deliveryId})`);
      return send(res, 200, { success: true, message: 'Đã nạp lại tin nhắn vào hàng đợi' });
    }

    // 404 Route Not Found
    send(res, 404, { success: false, error: 'Endpoint không tồn tại trên Event Bus' });
  } catch (err) {
    log.error('Lỗi xử lý yêu cầu Event Bus:', err);
    send(res, err.status || 500, { success: false, error: err.message || 'Lỗi nội bộ Event Bus' });
  }
});

server.listen(PORT, () => {
  log.info(`🚀 Event Bus HTQLNS đang lắng nghe tại http://localhost:${PORT}`);
});

function gracefulShutdown() {
  log.info('Đang dừng Event Bus...');
  clearTimeout(saveTimer);
  clearInterval(deliveryInterval);
  saveState();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
