/**
 * shared/openapi.js
 * Sinh tài liệu mô tả OpenAPI 3.0 cho các Microservices
 */

function createOpenApiSpec(serviceName, info = {}) {
  return {
    openapi: '3.0.0',
    info: {
      title: `${serviceName.toUpperCase()} API`,
      version: info.version || '1.0.0',
      description: info.description || `Tài liệu API của ${serviceName} trong Hệ thống Quản lý Chấm công - Tính lương & Nhân sự (HTQLNS)`
    },
    paths: info.paths || {
      '/health': {
        get: {
          summary: 'Kiểm tra trạng thái dịch vụ (Health Check)',
          responses: {
            200: { description: 'Dịch vụ đang hoạt động tốt' },
            503: { description: 'Dịch vụ hoặc cơ sở dữ liệu gặp sự cố' }
          }
        }
      }
    }
  };
}

module.exports = {
  createOpenApiSpec
};
