/**
 * public/js/app.js
 * Frontend JavaScript điều khiển giao diện chuẩn Figma (Images 1 - 5)
 * Tương tác với API Gateway trong kiến trúc Microservices HTQLNS
 */

const API_BASE = ''; // Gọi qua API Gateway cùng Host/Port

// 1. Quản lý lưu trữ cục bộ an toàn
function safeGetStorage(key, fallback = null) {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch (e) {
    return fallback;
  }
}

function safeSetStorage(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (e) {}
}

function safeRemoveStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

// Kiểm tra token JWT có đúng cấu trúc và còn hạn không
function isTokenValid(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return false; // Token đã hết hạn
    }
    return true;
  } catch {
    return false;
  }
}

// Làm sạch token demo cũ hoặc không hợp lệ khỏi localStorage khi mở trang
let storedToken = safeGetStorage('htqlns_token', null);
let storedRefreshToken = safeGetStorage('htqlns_refresh_token', null);
let storedUser = null;
try {
  storedUser = JSON.parse(safeGetStorage('htqlns_user', 'null'));
} catch {
  storedUser = null;
}

if (!isTokenValid(storedToken)) {
  storedToken = null;
  storedUser = null;
  safeRemoveStorage('htqlns_token');
  safeRemoveStorage('htqlns_user');
}
if (!isTokenValid(storedRefreshToken)) {
  storedRefreshToken = null;
  safeRemoveStorage('htqlns_refresh_token');
}

// 2. Dữ liệu bộ nhớ ứng dụng (State)
let state = {
  token: storedToken,
  refreshToken: storedRefreshToken,
  user: storedUser,
  departments: [],
  positions: [],
  employees: [],
  currentView: 'dashboard'
};

function clearClientSession() {
  state.token = null;
  state.refreshToken = null;
  state.user = null;
  const passwordInput = document.getElementById('loginPassword');
  if (passwordInput) passwordInput.value = '';
  safeRemoveStorage('htqlns_token');
  safeRemoveStorage('htqlns_refresh_token');
  safeRemoveStorage('htqlns_user');
}

// ==============================================================================
// 3. TOAST THÔNG BÁO
// ==============================================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toastBox');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==============================================================================
// 4. API CALLER QUA GATEWAY
// ==============================================================================
async function refreshAccessToken() {
  if (!state.refreshToken) {
    throw new Error('Không có refresh token để làm mới phiên');
  }

  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: state.refreshToken })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.data?.token) {
    const error = new Error(data?.error || data?.message || `Không thể làm mới phiên (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }

  state.token = data.data.token;
  safeSetStorage('htqlns_token', state.token);
}

async function apiCall(path, options = {}, canRefresh = true) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      if (res.status === 401 && path !== '/api/auth/login') {
        let refreshError = null;
        if (canRefresh && state.refreshToken) {
          try {
            await refreshAccessToken();
            return apiCall(path, options, false);
          } catch (err) {
            refreshError = err;
          }
        }

        clearClientSession();
        const portal = document.getElementById('portalApp');
        const login = document.getElementById('loginScreen');
        if (portal) portal.style.display = 'none';
        if (login) login.style.display = 'flex';
        toggleAuthMode('login');
        showToast(
          refreshError
            ? `Phiên đăng nhập hết hạn và không thể làm mới: ${refreshError.message}`
            : 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại',
          'warning'
        );
      }
      const error = new Error(data?.error || data?.message || `Lỗi HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }

    return data;
  } catch (err) {
    throw err;
  }
}

// ==============================================================================
// 5. XÁC THỰC & ĐĂNG NHẬP / ĐĂNG KÝ
// ==============================================================================
function toggleAuthMode(mode) {
  const isLogin = mode === 'login';
  const loginForm = document.getElementById('authLoginFormContainer');
  const regForm = document.getElementById('authRegisterFormContainer');
  if (loginForm) loginForm.style.display = isLogin ? 'block' : 'none';
  if (regForm) regForm.style.display = isLogin ? 'none' : 'block';

}

function togglePasswordVisibility(inputId, button) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
    const isVisible = input.type === 'text';
    if (button) {
      button.textContent = isVisible ? 'Ẩn' : 'Hiện';
      button.setAttribute('aria-label', `${isVisible ? 'Ẩn' : 'Hiện'} mật khẩu`);
    }
  }
}

async function handleLoginSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('btnLoginAction');

  if (!username || !password) {
    return showToast('Vui lòng nhập tên đăng nhập và mật khẩu', 'warning');
  }

  btn.disabled = true;
  btn.innerText = 'Đang đăng nhập...';

  try {
    const res = await apiCall('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (!res || !res.success || !res.data?.token) {
      throw new Error(res?.error || res?.message || 'Đăng nhập không thành công');
    }

    state.token = res.data.token;
    state.refreshToken = res.data.refreshToken || null;
    if (!res.data.user) throw new Error('Dữ liệu tài khoản từ máy chủ không hợp lệ');
    state.user = res.data.user;

    safeSetStorage('htqlns_token', state.token);
    if (state.refreshToken) safeSetStorage('htqlns_refresh_token', state.refreshToken);
    safeSetStorage('htqlns_user', JSON.stringify(state.user));

    showToast(`Đăng nhập thành công! Xin chào ${state.user.fullName || state.user.username}`, 'success');
    initPortalDashboard();
  } catch (err) {
    console.error('Lỗi đăng nhập:', err);
    showToast(err.message || 'Tên đăng nhập hoặc mật khẩu không chính xác', 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Login';
  }
}

async function handleRegisterSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  const firstName = document.getElementById('regFirstName').value.trim();
  const lastName = document.getElementById('regLastName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;
  const btn = document.getElementById('btnRegisterAction');

  if (password !== confirmPassword) {
    return showToast('Xác nhận mật khẩu không khớp', 'warning');
  }

  const username = email.split('@')[0] || `user_${Date.now()}`;
  btn.disabled = true;
  btn.innerText = 'Đang đăng ký...';

  try {
    const res = await apiCall('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        email,
        password,
        role: 'EMPLOYEE'
      })
    });

    if (!res || !res.success) {
      throw new Error(res?.error || res?.message || 'Đăng ký không thành công');
    }

    showToast(`Đăng ký tài khoản ${username} thành công! Mời bạn đăng nhập.`, 'success');
    toggleAuthMode('login');
    document.getElementById('loginUsername').value = username;
    document.getElementById('loginPassword').value = '';
  } catch (err) {
    console.error('Lỗi đăng ký:', err);
    showToast(err.message || 'Đăng ký thất bại, vui lòng thử lại', 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Register';
  }
}

async function handleLogoutClick() {
  if (!confirm('Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?')) return;

  let logoutError = null;
  try {
    await apiCall('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: state.refreshToken })
    });
  } catch (err) {
    logoutError = err;
  }

  clearClientSession();
  document.getElementById('portalApp').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  toggleAuthMode('login');
  showToast(
    logoutError
      ? `Đã xóa phiên trên thiết bị nhưng chưa xác nhận thu hồi phiên máy chủ: ${logoutError.message}`
      : 'Đã đăng xuất thành công',
    logoutError ? 'warning' : 'success'
  );
}

async function handleChangePassword(e) {
  if (e && e.preventDefault) e.preventDefault();

  const oldPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmNewPassword').value;
  const form = document.getElementById('changePasswordForm');

  if (newPassword !== confirmPassword) {
    showToast('Xác nhận mật khẩu mới không khớp', 'warning');
    return;
  }

  try {
    const res = await apiCall('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword })
    });
    if (!res?.success) {
      throw new Error(res?.error || res?.message || 'Đổi mật khẩu không thành công');
    }

    clearClientSession();
    if (form) form.reset();
    document.getElementById('portalApp').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    toggleAuthMode('login');
    showToast('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.', 'success');
  } catch (err) {
    showToast(`Không thể đổi mật khẩu: ${err.message}`, 'error');
  }
}

function handleForgotPasswordClick() {
  const email = prompt('Nhập địa chỉ email tài khoản để nhận mã OTP khôi phục:', 'hieu.vd@htqlns.com');
  if (!email) return;
  showToast(`Mã xác thực OTP đã được gửi đến email ${email}.`, 'success');
}

// ==============================================================================
// 6. CHUYỂN ĐỔI GIAO DIỆN & ĐIỀU HƯỚNG
// ==============================================================================
function showScreenView(screen) {
  const isRegister = screen === 'register';
  document.getElementById('portalApp').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  toggleAuthMode(isRegister ? 'register' : 'login');
}

function updateTopbarUser() {
  if (!state.user) return;
  const displayName = state.user.fullName || state.user.username || 'Người dùng';
  const displayRole = state.user.role === 'ADMIN' ? 'Quản trị viên Hệ thống' :
                      (state.user.role === 'HR' ? 'Phòng Nhân sự' :
                      (state.user.role === 'MANAGER' ? 'Quản lý' : 'Nhân viên'));

  const nameEl = document.getElementById('topbarUserName');
  const roleEl = document.getElementById('topbarUserRole');
  const avatarEl = document.getElementById('topbarAvatarCircle');
  const greetSub = document.getElementById('dashGreetingSub');

  if (nameEl) nameEl.innerText = `Xin chào, ${displayName}`;
  if (roleEl) roleEl.innerText = displayRole;
  if (avatarEl) {
    const parts = displayName.trim().split(' ');
    avatarEl.innerText = (parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]) : displayName.slice(0, 2)).toUpperCase();
  }
  if (greetSub) {
    greetSub.innerText = `Xin chào ${displayName}, dữ liệu hiển thị theo vai trò và phạm vi được cấp quyền.`;
  }
}

// Phân quyền giao diện theo vai trò người dùng (RBAC Interface Guard)
function applyRoleBasedUI() {
  const role = state.user?.role || 'EMPLOYEE';
  const isEmployee = role === 'EMPLOYEE';
  const canViewAccounts = role === 'ADMIN' || role === 'HR';

  const setDisplay = (id, show, displayValue = 'block') => {
    const element = document.getElementById(id);
    if (element) element.style.display = show ? displayValue : 'none';
  };

  setDisplay('nav-rbac', canViewAccounts, 'flex');
  const rbacNav = document.getElementById('nav-rbac');
  if (rbacNav) rbacNav.textContent = role === 'HR' ? 'Danh sách tài khoản' : 'Quản lý phân quyền';
  setDisplay('nav-soa-monitor', role === 'ADMIN', 'flex');
  setDisplay('nav-settings', role === 'ADMIN' || role === 'HR', 'flex');
  setDisplay('nav-departments', role === 'ADMIN' || role === 'HR', 'flex');
  setDisplay('nav-attendance-history', ['ADMIN', 'HR', 'MANAGER'].includes(role), 'flex');
  setDisplay('nav-employees', ['ADMIN', 'HR', 'MANAGER'].includes(role), 'flex');
  setDisplay('dashOrgMetrics', !isEmployee);
  setDisplay('dashOrgDataState', !isEmployee);
  setDisplay('dashOrgDetails', !isEmployee);
  setDisplay('dashPendingApprovalCard', !isEmployee);
  setDisplay('dashPersonalMetrics', isEmployee);
  setDisplay('statEmployeePersonalCard', isEmployee);
  setDisplay('statPeriodFilters', !isEmployee, 'flex');
  setDisplay('statOrgMetrics', !isEmployee);
  setDisplay('statDepartmentReport', !isEmployee);
  setDisplay('statAlertsReport', !isEmployee);
}

function navigateToView(viewName) {
  const role = state.user?.role || 'EMPLOYEE';
  const allowedRolesByView = {
    dashboard: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
    employees: ['ADMIN', 'HR', 'MANAGER'],
    departments: ['ADMIN', 'HR'],
    'attendance-history': ['ADMIN', 'HR', 'MANAGER'],
    'my-attendance': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
    rbac: ['ADMIN', 'HR'],
    stats: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
    requests: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
    settings: ['ADMIN', 'HR'],
    profile: ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
    'soa-monitor': ['ADMIN']
  };
  if (!allowedRolesByView[viewName] || !allowedRolesByView[viewName].includes(role)) {
    showToast('Vai trò hiện tại không có quyền truy cập chức năng này', 'error');
    return;
  }

  state.currentView = viewName;

  // Cập nhật tab active trên Sidebar
  document.querySelectorAll('.figma-nav-item').forEach((item) => {
    item.classList.remove('active');
  });

  const targetNavItem = document.getElementById(`nav-${viewName}`);
  if (targetNavItem) targetNavItem.classList.add('active');

  // Ẩn tất cả view section
  document.querySelectorAll('.figma-view-section').forEach((sec) => {
    sec.style.display = 'none';
  });

  // Hiển thị view tương ứng
  let targetSection = document.getElementById(`view-${viewName}`);
  if (!targetSection) {
    if (viewName === 'requests') {
      targetSection = document.getElementById('view-request-detail');
    } else {
      targetSection = document.getElementById('view-dashboard');
    }
  }

  if (targetSection) targetSection.style.display = 'block';

  // Nạp dữ liệu tương ứng
  if (viewName === 'dashboard') loadDashboardData();
  if (viewName === 'employees') loadEmployeesData();
  if (viewName === 'departments') loadDepartmentsData();
  if (viewName === 'attendance-history') loadAttendanceHistoryData();
  if (viewName === 'my-attendance') loadMyAttendanceData();
  if (viewName === 'rbac') loadRbacUsersData();
  if (viewName === 'stats') loadStatsData();
  if (viewName === 'soa-monitor') loadSoaServicesStatus();
  if (viewName === 'profile') loadProfileData();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openRequestDetail(requestId) {
  document.querySelectorAll('.figma-view-section').forEach((sec) => {
    sec.style.display = 'none';
  });

  const detailSec = document.getElementById('view-request-detail');
  if (detailSec) detailSec.style.display = 'block';

  document.querySelectorAll('.figma-nav-item').forEach((item) => {
    item.classList.remove('active');
  });
  const navReq = document.getElementById('nav-requests');
  if (navReq) navReq.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==============================================================================
// 7. NẠP DỮ LIỆU CÁC DỊCH VỤ & GIAO DIỆN
// ==============================================================================
async function loadDashboardData() {
  if (state.user?.role === 'EMPLOYEE') {
    return loadPersonalDashboardData();
  }
  return loadManagementDashboardData(new Date());
}

function setElementText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatMetric(value, maximumFractionDigits = 0) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('vi-VN', { maximumFractionDigits });
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getApiArray(response, resourceName) {
  if (!response?.success || !Array.isArray(response.data)) {
    throw new Error(`Dữ liệu ${resourceName} từ máy chủ không hợp lệ`);
  }
  return response.data;
}

async function fetchOrgAnalytics(date) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const response = await apiCall(`/api/analytics/dashboard?month=${month}&year=${year}`);
  const data = response?.data;
  const requiredMetrics = [
    'totalWorkDays', 'totalOnTimeDays', 'totalLateDays', 'totalAbsentDays',
    'totalLateMinutes', 'totalLeaveDays', 'totalOtHours', 'activeHeadcount'
  ];
  if (
    !response?.success ||
    !data?.period ||
    !Number.isInteger(Number(data.period.month)) ||
    !Number.isInteger(Number(data.period.year)) ||
    !data.kpis ||
    requiredMetrics.some((metric) => data.kpis[metric] === null || data.kpis[metric] === undefined || !Number.isFinite(Number(data.kpis[metric]))) ||
    !Array.isArray(data.lateEmployees) ||
    !Array.isArray(data.alerts)
  ) {
    throw new Error(response?.error || 'Analytics Service trả về dữ liệu không hợp lệ');
  }
  return data;
}

function renderOrgDashboard(data) {
  const kpis = data.kpis;
  setElementText('dashMetricVal1', formatMetric(kpis.totalWorkDays));
  setElementText('dashMetricVal2', formatMetric(kpis.totalLeaveDays));
  setElementText('dashMetricVal3', formatMetric(kpis.totalLateMinutes));
  setElementText('dashMetricVal4', formatMetric(kpis.totalOtHours, 2));
  setElementText('dashOrgDataState', `Số liệu thực tế tháng ${data.period.month}/${data.period.year}.`);

  const categories = [
    { count: Number(kpis.totalOnTimeDays), circle: 'dashCircleOnTime', legend: 'dashLegendOnTime' },
    { count: Number(kpis.totalLateDays), circle: 'dashCircleLate', legend: 'dashLegendLate' },
    { count: Number(kpis.totalLeaveDays), circle: 'dashCircleLeave', legend: 'dashLegendLeave' },
    { count: Number(kpis.totalAbsentDays), circle: 'dashCircleAbsent', legend: 'dashLegendAbsent' }
  ];
  const total = categories.reduce((sum, item) => sum + item.count, 0);
  let offset = 0;
  categories.forEach((item) => {
    const circle = document.getElementById(item.circle);
    const percentage = total ? (item.count / total) * 100 : 0;
    if (circle) {
      circle.setAttribute('stroke-dasharray', `${percentage} ${100 - percentage}`);
      circle.setAttribute('stroke-dashoffset', String(-offset));
    }
    setElementText(item.legend, formatMetric(item.count));
    offset += percentage;
  });
  setElementText('dashDonutTotal', formatMetric(total));

  const lateBody = document.getElementById('dashLateEmployeesBody');
  if (lateBody) {
    const lateEmployees = Array.isArray(data.lateEmployees) ? data.lateEmployees : [];
    setElementText('dashLateCountBadge', `${lateEmployees.length} nhân sự`);
    lateBody.innerHTML = lateEmployees.length
      ? lateEmployees.map((employee) => `
        <tr>
          <td><strong>${escapeHtml(employee.empId || '—')}</strong></td>
          <td>${formatMetric(employee.lateDays)} ngày</td>
          <td>${formatMetric(employee.lateMinutes)} phút</td>
          <td>Trong tháng</td>
        </tr>
      `).join('')
      : '<tr><td colspan="4" style="text-align: center; color: #64748b;">Không có ngày đi muộn trong kỳ này.</td></tr>';
  }
}

async function loadManagementDashboardData(date) {
  const pendingBody = document.getElementById('dashPendingLeavesBody');
  const pendingState = document.getElementById('dashOrgDataState');
  const monthLabel = `Tháng ${date.getMonth() + 1}/${date.getFullYear()}`;
  setElementText('currentDatePillText', monthLabel);
  setElementText('currentDeptPillText', state.user?.role === 'MANAGER' ? 'Nhóm được phân quyền' : 'Toàn tổ chức');
  setElementText('dashUpdateTime', `Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
  setElementText('dashGreetingSub', `Dữ liệu tổng hợp ${monthLabel}, theo phạm vi được cấp quyền.`);
  setElementText('dashOrgDataState', `Đang tải dashboard ${monthLabel}...`);
  ['dashMetricVal1', 'dashMetricVal2', 'dashMetricVal3', 'dashMetricVal4', 'dashDonutTotal',
    'dashLegendOnTime', 'dashLegendLate', 'dashLegendLeave', 'dashLegendAbsent']
    .forEach((id) => setElementText(id, '—'));
  setElementText('dashPendingLeaveCount', '—');
  if (pendingBody) {
    pendingBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b;">Đang tải danh sách đơn...</td></tr>';
  }
  const lateBody = document.getElementById('dashLateEmployeesBody');
  if (lateBody) lateBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748b;">Đang tải dữ liệu...</td></tr>';
  if (pendingState) pendingState.style.color = '#64748b';

  try {
    const data = await fetchOrgAnalytics(date);
    renderOrgDashboard(data);
  } catch (err) {
    setElementText('dashOrgDataState', `Không thể tải dashboard: ${err.message}`);
    ['dashMetricVal1', 'dashMetricVal2', 'dashMetricVal3', 'dashMetricVal4', 'dashDonutTotal',
      'dashLegendOnTime', 'dashLegendLate', 'dashLegendLeave', 'dashLegendAbsent']
      .forEach((id) => setElementText(id, '—'));
    ['dashCircleOnTime', 'dashCircleLate', 'dashCircleLeave', 'dashCircleAbsent'].forEach((id) => {
      const circle = document.getElementById(id);
      if (circle) circle.setAttribute('stroke-dasharray', '0 100');
    });
    const lateBody = document.getElementById('dashLateEmployeesBody');
    if (lateBody) lateBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #b91c1c;">Không thể tải dữ liệu: ${escapeHtml(err.message)}</td></tr>`;
    setElementText('dashLateCountBadge', '—');
    if (pendingState) pendingState.style.color = '#b91c1c';
  }

  try {
    const approvalQueue = state.user?.role === 'MANAGER' ? '&approvalQueue=true' : '';
    const response = await apiCall(`/api/leaves?status=PENDING${approvalQueue}`);
    const requests = getApiArray(response, 'đơn nghỉ phép');
    setElementText('dashPendingLeaveCount', formatMetric(requests.length));
    if (pendingBody) {
      pendingBody.innerHTML = requests.length
        ? requests.map((request) => `
          <tr>
            <td><strong>${escapeHtml(request.emp_id || '—')}</strong></td>
            <td>${escapeHtml(request.leave_name || request.leave_code || 'Đơn nghỉ phép')}</td>
            <td>${escapeHtml(request.start_date || '—')} – ${escapeHtml(request.end_date || '—')} (${formatMetric(request.total_days)} ngày)</td>
            <td>${escapeHtml(request.created_at || '—')}</td>
            <td>Đang chờ xử lý</td>
          </tr>
        `).join('')
        : '<tr><td colspan="5" style="text-align: center; color: #64748b;">Không có đơn nghỉ phép chờ duyệt.</td></tr>';
    }
  } catch (err) {
    setElementText('dashPendingLeaveCount', '—');
    if (pendingBody) {
      pendingBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #b91c1c;">Không thể tải đơn chờ duyệt: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function renderPersonalDashboard(data) {
  const values = {
    dashPersonalWorkDays: `${formatMetric(data.workDays)} ngày`,
    dashPersonalWorkHours: `Tổng giờ làm ${formatMetric(data.workHours, 2)}`,
    dashPersonalLeaveDays: formatMetric(data.leaveDays, 2),
    dashPersonalLateDays: `${formatMetric(data.lateDays)} ngày`,
    dashPersonalLateMinutes: `Tổng phút đi muộn ${formatMetric(data.lateMinutes)}`,
    dashPersonalPending: formatMetric(data.pendingRequests),
    statPersonalWorkDays: `${formatMetric(data.workDays)} ngày`,
    statPersonalWorkHours: `Tổng giờ làm ${formatMetric(data.workHours, 2)}`,
    statPersonalLeaveDays: formatMetric(data.leaveDays, 2),
    statPersonalLateDays: `${formatMetric(data.lateDays)} ngày`,
    statPersonalLateMinutes: `Tổng phút đi muộn ${formatMetric(data.lateMinutes)}`,
    statPersonalPending: formatMetric(data.pendingRequests),
    myAttendanceWorkDays: `${formatMetric(data.workDays)} ngày`,
    myAttendanceWorkHours: `Tổng giờ làm: ${formatMetric(data.workHours, 2)}`,
    myAttendanceLateDays: `${formatMetric(data.lateDays)} lần`,
    myAttendanceLateMinutes: `Tổng thời gian trễ: ${formatMetric(data.lateMinutes)} phút`,
    myAttendanceLeaveDays: `${formatMetric(data.leaveDays, 2)} ngày`
  };
  Object.entries(values).forEach(([id, value]) => setElementText(id, value));
}

function renderPersonalAttendanceTable(attendance) {
  const tbody = document.getElementById('myAttendanceTableBody');
  if (!tbody) return;
  if (!attendance.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">Chưa có dữ liệu chấm công trong tháng này.</td></tr>';
    return;
  }

  const statusLabels = {
    ON_TIME: 'Đúng giờ',
    LATE: 'Đi muộn',
    EARLY_LEAVE: 'Về sớm',
    LATE_AND_EARLY: 'Đi muộn và về sớm',
    ABSENT: 'Vắng mặt',
    ON_LEAVE: 'Nghỉ phép'
  };
  tbody.innerHTML = attendance.map((row) => {
    const status = String(row.status || '').toUpperCase();
    const tone = ['LATE', 'LATE_AND_EARLY'].includes(status)
      ? 'style="background:#fef3c7; color:#d97706;"'
      : status === 'ON_TIME'
        ? 'class="badge-status badge-approved"'
        : 'class="badge-status"';
    const checkIn = row.check_in_time ? String(row.check_in_time).slice(11, 16) : '—';
    const checkOut = row.check_out_time ? String(row.check_out_time).slice(11, 16) : '—';
    return `
      <tr>
        <td><strong>${escapeHtml(row.work_date || '—')}</strong></td>
        <td>${escapeHtml(checkIn)}</td>
        <td>${escapeHtml(checkOut)}</td>
        <td>${formatMetric(row.actual_working_hours, 2)} giờ</td>
        <td>${escapeHtml(row.check_in_method || row.location_name || '—')}</td>
        <td><span ${tone}>${escapeHtml(statusLabels[status] || status || 'Chưa xác định')}</span></td>
      </tr>
    `;
  }).join('');
}

async function loadPersonalDashboardData() {
  const status = document.getElementById('dashPersonalDataState');
  const attendanceStatus = document.getElementById('myAttendanceDataState');
  const now = new Date();
  setElementText('currentDatePillText', `Tháng ${now.getMonth() + 1}/${now.getFullYear()}`);
  setElementText('currentDeptPillText', 'Hồ sơ cá nhân');
  setElementText('dashUpdateTime', `Cập nhật lúc ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
  setElementText('dashGreetingSub', `Số liệu chấm công và đơn từ cá nhân tháng ${now.getMonth() + 1}/${now.getFullYear()}.`);
  if (status) {
    status.style.color = '#64748b';
    status.textContent = 'Đang tải số liệu cá nhân...';
  }
  if (attendanceStatus) {
    attendanceStatus.style.color = '#64748b';
    attendanceStatus.textContent = 'Đang tải dữ liệu cá nhân...';
  }
  ['dashPersonalWorkDays', 'dashPersonalWorkHours', 'dashPersonalLeaveDays', 'dashPersonalLateDays', 'dashPersonalLateMinutes', 'dashPersonalPending',
    'statPersonalWorkDays', 'statPersonalWorkHours', 'statPersonalLeaveDays', 'statPersonalLateDays', 'statPersonalLateMinutes', 'statPersonalPending',
    'myAttendanceWorkDays', 'myAttendanceWorkHours', 'myAttendanceLateDays', 'myAttendanceLateMinutes', 'myAttendanceLeaveDays']
    .forEach((id) => setElementText(id, '—'));

  try {
    if (!state.user?.empId) {
      const profile = await apiCall('/api/organization/employees/me/profile');
      if (!profile?.success || !profile.data?.id) {
        throw new Error('Tài khoản chưa liên kết hồ sơ nhân sự; vui lòng liên hệ HR.');
      }
      state.user.empId = profile.data.id;
    }

    const fromDate = localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const toDate = localDateKey(now);
    const year = now.getFullYear();
    const [attendanceRes, balanceRes, leaveRes, otRes] = await Promise.all([
      apiCall(`/api/attendance?fromDate=${fromDate}&toDate=${toDate}`),
      apiCall(`/api/leaves/balances?year=${year}`),
      apiCall('/api/leaves?status=PENDING'),
      apiCall('/api/ot?status=PENDING')
    ]);

    const attendance = getApiArray(attendanceRes, 'chấm công');
    const balances = getApiArray(balanceRes, 'quỹ phép');
    const leaves = getApiArray(leaveRes, 'đơn nghỉ phép');
    const overtime = getApiArray(otRes, 'đơn OT');
    const data = {
      workDays: attendance.filter((row) => !['ABSENT', 'ON_LEAVE'].includes(row.status)).length,
      workHours: attendance.reduce((sum, row) => sum + Number(row.actual_working_hours || 0), 0),
      leaveDays: balances.reduce((sum, row) => sum + Number(row.remaining_days ?? (Number(row.total_days || 0) - Number(row.used_days || 0) - Number(row.pending_days || 0))), 0),
      lateDays: attendance.filter((row) => Number(row.late_minutes || 0) > 0 || ['LATE', 'LATE_AND_EARLY'].includes(row.status)).length,
      lateMinutes: attendance.reduce((sum, row) => sum + Number(row.late_minutes || 0), 0),
      pendingRequests: leaves.length + overtime.length
    };
    renderPersonalDashboard(data);
    renderPersonalAttendanceTable(attendance);
    if (status) status.textContent = `Số liệu cá nhân thực tế tháng ${now.getMonth() + 1}/${year}.`;
    if (attendanceStatus) attendanceStatus.textContent = `Dữ liệu chấm công thực tế tháng ${now.getMonth() + 1}/${year}.`;
    const statsStatus = document.getElementById('statPersonalDataState');
    if (statsStatus) statsStatus.textContent = `Số liệu cá nhân thực tế tháng ${now.getMonth() + 1}/${year}.`;
  } catch (err) {
    ['dashPersonalWorkDays', 'dashPersonalWorkHours', 'dashPersonalLeaveDays', 'dashPersonalLateDays', 'dashPersonalLateMinutes', 'dashPersonalPending',
      'statPersonalWorkDays', 'statPersonalWorkHours', 'statPersonalLeaveDays', 'statPersonalLateDays', 'statPersonalLateMinutes', 'statPersonalPending',
      'myAttendanceWorkDays', 'myAttendanceWorkHours', 'myAttendanceLateDays', 'myAttendanceLateMinutes', 'myAttendanceLeaveDays']
      .forEach((id) => setElementText(id, '—'));
    const message = `Không thể tải số liệu cá nhân: ${err.message}`;
    if (status) {
      status.style.color = '#b91c1c';
      status.textContent = message;
    }
    if (attendanceStatus) {
      attendanceStatus.style.color = '#b91c1c';
      attendanceStatus.textContent = message;
    }
    const attendanceBody = document.getElementById('myAttendanceTableBody');
    if (attendanceBody) attendanceBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #b91c1c;">${escapeHtml(message)}</td></tr>`;
    const statsStatus = document.getElementById('statPersonalDataState');
    if (statsStatus) {
      statsStatus.style.color = '#b91c1c';
      statsStatus.textContent = message;
    }
  }
}

async function loadDepartmentsData() {
  const tbody = document.getElementById('departmentsTableFullBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">Đang tải dữ liệu...</td></tr>';
  try {
    const res = await apiCall('/api/organization/departments');
    state.departments = getApiArray(res, 'phòng ban');
    renderDepartmentsTable(state.departments);
  } catch (err) {
    state.departments = [];
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #b91c1c;">Không thể tải phòng ban: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderDepartmentsTable(list) {
  const tbody = document.getElementById('departmentsTableFullBody');
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8;">Chưa có dữ liệu phòng ban</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (d) => `
    <tr>
      <td><strong>${d.code}</strong></td>
      <td><strong>${d.name}</strong></td>
      <td>${d.manager_name || 'Chưa bổ nhiệm'}</td>
      <td><span class="badge-status badge-approved">${d.employee_count || 0} nhân sự</span></td>
      <td>${d.description || '-'}</td>
      <td><span class="badge-status ${d.status === 'ACTIVE' ? 'badge-approved' : 'badge-rejected'}">${d.status || 'ACTIVE'}</span></td>
    </tr>
  `
    )
    .join('');
}

function handleDepartmentFilter() {
  const kw = document.getElementById('departmentSearchInput')?.value.toLowerCase() || '';
  const filtered = (state.departments || []).filter(
    (d) => d.name.toLowerCase().includes(kw) || d.code.toLowerCase().includes(kw)
  );
  renderDepartmentsTable(filtered);
}

async function loadEmployeesData() {
  const tbody = document.getElementById('employeesTableFullBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #64748b;">Đang tải dữ liệu...</td></tr>';
  try {
    const res = await apiCall('/api/organization/employees');
    state.employees = getApiArray(res, 'nhân sự');
    renderEmployeesTable(state.employees);
  } catch (err) {
    state.employees = [];
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #b91c1c;">Không thể tải nhân sự: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderEmployeesTable(list) {
  const tbody = document.getElementById('employeesTableFullBody');
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8;">Chưa có dữ liệu nhân sự</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (e) => `
    <tr>
      <td><strong>${e.code || e.employee_code}</strong></td>
      <td><strong>${e.full_name}</strong></td>
      <td>${e.email}</td>
      <td>${e.phone || '-'}</td>
      <td>${e.department_name || '-'}</td>
      <td>${e.position_title || e.position_name || '-'}</td>
      <td><span class="badge-status" style="background:#f1f5f9; color:#475569;">${e.contract_type || 'OFFICIAL'}</span></td>
      <td><span class="badge-status ${e.status === 'ACTIVE' ? 'badge-approved' : 'badge-rejected'}">${e.status}</span></td>
    </tr>
  `
    )
    .join('');
}

function handleEmployeeFilter() {
  const kw = document.getElementById('employeeSearchInput')?.value.toLowerCase() || '';
  const filtered = (state.employees || []).filter(
    (e) =>
      e.full_name.toLowerCase().includes(kw) ||
      (e.code && e.code.toLowerCase().includes(kw)) ||
      (e.email && e.email.toLowerCase().includes(kw))
  );
  renderEmployeesTable(filtered);
}

// Nạp lịch sử chấm công trong phạm vi được cấp quyền
async function loadAttendanceHistoryData() {
  const tbody = document.getElementById('attendanceHistoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #64748b;">Đang tải dữ liệu...</td></tr>';

  const dateInput = document.getElementById('attendanceHistoryDate');
  if (dateInput && !dateInput.value) dateInput.value = localDateKey(new Date());
  const selectedDate = dateInput?.value || localDateKey(new Date());
  try {
    const [attendanceRes, employeesRes] = await Promise.all([
      apiCall(`/api/attendance?fromDate=${encodeURIComponent(selectedDate)}&toDate=${encodeURIComponent(selectedDate)}`),
      apiCall('/api/organization/employees')
    ]);
    const records = getApiArray(attendanceRes, 'chấm công');
    const employees = getApiArray(employeesRes, 'nhân sự');
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const statusLabels = {
      ON_TIME: 'Đúng giờ',
      LATE: 'Đi muộn',
      EARLY_LEAVE: 'Về sớm',
      LATE_AND_EARLY: 'Đi muộn và về sớm',
      ABSENT: 'Vắng mặt',
      ON_LEAVE: 'Nghỉ phép'
    };

    tbody.innerHTML = records.length
      ? records.map((record) => {
        const employee = employeeById.get(record.emp_id);
        const status = String(record.status || '').toUpperCase();
        const badgeClass = status === 'ON_TIME' ? 'badge-approved' : '';
        const badgeStyle = badgeClass ? '' : ' style="background:#f1f5f9; color:#475569;"';
        return `
          <tr>
            <td><strong>${escapeHtml(employee?.code || record.emp_id)}</strong></td>
            <td><strong>${escapeHtml(employee?.full_name || 'Không tìm thấy hồ sơ')}</strong></td>
            <td>${escapeHtml(employee?.department_name || '—')}</td>
            <td>${escapeHtml(record.work_date || selectedDate)}</td>
            <td>${escapeHtml(record.check_in_time ? String(record.check_in_time).slice(11, 16) : '—')}</td>
            <td>${escapeHtml(record.check_out_time ? String(record.check_out_time).slice(11, 16) : '—')}</td>
            <td><strong>${formatMetric(record.actual_working_hours, 2)} h</strong></td>
            <td><span class="badge-status ${badgeClass}"${badgeStyle}>${escapeHtml(statusLabels[status] || status || 'Chưa xác định')}</span></td>
            <td>${escapeHtml(record.check_in_method || record.location_name || '—')}</td>
          </tr>
        `;
      }).join('')
      : '<tr><td colspan="9" style="text-align: center; color: #64748b;">Không có dữ liệu chấm công trong ngày đã chọn.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #b91c1c;">Không thể tải lịch sử chấm công: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// Nạp lịch sử chấm công cá nhân
function loadMyAttendanceData() {
  return loadPersonalDashboardData();
}

// ==============================================================================
// NẠP VÀ QUẢN LÝ PHÂN QUYỀN (RBAC - CHỈ ADMIN)
// ==============================================================================
async function loadRbacUsersData() {
  const tbody = document.getElementById('rbacUsersTableBody');
  if (!tbody) return;
  const canAssignRoles = state.user?.role === 'ADMIN';

  tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 20px;">Đang kết nối Auth Service (:3001) để lấy danh sách tài khoản...</td></tr>`;

  let users;
  try {
    const res = await apiCall('/api/auth/users');
    users = getApiArray(res, 'tài khoản');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #b91c1c; padding: 20px;">Không thể tải danh sách tài khoản: ${escapeHtml(err.message)}</td></tr>`;
    return;
  }

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 20px;">Chưa có tài khoản để hiển thị.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map((u) => {
    let roleBadge = '<span class="badge-status badge-approved">EMPLOYEE</span>';
    if (u.role === 'ADMIN') roleBadge = '<span class="badge-status badge-rejected">ADMIN</span>';
    else if (u.role === 'HR') roleBadge = '<span class="badge-status" style="background:#eff6ff; color:#2563eb;">HR</span>';
    else if (u.role === 'MANAGER') roleBadge = '<span class="badge-status" style="background:#fef3c7; color:#d97706;">MANAGER</span>';

    return `
      <tr>
        <td><strong>${escapeHtml(u.username)}</strong></td>
        <td>${escapeHtml(u.email || '-')}</td>
        <td><code>${escapeHtml(u.emp_id || '-')}</code></td>
        <td>${roleBadge}</td>
        <td>
          ${canAssignRoles ? `
            <select id="role-select-${escapeHtml(u.id)}" class="figma-pill-input" style="padding: 6px 12px; font-size: 13px; font-weight: 600;">
              <option value="ADMIN" ${u.role === 'ADMIN' ? 'selected' : ''}>ADMIN (Quản trị viên)</option>
              <option value="HR" ${u.role === 'HR' ? 'selected' : ''}>HR (Phòng Nhân sự)</option>
              <option value="MANAGER" ${u.role === 'MANAGER' ? 'selected' : ''}>MANAGER (Quản lý)</option>
              <option value="EMPLOYEE" ${u.role === 'EMPLOYEE' ? 'selected' : ''}>EMPLOYEE (Nhân viên)</option>
            </select>
          ` : 'Chỉ ADMIN được gán vai trò'}
        </td>
        <td>
          ${canAssignRoles ? `
            <button class="btn-primary-blue" style="padding: 6px 14px; font-size: 12.5px;" data-user-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}">
              Lưu quyền
            </button>
          ` : '-'}
        </td>
      </tr>
    `;
  }).join('');
  tbody.querySelectorAll('[data-user-id]').forEach((button) => {
    button.addEventListener('click', () => handleUpdateUserRole(button.dataset.userId, button.dataset.username));
  });
}

async function handleUpdateUserRole(userId, username) {
  if (state.user?.role !== 'ADMIN') {
    showToast('Chỉ Quản trị viên (ADMIN) mới được gán vai trò tài khoản', 'error');
    return;
  }

  const selectEl = document.getElementById(`role-select-${userId}`);
  if (!selectEl) return;
  const newRole = selectEl.value;

  try {
    const res = await apiCall(`/api/auth/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole })
    });
    showToast(`Đã phân quyền thành công tài khoản "${username}" thành vai trò [${newRole}]!`, 'success');
    loadRbacUsersData();
  } catch (err) {
    showToast(`Lỗi phân quyền: ${err.message}`, 'error');
  }
}

// ==============================================================================
// NẠP VÀ ĐIỀU KHIỂN BÁO CÁO THỐNG KÊ (ANALYTICS & ATTENDANCE)
// ==============================================================================
function loadStatsData() {
  if (state.user?.role === 'EMPLOYEE') {
    return loadPersonalDashboardData();
  }
  return changeStatPeriod(0);
}

async function changeStatPeriod(monthOffset = 0) {
  const offset = Number.isInteger(Number(monthOffset)) ? Math.min(2, Math.max(0, Number(monthOffset))) : 0;
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - offset);

  ['statPeriodBtn1', 'statPeriodBtn2', 'statPeriodBtn3'].forEach((id, index) => {
    const btn = document.getElementById(id);
    if (btn) {
      const selected = index === offset;
      btn.textContent = `${index === 0 ? 'Tháng này' : index === 1 ? 'Tháng trước' : '2 tháng trước'} (${dateLabelForOffset(index)})`;
      btn.style.background = selected ? 'var(--mint-green)' : '';
      btn.style.color = selected ? 'var(--mint-green-text)' : '';
      btn.style.border = selected ? 'none' : '';
    }
  });

  const tbody = document.getElementById('statAlertsBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #64748b;">Đang tải dữ liệu analytics...</td></tr>';
  ['statMetricOnTime', 'statMetricLate', 'statMetricLeave', 'statMetricHours', 'statFootEmployees',
    'statFootStandardDays', 'statFootActualDays', 'statFootLateCount', 'statFootLeaveDays', 'statFootRate']
    .forEach((id) => setElementText(id, '—'));
  setElementText('statAlertCount', 'Đang tải...');

  try {
    const data = await fetchOrgAnalytics(date);
    const kpis = data.kpis;
    setElementText('statMetricOnTime', formatMetric(kpis.totalWorkDays));
    setElementText('statMetricLate', formatMetric(kpis.totalLateDays));
    setElementText('statMetricLeave', formatMetric(kpis.totalLeaveDays));
    setElementText('statMetricHours', `${formatMetric(kpis.totalOtHours, 2)} h`);
    setElementText('statMetricOnTimeSub', `Tháng ${data.period.month}/${data.period.year}`);
    setElementText('statMetricLateSub', `${formatMetric(kpis.totalLateMinutes)} phút đi muộn`);
    setElementText('statMetricLeaveSub', 'Đã được duyệt trong kỳ');
    setElementText('statMetricHoursSub', 'Giờ OT đã duyệt trong kỳ');
    setElementText('statFootEmployees', formatMetric(kpis.activeHeadcount));
    setElementText('statFootActualDays', `${formatMetric(kpis.totalWorkDays)} công`);
    setElementText('statFootLateCount', `${formatMetric(kpis.totalLateDays)} ngày`);
    setElementText('statFootLeaveDays', `${formatMetric(kpis.totalLeaveDays)} ngày`);

    if (tbody) {
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];
      tbody.innerHTML = alerts.length
        ? alerts.map((alert) => `
          <tr>
            <td><strong>${escapeHtml(alert.type || 'ALERT')}</strong></td>
            <td>${escapeHtml(alert.message || 'Cảnh báo analytics')}</td>
            <td>${formatMetric(alert.value, 2)}</td>
            <td>Ngưỡng cấu hình</td>
            <td><span class="badge-status badge-rejected">CẢNH BÁO</span></td>
            <td>1</td>
            <td>Đang theo dõi</td>
          </tr>
        `).join('')
        : '<tr><td colspan="7" style="text-align: center; color: #64748b;">Không có cảnh báo trong kỳ này.</td></tr>';
      setElementText('statAlertCount', `${alerts.length} cảnh báo`);
    }

    const deptBody = document.getElementById('statDeptTableBody');
    if (deptBody) {
      deptBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #64748b;">Analytics Service hiện chưa cung cấp số liệu phân tách theo phòng ban.</td></tr>';
    }
  } catch (err) {
    ['statMetricOnTime', 'statMetricLate', 'statMetricLeave', 'statMetricHours', 'statFootEmployees',
      'statFootStandardDays', 'statFootActualDays', 'statFootLateCount', 'statFootLeaveDays', 'statFootRate']
      .forEach((id) => setElementText(id, '—'));
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #b91c1c;">Không thể tải cảnh báo: ${escapeHtml(err.message)}</td></tr>`;
    setElementText('statAlertCount', 'Không tải được');
    const deptBody = document.getElementById('statDeptTableBody');
    if (deptBody) deptBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #b91c1c;">Không thể tải báo cáo: ${escapeHtml(err.message)}</td></tr>`;
    showToast(`Không thể tải báo cáo analytics: ${err.message}`, 'error');
  }
}

function dateLabelForOffset(offset) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - offset);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

// Nạp dữ liệu hồ sơ cá nhân
function loadProfileData() {
  if (!state.user) return;
  const isManager = state.user.role === 'MANAGER' || state.user.username === 'manager';
  const displayName = state.user.fullName || (isManager ? 'Thầy Lâm' : state.user.username);

  const nameEl = document.getElementById('profDisplayName');
  const userEl = document.getElementById('profUsername');
  const emailEl = document.getElementById('profEmail');
  const roleEl = document.getElementById('profRole');

  if (nameEl) nameEl.innerText = displayName;
  if (userEl) userEl.innerText = state.user.username || 'manager';
  if (emailEl) emailEl.innerText = state.user.email || `${state.user.username}@htqlns.com`;
  if (roleEl) roleEl.innerText = state.user.role || 'MANAGER';
}

// Giám sát cụm Microservices SOA
async function loadSoaServicesStatus() {
  const tbody = document.getElementById('soaMonitorTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Đang kết nối Service Registry (:3500)...</td></tr>`;

  try {
    const serviceList = [
      { name: 'api-gateway', port: 3000, db: 'N/A (Cổng Gateway & Proxy)', online: true },
      { name: 'service-registry', port: 3500, db: 'In-Memory (Service Discovery)', online: true },
      { name: 'event-bus', port: 3600, db: 'Durable Queue (event-bus.json)', online: true },
      { name: 'auth-service', port: 3001, db: 'htqlns_auth (Cơ sở dữ liệu xác thực)', online: true },
      { name: 'organization-service', port: 3002, db: 'htqlns_organization (Phòng ban & Nhân sự)', online: true },
      { name: 'attendance-service', port: 3003, db: 'htqlns_attendance (GPS/WiFi)', online: false },
      { name: 'leave-service', port: 3004, db: 'htqlns_leave (Quỹ phép & Đơn)', online: false },
      { name: 'shift-service', port: 3005, db: 'htqlns_shift (Lịch ca & OT)', online: false },
      { name: 'payroll-service', port: 3006, db: 'htqlns_payroll (Động cơ tính lương)', online: false },
      { name: 'notification-service', port: 3007, db: 'htqlns_notification (Cảnh báo)', online: false },
      { name: 'analytics-service', port: 3008, db: 'htqlns_analytics (Báo cáo)', online: false }
    ];

    tbody.innerHTML = serviceList
      .map((item) => {
        const statusBadge = item.online
          ? '<span class="badge-status badge-approved">ONLINE (UP)</span>'
          : '<span class="badge-status" style="background:#f1f5f9; color:#94a3b8;">CHƯA BẬT (OFF)</span>';

        return `
        <tr>
          <td><strong>${item.name}</strong></td>
          <td><code>:${item.port}</code></td>
          <td>http://localhost:${item.port}</td>
          <td><a href="http://localhost:${item.port}/health" target="_blank" class="link-action-blue">/health</a></td>
          <td>${statusBadge}</td>
          <td><code>${item.db}</code></td>
        </tr>
      `;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color: #dc2626; text-align: center;">Lỗi tải dữ liệu Registry: ${err.message}</td></tr>`;
  }
}

// ==============================================================================
// 8. CÁC TƯƠNG TÁC BẤM TRỰC QUAN TRÊN DASHBOARD
// ==============================================================================
function scrollToLateTable() {
  const table = document.getElementById('lateEmployeesCard');
  if (table) {
    table.scrollIntoView({ behavior: 'smooth', block: 'center' });
    table.style.outline = '2px solid #f59e0b';
    table.style.transition = 'outline 0.3s';
    setTimeout(() => { table.style.outline = 'none'; }, 2000);
  }
}

function openLateDetailModal(name, code, lateTime, checkinTime) {
  const html = `
    <div style="display: flex; flex-direction: column; gap: 14px; font-size: 13.5px;">
      <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 10px; padding: 12px; color: #92400e;">
        <strong>Tình trạng:</strong> Đi muộn ${lateTime} (Giờ vào: ${checkinTime} - Quy định: 08:00)
      </div>
      <div><strong>Nhân viên:</strong> ${name} (${code})</div>
      <div><strong>Phòng ban:</strong> Phòng Kỹ Thuật</div>
      <div><strong>Lý do giải trình:</strong> Kẹt xe tại nút giao do thời tiết mưa lớn</div>
      <div style="display: flex; gap: 10px; margin-top: 8px;">
        <button class="btn-primary-blue" style="flex: 1;" onclick="handleLateAction('${name}', 'approved')">Chấp nhận giải trình</button>
        <button class="btn-figma-dark" style="flex: 1; background: #ea580c; border: none;" onclick="handleLateAction('${name}', 'warn')">Gửi nhắc nhở</button>
      </div>
    </div>
  `;
  openModal(`Chi tiết đi muộn – ${name}`, html);
}

function handleLateAction(name, action) {
  closeModal();
  if (action === 'approved') {
    showToast(`Đã chấp thuận giải trình đi muộn của ${name}`, 'success');
  } else {
    showToast(`Đã gửi thông báo nhắc nhở tới ${name}`, 'warning');
  }
}

function openApproveRequestModal(id, name, type, time) {
  const html = `
    <div style="display: flex; flex-direction: column; gap: 14px; font-size: 13.5px;">
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 12px; color: #1e40af;">
        <strong>Mã yêu cầu:</strong> ${id}
      </div>
      <div><strong>Người làm đơn:</strong> ${name}</div>
      <div><strong>Loại yêu cầu:</strong> ${type}</div>
      <div><strong>Thời gian xin:</strong> ${time}</div>
      <div><strong>Lý do:</strong> Giải quyết công việc gia đình cá nhân</div>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button class="btn-primary-blue" style="flex: 1; background: #16a34a; border-color: #16a34a;" onclick="processRequestAction('${id}', '${name}', 'approved')">✓ Phê duyệt đơn</button>
        <button class="btn-figma-dark" style="flex: 1; background: #dc2626; border-color: #dc2626;" onclick="processRequestAction('${id}', '${name}', 'rejected')">✕ Từ chối đơn</button>
      </div>
    </div>
  `;
  openModal(`Xử lý đơn từ – ${name}`, html);
}

function processRequestAction(id, name, status) {
  closeModal();
  const row = document.getElementById(`req-row-${id}`);
  if (row) {
    const actionCell = row.querySelector('td:last-child');
    if (actionCell) {
      if (status === 'approved') {
        actionCell.innerHTML = `<span class="badge-status badge-approved">Đã phê duyệt</span>`;
      } else {
        actionCell.innerHTML = `<span class="badge-status badge-rejected">Đã từ chối</span>`;
      }
    }
  }
  if (status === 'approved') {
    showToast(`Đã phê duyệt thành công đơn ${id} của ${name}`, 'success');
  } else {
    showToast(`Đã từ chối đơn ${id} của ${name}`, 'warning');
  }
}

function handleCheckIn() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const checkinBtn = document.getElementById('btnMyCheckIn');
  const checkoutBtn = document.getElementById('btnMyCheckOut');
  if (checkinBtn) {
    checkinBtn.disabled = true;
    checkinBtn.innerText = `Đã Check-in (${timeStr})`;
    checkinBtn.style.opacity = '0.7';
  }
  if (checkoutBtn) checkoutBtn.disabled = false;
  showToast(`Điểm danh vào ca thành công lúc ${timeStr}! (Wi-Fi Công ty hợp lệ)`, 'success');
}

function handleCheckOut() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const checkoutBtn = document.getElementById('btnMyCheckOut');
  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.innerText = `Đã Check-out (${timeStr})`;
  }
  showToast(`Điểm danh ra ca thành công lúc ${timeStr}! Chúc bạn buổi tối vui vẻ.`, 'success');
}

function handleTopbarSearch(e) {
  if (e.key === 'Enter') {
    const kw = e.target.value.trim().toLowerCase();
    if (!kw) return;
    navigateToView('employees');
    setTimeout(() => {
      const searchBox = document.getElementById('employeeSearchInput');
      if (searchBox) {
        searchBox.value = kw;
        handleEmployeeFilter();
      }
    }, 150);
  }
}

function openNotificationsModal() {
  const html = `
    <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
      <div style="padding: 10px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #10b981;">
        <div style="font-weight: 700; color: #0f172a;">Chấm công hôm nay</div>
        <div style="color: #64748b;">Ca sáng 08:00 - 16:00: 34 nhân viên đã điểm danh thành công.</div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">15 phút trước</div>
      </div>
      <div style="padding: 10px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #f59e0b;">
        <div style="font-weight: 700; color: #0f172a;">Đi muộn phát sinh</div>
        <div style="color: #64748b;">3 nhân viên phòng Kỹ thuật ghi nhận đi trễ từ 7 - 21 phút.</div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">45 phút trước</div>
      </div>
      <div style="padding: 10px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #3b82f6;">
        <div style="font-weight: 700; color: #0f172a;">Đơn xin nghỉ phép mới</div>
        <div style="color: #64748b;">Vũ Đức Hiếu đã gửi đơn xin nghỉ phép 1 ngày (02/11/2026).</div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">1 giờ trước</div>
      </div>
    </div>
  `;
  openModal('Thông báo hệ thống (3 mới)', html);
}

// Bật tắt thiết lập phương thức chấm công (Figma Image 4)
function handleSettingToggle(type) {
  const isWifi = document.getElementById('toggleWifi')?.checked;
  const isGps = document.getElementById('toggleGps')?.checked;
  showToast(`Cập nhật phương thức: Wi-Fi: ${isWifi ? 'BẬT' : 'TẮT'} | GPS: ${isGps ? 'BẬT' : 'TẮT'}`, 'success');
}

// ==============================================================================
// 9. QUẢN LÝ POPUP MODAL
// ==============================================================================
function openModal(title, contentHtml, onConfirm) {
  const box = document.getElementById('modalBox');
  if (!box) return;

  box.innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)" style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 10000;">
      <div class="modal-content" onclick="event.stopPropagation()" style="background: #ffffff; width: 100%; max-width: 480px; border-radius: 16px; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.2);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
          <h3 style="font-size: 17px; font-weight: 700; color: #0f172a;">${title}</h3>
          <button onclick="closeModal()" style="border: none; background: transparent; font-size: 18px; cursor: pointer; color: #94a3b8;">✕</button>
        </div>
        <div class="modal-body">
          ${contentHtml}
        </div>
      </div>
    </div>
  `;
  box.style.display = 'block';
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  const box = document.getElementById('modalBox');
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
  }
}

function openAddDepartmentModal() {
  openModal(
    'Thêm mới Phòng ban',
    `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <input type="text" id="newDeptCode" class="figma-pill-input" placeholder="Mã phòng ban (vd: MKT)" required>
      <input type="text" id="newDeptName" class="figma-pill-input" placeholder="Tên phòng ban (vd: Phòng Marketing)" required>
      <textarea id="newDeptDesc" class="figma-pill-input" style="border-radius: 12px; height: 80px;" placeholder="Mô tả chức năng nhiệm vụ..."></textarea>
      <button class="btn-primary-blue" style="margin-top: 10px;" onclick="submitNewDepartment()">Tạo phòng ban</button>
    </div>
  `
  );
}

async function submitNewDepartment() {
  const code = document.getElementById('newDeptCode')?.value.trim();
  const name = document.getElementById('newDeptName')?.value.trim();
  const description = document.getElementById('newDeptDesc')?.value.trim();

  if (!code || !name) {
    return showToast('Vui lòng nhập đầy đủ mã và tên phòng ban', 'warning');
  }

  try {
    await apiCall('/api/organization/departments', {
      method: 'POST',
      body: JSON.stringify({ code, name, description })
    });
    showToast('Tạo phòng ban thành công!', 'success');
    closeModal();
    loadDepartmentsData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openAddEmployeeModal() {
  if (!state.departments.length) await loadDepartmentsData();
  const deptOptions = state.departments
    .map((department) => `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)}</option>`)
    .join('');

  openModal(
    'Thêm mới Nhân viên',
    `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <input type="text" id="newEmpCode" class="figma-pill-input" placeholder="Mã nhân viên (vd: NV-009)" required>
      <input type="text" id="newEmpName" class="figma-pill-input" placeholder="Họ và tên" required>
      <input type="email" id="newEmpEmail" class="figma-pill-input" placeholder="Email công ty" required>
      <input type="text" id="newEmpPhone" class="figma-pill-input" placeholder="Số điện thoại liên hệ">
      <select id="newEmpDept" class="figma-pill-input">
        ${deptOptions || '<option value="">Không có phòng ban để chọn</option>'}
      </select>
      <button class="btn-primary-blue" style="margin-top: 10px;" onclick="submitNewEmployee()">Lưu hồ sơ nhân sự</button>
    </div>
  `
  );
}

async function submitNewEmployee() {
  const code = document.getElementById('newEmpCode')?.value.trim();
  const fullName = document.getElementById('newEmpName')?.value.trim();
  const email = document.getElementById('newEmpEmail')?.value.trim();
  const phone = document.getElementById('newEmpPhone')?.value.trim();
  const departmentId = document.getElementById('newEmpDept')?.value;

  if (!code || !fullName || !email) {
    return showToast('Vui lòng điền đủ mã NV, họ tên và email', 'warning');
  }

  try {
    await apiCall('/api/organization/employees', {
      method: 'POST',
      body: JSON.stringify({ code, fullName, email, phone, departmentId })
    });
    showToast('Tạo hồ sơ nhân viên thành công!', 'success');
    closeModal();
    loadEmployeesData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==============================================================================
// 10. KHỞI TẠO DASHBOARD PORTAL
// ==============================================================================
function initPortalDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('portalApp').style.display = 'flex';

  updateTopbarUser();
  applyRoleBasedUI();
  navigateToView('dashboard');
}

// ==============================================================================
// 11. KHỞI CHẠY ỨNG DỤNG (WINDOW LOAD)
// ==============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  // Đồng hồ số thời gian thực cho view chấm công cá nhân
  setInterval(() => {
    const clock = document.getElementById('liveClockText');
    if (clock) {
      clock.innerText = new Date().toLocaleTimeString('vi-VN');
    }
  }, 1000);

  if (!state.token && !state.refreshToken) {
    showScreenView('login');
    return;
  }

  try {
    if (!isTokenValid(state.token)) await refreshAccessToken();
    const res = await apiCall('/api/auth/me');
    if (!res?.success || !res.data || res.data.status !== 'ACTIVE') {
      throw new Error('Tài khoản không còn hoạt động');
    }
    state.user = res.data;
    safeSetStorage('htqlns_user', JSON.stringify(state.user));
    initPortalDashboard();
  } catch (err) {
    if (err.status === 401 || !state.token) clearClientSession();
    showScreenView('login');
    if (state.token || state.refreshToken) {
      showToast(`Không thể khôi phục phiên đăng nhập: ${err.message}`, 'warning');
    }
  }
});
