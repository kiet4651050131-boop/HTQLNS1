/**
 * shared/db.js
 * Quản lý kết nối MySQL Pool (mysql2/promise) cho các service trong hệ thống SOA HTQLNS
 * Hỗ trợ truy vấn tham số an toàn, giao dịch (transaction) và đa database cho từng microservice
 */

const mysql = require('mysql2/promise');
const env = require('./env');

// Bộ nhớ đệm các pool kết nối theo tên database
const pools = new Map();

/**
 * Tạo cấu hình mặc định cho MySQL Pool
 * @param {string} [databaseName] - Tên cơ sở dữ liệu (tùy chọn)
 * @param {object} [customConfig] - Cấu hình mở rộng ghi đè
 */
function createPoolConfig(databaseName, customConfig = {}) {
  const config = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    timezone: '+07:00',
    dateStrings: true,
    ...customConfig
  };

  if (databaseName) {
    config.database = databaseName;
  }

  return config;
}

/**
 * Lấy hoặc khởi tạo Pool kết nối cho một Database cụ thể
 * @param {string} [databaseName] - Tên database, mặc định lấy từ env.DB_NAME
 */
function getPool(databaseName = env.DB_NAME) {
  const key = databaseName || '__default__';
  if (!pools.has(key)) {
    const pool = mysql.createPool(createPoolConfig(databaseName));
    pools.set(key, pool);
  }
  return pools.get(key);
}

/**
 * Thực thi câu truy vấn SQL có tham số (sử dụng pool.query)
 * @param {string} sql - Câu lệnh SQL với placeholder ?
 * @param {Array} [params] - Mảng tham số truyền vào
 * @param {string} [databaseName] - Tên database (tùy chọn)
 * @returns {Promise<Array>} Mảng bản ghi kết quả (rows)
 */
async function query(sql, params = [], databaseName = env.DB_NAME) {
  const pool = getPool(databaseName);
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Thực thi câu truy vấn SQL chuẩn bị trước (Prepared Statement - pool.execute)
 * @param {string} sql - Câu lệnh SQL
 * @param {Array} [params] - Mảng tham số
 * @param {string} [databaseName] - Tên database
 * @returns {Promise<any>} Kết quả thực thi
 */
async function execute(sql, params = [], databaseName = env.DB_NAME) {
  const pool = getPool(databaseName);
  const [result] = await pool.execute(sql, params);
  return result;
}

/**
 * Thực hiện chuỗi tác vụ trong một Transaction an toàn
 * Tự động COMMIT khi thành công, ROLLBACK khi có lỗi và RELEASE kết nối
 * @param {Function} callback - Hàm nhận đối tượng connection: async (conn) => { ... }
 * @param {string} [databaseName] - Tên database
 */
async function withTransaction(callback, databaseName = env.DB_NAME) {
  const pool = getPool(databaseName);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Kiểm tra kết nối tới Database (dùng cho /health check hoặc khởi động service)
 * @param {string} [databaseName]
 * @returns {Promise<boolean>}
 */
async function testConnection(databaseName = env.DB_NAME) {
  try {
    const pool = getPool(databaseName);
    const [rows] = await pool.query('SELECT 1 AS alive');
    return rows && rows.length > 0;
  } catch (err) {
    console.error(`[DB] Lỗi kiểm tra kết nối tới database "${databaseName}":`, err.message);
    return false;
  }
}

/**
 * Đóng toàn bộ các Pool kết nối (dùng khi shutdown service)
 */
async function closeAllPools() {
  for (const [name, pool] of pools.entries()) {
    try {
      await pool.end();
    } catch (err) {
      console.warn(`[DB] Lỗi đóng pool "${name}":`, err.message);
    }
  }
  pools.clear();
}

module.exports = {
  getPool,
  query,
  execute,
  withTransaction,
  testConnection,
  closeAllPools
};
