/**
 * shared/client.js
 * Client gọi HTTP giữa các dịch vụ trong kiến trúc SOA
 * Hỗ trợ Service Discovery qua Registry, timeout, retry và load balancing
 */

const env = require('./env');

class ServiceClient {
  constructor(options = {}) {
    this.registryUrl = options.registryUrl || env.REGISTRY_URL;
    this.cache = new Map();
    this.cacheTtlMs = options.cacheTtlMs || 15000;
  }

  async resolveServiceUrl(serviceName) {
    const cached = this.cache.get(serviceName);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.url;
    }

    try {
      const res = await fetch(`${this.registryUrl}/services/${serviceName}`, {
        headers: { 'x-internal-key': env.INTERNAL_API_KEY },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        const instances = Array.isArray(data.instances) ? data.instances : (data.url ? [data] : []);
        const upInstances = instances.filter((i) => !i.status || i.status === 'UP');
        if (upInstances.length > 0) {
          // Simple round-robin or random selection for load balancing
          const selected = upInstances[Math.floor(Math.random() * upInstances.length)];
          if (selected && selected.url) {
            this.cache.set(serviceName, { url: selected.url, timestamp: Date.now() });
            return selected.url;
          }
        }
      }
    } catch {
      // Fallback: Check if service can be located via standard local convention
    }

    return null;
  }

  async call(serviceName, path, options = {}) {
    const baseUrl = options.directUrl || (await this.resolveServiceUrl(serviceName));
    if (!baseUrl) {
      const err = new Error(`Không tìm thấy địa chỉ của service: ${serviceName}`);
      err.status = 503;
      err.service = serviceName;
      throw err;
    }

    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseUrl.replace(/\/$/, '')}${cleanPath}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-internal-key': env.INTERNAL_API_KEY,
      ...(options.headers || {})
    };

    let bodyData = undefined;
    if (options.body !== undefined) {
      if (typeof options.body === 'object' && !Buffer.isBuffer(options.body)) {
        bodyData = JSON.stringify(options.body);
      } else {
        bodyData = options.body;
      }
    }

    const maxRetries = options.retries !== undefined ? options.retries : 1;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutMs = options.timeout || 5000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          method: options.method || 'GET',
          headers,
          body: bodyData,
          signal: controller.signal
        });

        clearTimeout(timer);

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const err = new Error(data?.error || data?.message || `Lỗi gọi service ${serviceName} (HTTP ${response.status})`);
          err.status = response.status;
          err.data = data;
          err.service = serviceName;
          throw err;
        }

        return data;
      } catch (err) {
        lastError = err;
        if (err.status && err.status < 500) {
          // Client errors (4xx) shouldn't be retried
          throw err;
        }
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error(`Lỗi kết nối tới service: ${serviceName}`);
  }

  /**
   * Chuyển tiếp (forward/proxy) nguyên bản request tới downstream service
   */
  async forward(serviceName, path, options = {}) {
    const baseUrl = options.directUrl || (await this.resolveServiceUrl(serviceName));
    if (!baseUrl) {
      const err = new Error(`Không tìm thấy địa chỉ khả dụng của service: ${serviceName}`);
      err.status = 503;
      err.service = serviceName;
      throw err;
    }

    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseUrl.replace(/\/$/, '')}${cleanPath}`;

    const headers = {
      'x-internal-key': env.INTERNAL_API_KEY,
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeoutMs = options.timeout || 10000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: controller.signal
      });

      clearTimeout(timer);
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        buffer
      };
    } catch (err) {
      clearTimeout(timer);
      const e = new Error(`Lỗi forward tới ${serviceName}: ${err.message}`);
      e.status = 503;
      e.service = serviceName;
      throw e;
    }
  }
}

const defaultClient = new ServiceClient();

module.exports = {
  ServiceClient,
  serviceClient: defaultClient,
  call: (serviceName, path, options) => {
    // Cho phép gọi theo 2 kiểu: call(serviceName, path, options) hoặc call(serviceName, optionsWithMethodAndPath)
    if (typeof path === 'object' && path !== null && options === undefined) {
      const opts = path;
      return defaultClient.forward(serviceName, opts.path || '/', opts);
    }
    return defaultClient.call(serviceName, path, options);
  },
  resolveServiceUrl: (serviceName) => defaultClient.resolveServiceUrl(serviceName)
};
