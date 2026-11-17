/**
 * shared/httpx.js
 * Tiện ích chuẩn hóa phản hồi HTTP JSON & đọc body cho các RESTful API trong hệ thống HTQLNS
 */

const env = require('./env');

function success(res, data = null, statusCode = 200, message = 'Thành công') {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
}

function created(res, data = null, message = 'Tạo mới thành công') {
  return success(res, data, 201, message);
}

function error(res, message = 'Lỗi máy chủ', statusCode = 500, details = null) {
  return res.status(statusCode).json({
    success: false,
    error: message,
    code: statusCode,
    ...(details ? { details } : {})
  });
}

function badRequest(res, message = 'Dữ liệu yêu cầu không hợp lệ', details = null) {
  return error(res, message, 400, details);
}

function unauthorized(res, message = 'Yêu cầu xác thực tài khoản (Unauthorized)') {
  return error(res, message, 401);
}

function forbidden(res, message = 'Không có quyền truy cập (Forbidden)') {
  return error(res, message, 403);
}

function notFound(res, message = 'Không tìm thấy tài nguyên yêu cầu (Not Found)') {
  return error(res, message, 404);
}

function conflict(res, message = 'Dữ liệu xung đột hoặc đã tồn tại (Conflict)') {
  return error(res, message, 409);
}

/**
 * Gửi phản hồi HTTP cho raw Node.js http.ServerResponse
 */
function send(res, status = 200, data = {}, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  const defaultHeaders = {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  };
  res.writeHead(status, defaultHeaders);
  res.end(body);
}

/**
 * Đọc toàn bộ request body dưới dạng Buffer
 */
function readBody(req, limit = 1048576) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('Payload Too Large: Nội dung yêu cầu vượt quá giới hạn cho phép');
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Đọc request body và parse JSON
 */
async function readJson(req, limit = 1048576) {
  const buf = await readBody(req, limit);
  if (!buf || buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    const err = new Error('JSON cú pháp không hợp lệ: ' + e.message);
    err.status = 400;
    throw err;
  }
}

/**
 * Kiểm tra khóa nội bộ x-internal-key cho raw HTTP response
 */
function guardInternal(req, res) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== env.INTERNAL_API_KEY) {
    send(res, 403, {
      success: false,
      error: 'Truy cập bị từ chối: Yêu cầu khóa nội bộ hợp lệ (x-internal-key)',
      code: 403
    });
    return false;
  }
  return true;
}

module.exports = {
  success,
  created,
  error,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  send,
  readBody,
  readJson,
  guardInternal
};
