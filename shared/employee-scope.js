const db = require('./db');

const ORGANIZATION_DB = process.env.ORGANIZATION_DB_NAME || 'htqlns_organization';

async function getVisibleEmployeeIds(user) {
  const empId = user?.empId || user?.emp_id;
  if (['ADMIN', 'HR'].includes(user?.role)) return null;
  if (user?.role === 'EMPLOYEE') return empId ? [empId] : [];
  if (user?.role !== 'MANAGER' || !empId) return [];

  const rows = await db.query(
    'SELECT id FROM employees WHERE manager_id = ? OR id = ?',
    [empId, empId],
    ORGANIZATION_DB
  );
  return rows.map((row) => row.id);
}

function addEmployeeScope(conditions, params, employeeIds, column) {
  if (employeeIds === null) return;
  if (!employeeIds.length) {
    conditions.push('1 = 0');
    return;
  }
  conditions.push(`${column} IN (${employeeIds.map(() => '?').join(', ')})`);
  params.push(...employeeIds);
}

async function isDirectReport(managerId, employeeId) {
  if (!managerId || !employeeId || managerId === employeeId) return false;
  const rows = await db.query(
    'SELECT id FROM employees WHERE id = ? AND manager_id = ? LIMIT 1',
    [employeeId, managerId],
    ORGANIZATION_DB
  );
  return rows.length > 0;
}

module.exports = { addEmployeeScope, getVisibleEmployeeIds, isDirectReport };
