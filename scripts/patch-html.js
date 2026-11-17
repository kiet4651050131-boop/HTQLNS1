/**
 * scripts/patch-html.js
 * Tạo index.html tự chứa hoàn toàn (Self-Contained) với embedded CSS,
 * bảo vệ tuyệt đối không bao giờ bị vỡ giao diện kể cả khi mở file:// trực tiếp.
 */

const fs = require('fs');
const path = require('path');

const cssPath = path.resolve(__dirname, '..', 'public', 'css', 'style.css');
const htmlPath = path.resolve(__dirname, '..', 'public', 'index.html');

const css = fs.readFileSync(cssPath, 'utf8');
let html = fs.readFileSync(htmlPath, 'utf8');

// 1. Nhúng trực tiếp toàn bộ CSS vào trong <style> trong <head>
const styleBlock = `<link rel="stylesheet" href="css/style.css">
  <style>
${css}
  </style>`;

html = html.replace(/<link rel="stylesheet" href="css\/style\.css">(\s*<style>[\s\S]*?<\/style>)?/, styleBlock);

// 2. Đồng bộ câu chữ & placeholder chuẩn Figma Image 1 (Login Form)
html = html.replace('Sign in to your workplace account', 'Login with your details');
html = html.replace('placeholder="Username or Email"', 'placeholder="User name or Email"');

// 3. Cập nhật hàng Remember me & Forgot Password
const oldOptionsRow = /<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 12px; padding: 0 8px;">[\s\S]*?<\/div>/;
const newOptionsRow = `<div class="auth-options-row">
              <label class="remember-label">
                <input type="checkbox" id="loginRememberMe" checked> Remember me
              </label>
              <a href="javascript:void(0)" onclick="handleForgotPasswordClick()" class="forgot-link">Forgot Password</a>
            </div>`;
if (oldOptionsRow.test(html)) {
  html = html.replace(oldOptionsRow, newOptionsRow);
}

// 4. Cập nhật liên kết chuyển đổi Đăng ký / Đăng nhập
html = html.replace(
  /Don't have an account\? <a onclick="toggleAuthMode\('register'\)">.*?<\/a>/,
  `Don't have an account? <a onclick="toggleAuthMode('register')" style="color: #d84349; font-weight: 600; text-decoration: none; cursor: pointer;">Signup</a>`
);

html = html.replace(
  /Already have an account\? <a onclick="toggleAuthMode\('login'\)">.*?<\/a>/,
  `Already have an account? <a onclick="toggleAuthMode('login')" style="color: #d84349; font-weight: 600; text-decoration: none; cursor: pointer;">Login</a>`
);

// 5. Cố định kích thước ảnh bằng inline styles để không bao giờ phóng to bất thường
html = html.replace(
  /<img src="images\/logo\.png" alt="HTQLNS Logo"[^>]*>/,
  `<img src="images/logo.png" alt="HTQLNS Logo" class="figma-logo-img" style="width: 140px; max-width: 140px; height: auto; display: block; margin-bottom: 24px;">`
);

html = html.replace(
  /<img src="images\/logo\.png" alt="Logo"[^>]*>/,
  `<img src="images/logo.png" alt="Logo" class="sidebar-logo-img" style="width: 44px; max-width: 44px; height: auto; display: block; margin: 0 auto 10px;">`
);

// 6. Cố định kích thước Donut Chart SVG
html = html.replace(
  /<div class="donut-svg-wrap"[^>]*>/,
  `<div class="donut-svg-wrap" style="width: 130px; height: 130px; min-width: 130px; position: relative;">`
);

html = html.replace(
  /<svg viewBox="0 0 36 36"[^>]*>/,
  `<svg viewBox="0 0 36 36" style="width: 130px; height: 130px; transform: rotate(-90deg); display: block;">`
);

// 7. Thêm thanh Demo Switcher Bar trước </body> nếu chưa có
if (!html.includes('id="demoScreenBar"')) {
  const demoBarHtml = `
  <!-- ==========================================================================
       THANH ĐIỀU HƯỚNG DEMO WIREFRAME FIGMA (1-CLICK XEM TẤT CẢ MÀN HÌNH MẪU)
       ========================================================================== -->
  <div id="demoScreenBar" class="demo-screen-bar">
    <span class="demo-screen-label">Màn hình mẫu</span>
    <button type="button" class="btn-demo-view" id="btn-demo-login" onclick="showScreenView('login')">Đăng nhập</button>
    <button type="button" class="btn-demo-view" id="btn-demo-register" onclick="showScreenView('register')">Đăng ký</button>
    <button type="button" class="btn-demo-view active-demo" id="btn-demo-dashboard" onclick="showScreenView('dashboard')">Tổng quan</button>
    <button type="button" class="btn-demo-view" id="btn-demo-requests" onclick="showScreenView('requests')">Đơn từ</button>
    <button type="button" class="btn-demo-view" id="btn-demo-settings" onclick="showScreenView('settings')">Thiết lập</button>
    <button type="button" class="btn-demo-view" id="btn-demo-employees" onclick="showScreenView('employees')">Nhân viên</button>
    <button type="button" class="btn-demo-close" onclick="document.getElementById('demoScreenBar').style.display='none'" title="Ẩn thanh xem nhanh">Ẩn</button>
  </div>
`;
  html = html.replace('</body>', demoBarHtml + '\n</body>');
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('✅ Đã cập nhật public/index.html thành công! Dung lượng:', html.length, 'bytes');
