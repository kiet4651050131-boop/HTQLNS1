/**
 * registry/server.js
 * Service Registry – Quản lý dò tìm dịch vụ động trong kiến trúc SOA HTQLNS
 * Hỗ trợ tự động đăng ký, duy trì Heartbeat, kiểm tra sức khỏe (Health Sweep) định kỳ và loại bỏ instance lỗi
 */

require('../shared/env');
const http = require('http');
const crypto = require('crypto');
const env = require('../shared/env');
const { readJson, send, guardInternal } = require('../shared/httpx');
const log = require('../shared/log')('service-registry');

const PORT = Number(process.env.REGISTRY_PORT || 3500);
const TTL_MS = Number(process.env.REGISTRY_TTL_MS || 15000);        // Quá hạn heartbeat => STALE
const SWEEP_MS = Number(process.env.REGISTRY_SWEEP_MS || 5000);     // Chu kỳ quét sức khỏe
const REMOVE_AFTER_MS = TTL_MS * 4;                                // Quá lâu không heartbeat => Xóa khỏi registry

const instances = new Map();

function generateInstanceId(name, url) {
  return crypto.createHash('sha1').update(`${name}|${url}`).digest('hex').slice(0, 12);
}

function formatInstanceView(inst) {
  const isStale = Date.now() - inst.lastHeartbeat > TTL_MS;
  const status = isStale ? 'STALE' : inst.health;
  return {
    id: inst.id,
    name: inst.name,
    url: inst.url,
    healthUrl: inst.healthUrl || `${inst.url}/health`,
    version: inst.version,
    metadata: inst.metadata,
    status,
    lastHeartbeatAgoMs: Date.now() - inst.lastHeartbeat,
    uptimeMs: Date.now() - inst.registeredAt
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = urlObj.pathname;

    // 1. Health check công khai
    if (pathname === '/health') {
      return send(res, 200, {
        status: 'UP',
        service: 'service-registry',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        instancesCount: instances.size
      });
    }

    // 2. Bảo vệ các endpoint nội bộ bằng khóa x-internal-key
    if (!guardInternal(req, res)) return;

    // 3. Đăng ký dịch vụ (POST /register)
    if (req.method === 'POST' && pathname === '/register') {
      const body = await readJson(req);
      if (!body.name || !body.url) {
        return send(res, 400, { success: false, error: 'Yêu cầu cung cấp name và url của dịch vụ' });
      }

      const cleanUrl = String(body.url).replace(/\/$/, '');
      const instanceId = generateInstanceId(body.name, cleanUrl);
      const existing = instances.get(instanceId);

      const record = {
        id: instanceId,
        name: body.name,
        url: cleanUrl,
        healthUrl: body.healthUrl || `${cleanUrl}/health`,
        version: body.version || '1.0.0',
        metadata: body.metadata || {},
        registeredAt: existing ? existing.registeredAt : Date.now(),
        lastHeartbeat: Date.now(),
        health: existing ? existing.health : 'UP',
        failures: 0
      };

      instances.set(instanceId, record);
      if (!existing) {
        log.info(`✅ Đăng ký mới: ${body.name} @ ${cleanUrl} (id: ${instanceId})`);
      }
      return send(res, 200, { success: true, instanceId, message: 'Đăng ký dịch vụ thành công' });
    }

    // 4. Nhận Heartbeat (POST /heartbeat hoặc PUT /heartbeat/:id)
    if (req.method === 'POST' && pathname === '/heartbeat') {
      const body = await readJson(req);
      let instance = null;

      if (body.instanceId) {
        instance = instances.get(body.instanceId);
      } else if (body.name && body.url) {
        const id = generateInstanceId(body.name, String(body.url).replace(/\/$/, ''));
        instance = instances.get(id);
      }

      if (!instance) {
        return send(res, 404, { success: false, error: 'Instance chưa được đăng ký trong Registry' });
      }

      instance.lastHeartbeat = Date.now();
      return send(res, 200, { success: true, ok: true });
    }

    const hbMatch = pathname.match(/^\/heartbeat\/([^/]+)$/);
    if (req.method === 'PUT' && hbMatch) {
      const id = hbMatch[1];
      const instance = instances.get(id);
      if (!instance) {
        return send(res, 404, { success: false, error: 'Instance không tồn tại' });
      }
      instance.lastHeartbeat = Date.now();
      return send(res, 200, { success: true, ok: true });
    }

    // 5. Hủy đăng ký (POST /unregister hoặc DELETE /instances/:id)
    if (req.method === 'POST' && pathname === '/unregister') {
      const body = await readJson(req);
      const id = body.instanceId || (body.name && body.url ? generateInstanceId(body.name, String(body.url).replace(/\/$/, '')) : null);
      if (id && instances.has(id)) {
        const inst = instances.get(id);
        instances.delete(id);
        log.info(`🛑 Hủy đăng ký: ${inst.name} @ ${inst.url}`);
      }
      return send(res, 200, { success: true, message: 'Hủy đăng ký hoàn tất' });
    }

    const delMatch = pathname.match(/^\/instances\/([^/]+)$/);
    if (req.method === 'DELETE' && delMatch) {
      const id = delMatch[1];
      const inst = instances.get(id);
      if (inst) {
        instances.delete(id);
        log.info(`🛑 Hủy đăng ký: ${inst.name} @ ${inst.url}`);
      }
      return send(res, 200, { success: true, ok: true });
    }

    // 6. Liệt kê toàn bộ dịch vụ (GET /services)
    if (req.method === 'GET' && pathname === '/services') {
      const servicesMap = {};
      for (const inst of instances.values()) {
        if (!servicesMap[inst.name]) {
          servicesMap[inst.name] = [];
        }
        servicesMap[inst.name].push(formatInstanceView(inst));
      }
      return send(res, 200, { success: true, services: servicesMap });
    }

    // 7. Tra cứu một dịch vụ cụ thể (GET /services/:name)
    const svcMatch = pathname.match(/^\/services\/([^/]+)$/);
    if (req.method === 'GET' && svcMatch) {
      const serviceName = decodeURIComponent(svcMatch[1]);
      const matched = [...instances.values()]
        .filter((inst) => inst.name === serviceName)
        .map(formatInstanceView)
        .filter((view) => view.status === 'UP');

      return send(res, 200, {
        success: true,
        name: serviceName,
        instances: matched,
        count: matched.length
      });
    }

    // 404 Route Not Found
    send(res, 404, { success: false, error: 'Endpoint không tồn tại trên Service Registry' });
  } catch (err) {
    log.error('Lỗi xử lý yêu cầu Service Registry:', err);
    send(res, err.status || 500, { success: false, error: err.message || 'Lỗi nội bộ Service Registry' });
  }
});

// Quét kiểm tra trạng thái sức khỏe định kỳ (Health Sweep)
async function sweepHealth() {
  const now = Date.now();
  await Promise.all(
    [...instances.values()].map(async (inst) => {
      // 1. Quá lâu không có heartbeat => Loại bỏ hoàn toàn
      if (now - inst.lastHeartbeat > REMOVE_AFTER_MS) {
        instances.delete(inst.id);
        log.warn(`⚠️ Instance [${inst.name} @ ${inst.url}] đã bị xóa do mất heartbeat quá thời hạn`);
        return;
      }

      // 2. Kiểm tra /health chủ động nếu vẫn còn trong hạn TTL
      const healthEndpoint = inst.healthUrl || `${inst.url}/health`;
      try {
        const response = await fetch(healthEndpoint, { signal: AbortSignal.timeout(1500) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (inst.health !== 'UP') {
          log.info(`✨ Instance [${inst.name} @ ${inst.url}] đã hồi phục trạng thái UP`);
        }
        inst.health = 'UP';
        inst.failures = 0;
      } catch {
        inst.failures = (inst.failures || 0) + 1;
        if (inst.failures >= 2 && inst.health !== 'UNHEALTHY') {
          inst.health = 'UNHEALTHY';
          log.warn(`⚠️ Instance [${inst.name} @ ${inst.url}] không phản hồi /health (${inst.failures} lần), tạm loại khỏi định tuyến`);
        }
      }
    })
  );
}

const sweepInterval = setInterval(sweepHealth, SWEEP_MS);
sweepInterval.unref();

server.listen(PORT, () => {
  log.info(`🚀 Service Registry HTQLNS đang lắng nghe tại http://localhost:${PORT}`);
});

function gracefulShutdown() {
  log.info('Đang dừng Service Registry...');
  clearInterval(sweepInterval);
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
