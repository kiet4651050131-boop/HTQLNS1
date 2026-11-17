/**
 * shared/jwt.js
 * Quản lý ký và xác thực JSON Web Token (JWT) theo chuẩn HS256 (RFC 7519)
 * Sử dụng thư viện crypto tiêu chuẩn của Node.js, không phụ thuộc thư viện ngoài
 */

const crypto = require('crypto');
const env = require('./env');

/**
 * Chuyển chuỗi hoặc Buffer sang chuỗi Base64URL
 */
function base64UrlEncode(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'object' ? JSON.stringify(data) : String(data), 'utf8');
  return buffer.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Giải mã chuỗi Base64URL về chuỗi UTF-8 hoặc Buffer
 */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Phân tích chuỗi thời gian hết hạn (ví dụ: '15m', '24h', '7d', 3600) ra số giây
 */
function parseExpiresIn(expiresIn) {
  if (typeof expiresIn === 'number') return expiresIn;
  if (!expiresIn || typeof expiresIn !== 'string') return 86400; // Mặc định 24h

  const match = expiresIn.trim().match(/^(\d+)([smhd]?)$/);
  if (!match) return 86400;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return value;
  }
}

/**
 * Ký tạo JWT Token từ payload
 * @param {object} payload - Dữ liệu payload gắn trong token
 * @param {object} [options] - Cấu hình ký token (expiresIn, secret)
 * @returns {string} Chuỗi JWT đã ký
 */
function signToken(payload, options = {}) {
  const secret = options.secret || env.JWT_SECRET;
  const expiresIn = options.expiresIn || env.JWT_EXPIRES_IN;

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    iat: nowSeconds
  };

  if (expiresIn) {
    tokenPayload.exp = nowSeconds + parseExpiresIn(expiresIn);
  }

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(tokenPayload);
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest('base64url');

  return `${dataToSign}.${signature}`;
}

/**
 * Xác thực và giải mã JWT Token
 * @param {string} token - Chuỗi JWT cần xác thực
 * @param {string} [secret] - Khóa bí mật (mặc định lấy từ env.JWT_SECRET)
 * @returns {object} Payload đã được giải mã nếu hợp lệ
 * @throws {Error} Ném lỗi nếu token sai định dạng, sai chữ ký hoặc hết hạn
 */
function verifyToken(token, secret = env.JWT_SECRET) {
  if (!token || typeof token !== 'string') {
    const error = new Error('Token không được cung cấp hoặc không hợp lệ');
    error.name = 'JsonWebTokenError';
    throw error;
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    const error = new Error('Định dạng token không đúng (yêu cầu 3 phần header.payload.signature)');
    error.name = 'JsonWebTokenError';
    throw error;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest('base64url');

  // Kiểm tra độ dài và so sánh an toàn tránh Timing Attack
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    const error = new Error('Chữ ký token không hợp lệ (Invalid signature)');
    error.name = 'JsonWebTokenError';
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (err) {
    const error = new Error('Payload token không thể giải mã JSON');
    error.name = 'JsonWebTokenError';
    throw error;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  // Kiểm tra thời gian hết hạn (exp)
  if (payload.exp && nowSeconds >= payload.exp) {
    const error = new Error('Token đã hết hạn (Token expired)');
    error.name = 'TokenExpiredError';
    error.expiredAt = new Date(payload.exp * 1000);
    throw error;
  }

  // Kiểm tra thời gian hiệu lực (nbf)
  if (payload.nbf && nowSeconds < payload.nbf) {
    const error = new Error('Token chưa đến thời điểm có hiệu lực');
    error.name = 'NotBeforeError';
    throw error;
  }

  return payload;
}

/**
 * Giải mã nội dung payload token mà không kiểm tra chữ ký (dùng cho debug/audit)
 * @param {string} token
 * @returns {object|null}
 */
function decodeToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

/**
 * Ký Refresh Token với thời hạn dài hơn (mặc định 7 ngày)
 * @param {object} payload
 * @param {object} [options]
 */
function signRefreshToken(payload, options = {}) {
  return signToken(payload, {
    expiresIn: env.REFRESH_TOKEN_EXPIRES_IN || '7d',
    ...options
  });
}

module.exports = {
  signToken,
  verifyToken,
  decodeToken,
  signRefreshToken
};
