/**
 * shared/registrar.js
 * Quản lý tự động đăng ký Service lên Service Registry và duy trì Heartbeat
 */

const env = require('./env');

class ServiceRegistrar {
  constructor(serviceInfo) {
    this.name = serviceInfo.name;
    this.host = serviceInfo.host || 'localhost';
    this.port = serviceInfo.port;
    this.url = serviceInfo.url || `http://${this.host}:${this.port}`;
    this.healthUrl = serviceInfo.healthUrl || `${this.url}/health`;
    this.registryUrl = serviceInfo.registryUrl || env.REGISTRY_URL;
    this.intervalMs = serviceInfo.heartbeatIntervalMs || 10000;
    this.version = serviceInfo.version || '1.0.0';
    this.metadata = serviceInfo.metadata || {};
    this.timer = null;
    this.instanceId = null;
  }

  async register() {
    try {
      const response = await fetch(`${this.registryUrl}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': env.INTERNAL_API_KEY
        },
        body: JSON.stringify({
          name: this.name,
          host: this.host,
          port: this.port,
          url: this.url,
          healthUrl: this.healthUrl,
          version: this.version,
          metadata: this.metadata
        }),
        signal: AbortSignal.timeout(4000)
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        this.instanceId = data.instanceId;
        console.log(`[REGISTRAR] ✅ Service [${this.name}] đã đăng ký thành công lên Service Registry (${this.registryUrl})`);
        this.startHeartbeat();
        return true;
      } else {
        const text = await response.text();
        console.warn(`[REGISTRAR] Đăng ký service [${this.name}] thất bại: ${text}`);
        return false;
      }
    } catch (err) {
      console.warn(`[REGISTRAR] Chưa thể kết nối Service Registry (${this.registryUrl}): ${err.message}`);
      return false;
    }
  }

  startHeartbeat() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(async () => {
      try {
        await fetch(`${this.registryUrl}/heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': env.INTERNAL_API_KEY
          },
          body: JSON.stringify({
            name: this.name,
            url: this.url,
            instanceId: this.instanceId
          }),
          signal: AbortSignal.timeout(3000)
        });
      } catch {
        // Heartbeat failure logged at debug level
      }
    }, this.intervalMs);
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      await fetch(`${this.registryUrl}/unregister`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': env.INTERNAL_API_KEY
        },
        body: JSON.stringify({
          name: this.name,
          url: this.url,
          instanceId: this.instanceId
        }),
        signal: AbortSignal.timeout(2000)
      });
    } catch {
      // Ignore unregister errors during shutdown
    }
  }
}

function registerService(serviceInfo) {
  const registrar = new ServiceRegistrar(serviceInfo);
  registrar.register();
  return registrar;
}

module.exports = {
  ServiceRegistrar,
  registerService,
  register: registerService,
  startRegistration: registerService
};
