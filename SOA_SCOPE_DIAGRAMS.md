# Sơ đồ các chức năng được phân công

Phạm vi: đăng nhập, đăng ký, dashboard, đổi mật khẩu, phân quyền và thống kê/báo cáo.  
Các sơ đồ được đối chiếu với `auth-service`, `analytics-service`, API Gateway, giao diện web và schema CSDL hiện tại.

## 1. Use Case Diagram

![UML Use Case Diagram: HRMS - Hệ thống quản lý nhân sự](HRMS_USE_CASE_DIAGRAM.svg)

Sơ đồ tập trung vào đăng nhập, đổi mật khẩu và phân quyền tài khoản. Nhân sự và Quản trị viên được xem danh sách tài khoản; chỉ Quản trị viên được gán vai trò.

## 2. Class Diagram

```mermaid
classDiagram
    class User {
        +UUID id
        +UUID empId
        +string username
        +string email
        +string passwordHash
        +Role role
        +AccountStatus status
        +datetime lastLoginAt
    }

    class RefreshToken {
        +UUID id
        +UUID userId
        +string token
        +datetime expiresAt
        +datetime revokedAt
    }

    class Role {
        <<enumeration>>
        ADMIN
        HR
        MANAGER
        EMPLOYEE
    }

    class AccountStatus {
        <<enumeration>>
        ACTIVE
        INACTIVE
        LOCKED
    }

    class MetricType {
        <<enumeration>>
        LATE_COUNT_MONTH
        ABSENT_DAYS_MONTH
        OT_HOURS_MONTH
    }

    class Severity {
        <<enumeration>>
        INFO
        WARNING
        CRITICAL
    }

    class AuthService {
        +register(username, email, password)
        +login(username, password)
        +changePassword(userId, oldPassword, newPassword)
        +listUsers()
        +assignRole(actor, userId, role)
    }

    class ApiGateway {
        +verifyJwt(token)
        +authorizeRole(user, route)
        +forwardRequest(request)
    }

    class AnalyticsService {
        +getDashboard(month, year, managerId)
        +getAlertThresholds()
        -aggregateMonthlySummaries()
    }

    class Dashboard {
        +int month
        +int year
        +KPI kpis
        +LateEmployee[] lateEmployees
        +Alert[] alerts
    }

    class PersonalDashboard {
        <<view model>>
        +number workDays
        +number workHours
        +number remainingLeaveDays
        +number lateDays
        +number lateMinutes
        +number pendingRequests
    }

    class KPI {
        +number totalWorkDays
        +number totalOnTimeDays
        +number totalLateDays
        +number totalAbsentDays
        +number totalLateMinutes
        +number totalWorkingHours
        +number totalLeaveDays
        +number totalOtHours
        +number totalNetPayroll
        +number activeHeadcount
    }

    class LateEmployee {
        +UUID empId
        +number lateDays
        +number lateMinutes
    }

    class Alert {
        +string type
        +UUID empId
        +number value
        +string message
    }

    class AlertThreshold {
        +UUID id
        +string code
        +string name
        +MetricType metricType
        +number thresholdValue
        +Severity severity
        +boolean isActive
    }

    class AnalyticsSnapshot {
        +UUID id
        +int reportMonth
        +int reportYear
        +int totalEmployees
        +number onTimeRate
        +int totalLateInstances
        +number totalLeaveDays
        +number totalOtHours
        +number totalPayrollCost
        +datetime generatedAt
    }

    class AttendanceService
    class LeaveService
    class ShiftService
    class PayrollService
    class WebApp

    User --> Role
    User --> AccountStatus
    User "1" --> "0..*" RefreshToken : sở hữu
    AuthService ..> User : xác thực và quản lý
    AuthService ..> RefreshToken : cấp và thu hồi
    ApiGateway ..> AuthService : chuyển tiếp API Auth
    ApiGateway ..> AnalyticsService : chuyển tiếp API Analytics
    AnalyticsService ..> AttendanceService : tổng hợp chuyên cần
    AnalyticsService ..> LeaveService : tổng hợp nghỉ phép
    AnalyticsService ..> ShiftService : tổng hợp OT
    AnalyticsService ..> PayrollService : tổng hợp lương
    AnalyticsService ..> Dashboard : tạo kết quả
    WebApp ..> PersonalDashboard : tổng hợp dữ liệu cá nhân
    Dashboard *-- KPI
    Dashboard "1" o-- "0..*" LateEmployee
    Dashboard "1" o-- "0..*" Alert
    AnalyticsService ..> AlertThreshold : đọc cấu hình ngưỡng
    AlertThreshold --> MetricType
    AlertThreshold --> Severity
```

`AnalyticsSnapshot` có trong schema CSDL nhưng endpoint dashboard hiện tổng hợp dữ liệu trực tiếp từ các dịch vụ chấm công, nghỉ phép, OT và lương; chưa đọc/ghi snapshot.
`Dashboard.kpis.totalNetPayroll` có thể là `null` với vai trò `MANAGER`.

## 3. Sequence Diagram

### 3.1 Đăng ký, đăng nhập và đổi mật khẩu

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Web as Giao diện Web
    participant GW as API Gateway
    participant Auth as Auth Service
    participant DB as Auth Database

    alt Đăng ký
        User->>Web: Nhập username, email, mật khẩu
        Web->>GW: POST /api/auth/register
        GW->>Auth: Chuyển tiếp (không yêu cầu đăng nhập)
        Auth->>Auth: Kiểm tra dữ liệu, độ dài và trùng username/email
        Auth->>DB: Tạo user (role=EMPLOYEE, status=ACTIVE)
        DB-->>Auth: Tạo thành công
        Auth-->>GW: Thông tin tài khoản
        GW-->>Web: Đăng ký thành công
    else Đăng nhập
        User->>Web: Nhập username/email và mật khẩu
        Web->>GW: POST /api/auth/login
        GW->>Auth: Chuyển tiếp (không yêu cầu đăng nhập)
        Auth->>DB: Tìm tài khoản
        DB-->>Auth: User và password hash
        Auth->>Auth: Kiểm tra trạng thái ACTIVE và so khớp mật khẩu
        Auth->>DB: Lưu refresh token, cập nhật last_login_at
        Auth-->>GW: JWT, refresh token và thông tin user
        GW-->>Web: Trả kết quả đăng nhập
        Web->>Web: Lưu phiên và mở portal
    else Đổi mật khẩu
        User->>Web: Nhập mật khẩu cũ, mới và xác nhận
        Web->>GW: POST /api/auth/change-password + Bearer JWT
        GW->>GW: Xác thực JWT
        GW->>Auth: Chuyển tiếp yêu cầu đã xác thực
        Auth->>DB: Lấy tài khoản theo userId
        DB-->>Auth: User và password hash
        Auth->>Auth: Kiểm tra mật khẩu cũ và độ dài mật khẩu mới
        Auth->>DB: Cập nhật password hash, thu hồi refresh token
        Auth-->>GW: Đổi mật khẩu thành công
        GW-->>Web: Thành công
        Web->>Web: Xóa phiên cục bộ, yêu cầu đăng nhập lại
    end
```

### 3.2 Phân quyền tài khoản

```mermaid
sequenceDiagram
    actor Admin as ADMIN
    participant Web as Giao diện Web
    participant GW as API Gateway
    participant Auth as Auth Service
    participant DB as Auth Database

    Admin->>Web: Mở màn hình phân quyền
    Web->>GW: GET /api/auth/users + Bearer JWT
    GW->>GW: Xác thực JWT và kiểm tra route
    GW->>Auth: Chuyển tiếp yêu cầu
    Auth->>Auth: Kiểm tra quyền ADMIN hoặc HR
    Auth->>DB: Đọc danh sách tài khoản
    DB-->>Auth: Danh sách user và role
    Auth-->>Web: Danh sách tài khoản
    Admin->>Web: Chọn role mới và lưu
    Web->>GW: PUT /api/auth/users/{id}/role
    GW->>GW: Xác thực JWT; route cho ADMIN/HR
    GW->>Auth: Chuyển tiếp yêu cầu
    Auth->>Auth: Chỉ cho phép actor ADMIN, kiểm tra role hợp lệ
    alt Actor là ADMIN, role hợp lệ
        Auth->>DB: UPDATE users.role
        DB-->>Auth: Cập nhật thành công
        Auth-->>Web: Thành công
        Web->>Web: Hiển thị thông báo và tải lại danh sách
    else Không đủ quyền hoặc role không hợp lệ
        Auth-->>Web: Trả lỗi 403 hoặc 400
    end
```

### 3.3 Xem dashboard thống kê

```mermaid
sequenceDiagram
    actor User as ADMIN / HR / MANAGER
    participant Web as Giao diện Web
    participant GW as API Gateway
    participant Analytics as Analytics Service
    participant Attendance as Attendance Service
    participant Leave as Leave Service
    participant Shift as Shift Service
    participant Payroll as Payroll Service

    User->>Web: Mở dashboard, chọn tháng/năm
    Web->>GW: GET /api/analytics/dashboard?month&year + Bearer JWT
    GW->>GW: Xác thực JWT, kiểm tra role
    GW->>Analytics: Chuyển tiếp yêu cầu
    Analytics->>Analytics: Kiểm tra role và kỳ thống kê
    opt Người dùng là MANAGER
        Analytics->>Analytics: Lấy empId làm phạm vi quản lý
    end
    par Lấy chuyên cần
        Analytics->>Attendance: GET /internal/attendances/monthly-summary
        Attendance-->>Analytics: Tổng hợp chuyên cần
    and Lấy nghỉ phép
        Analytics->>Leave: GET /internal/leaves/monthly-summary
        Leave-->>Analytics: Tổng hợp ngày nghỉ
    and Lấy OT
        Analytics->>Shift: GET /internal/ot/summary
        Shift-->>Analytics: Tổng hợp giờ OT
    and Lấy lương
        Analytics->>Payroll: GET /internal/payrolls/summary
        Payroll-->>Analytics: Tổng hợp lương và số nhân sự
    end
    Analytics->>Analytics: Tính KPI, nhân sự đi muộn và cảnh báo OT trên 40 giờ
    Note over Analytics: totalNetPayroll chỉ được trả cho ADMIN và HR
    Analytics-->>GW: Dashboard theo kỳ đã chọn
    GW-->>Web: Dữ liệu thống kê
    Web-->>User: Hiển thị KPI, biểu đồ và cảnh báo
```

## 4. Activity Diagram

```mermaid
flowchart TD
    Start((Bắt đầu)) --> Choose{Chọn thao tác}

    Choose -->|Đăng ký| RegInput[Nhập username, email, mật khẩu]
    RegInput --> RegValid{Đủ dữ liệu và hợp lệ?}
    RegValid -->|Không| RegError[Hiển thị lỗi đăng ký]
    RegError --> Choose
    RegValid -->|Có| CheckDup{Username/email đã tồn tại?}
    CheckDup -->|Có| RegError
    CheckDup -->|Không| CreateUser[Tạo tài khoản ACTIVE, vai trò EMPLOYEE]
    CreateUser --> LoginPage[Chuyển về đăng nhập]
    LoginPage --> Choose

    Choose -->|Đăng nhập| LoginInput[Nhập thông tin đăng nhập]
    LoginInput --> LoginValid{Tài khoản ACTIVE và mật khẩu đúng?}
    LoginValid -->|Không| LoginError[Hiển thị lỗi đăng nhập]
    LoginError --> Choose
    LoginValid -->|Có| CreateSession[Cấp JWT và refresh token]
    CreateSession --> Dashboard[Hiển thị portal/dashboard]
    Dashboard --> Action{Chọn chức năng}

    Action -->|Đổi mật khẩu| ChangeInput[Nhập mật khẩu cũ, mật khẩu mới, xác nhận]
    ChangeInput --> ChangeValid{Mật khẩu cũ đúng, mật khẩu mới >= 6 ký tự và xác nhận khớp?}
    ChangeValid -->|Không| ChangeError[Hiển thị lỗi đổi mật khẩu]
    ChangeError --> Dashboard
    ChangeValid -->|Có| SavePassword[Cập nhật mật khẩu hash, thu hồi refresh token]
    SavePassword --> ClearSession[Xóa phiên trên giao diện]
    ClearSession --> Choose

    Action -->|Phân quyền| AdminCheck{Actor là ADMIN?}
    AdminCheck -->|Không| DenyRole[Từ chối 403]
    DenyRole --> Dashboard
    AdminCheck -->|Có| SelectRole[Chọn user và role hợp lệ]
    SelectRole --> UpdateRole[Cập nhật users.role]
    UpdateRole --> Dashboard

    Action -->|Xem dashboard cá nhân| PersonalData[Lấy chấm công, quỹ phép, đơn nghỉ và OT đang chờ]
    PersonalData --> RenderPersonal[Hiển thị KPI cá nhân]
    RenderPersonal --> Dashboard

    Action -->|Xem thống kê/báo cáo| AnalyticsRole{ADMIN, HR hoặc MANAGER?}
    AnalyticsRole -->|Không| DenyAnalytics[Từ chối truy cập]
    DenyAnalytics --> Dashboard
    AnalyticsRole -->|Có| SelectPeriod[Chọn tháng/năm]
    SelectPeriod --> ValidPeriod{Tháng/năm hợp lệ?}
    ValidPeriod -->|Không| PeriodError[Hiển thị lỗi kỳ thống kê]
    PeriodError --> SelectPeriod
    ValidPeriod -->|Có| FetchSummaries[Lấy tổng hợp chấm công, nghỉ phép, OT và lương]
    FetchSummaries --> ManagerScope{Vai trò MANAGER?}
    ManagerScope -->|Có| LimitScope[Giới hạn dữ liệu theo nhân viên trực thuộc]
    ManagerScope -->|Không| Aggregate[Tổng hợp KPI, nhân sự đi muộn và cảnh báo]
    LimitScope --> Aggregate
    Aggregate --> PayrollVisibility{ADMIN hoặc HR?}
    PayrollVisibility -->|Có| IncludePayroll[Hiển thị tổng quỹ lương]
    PayrollVisibility -->|Không| HidePayroll[Không trả tổng quỹ lương]
    IncludePayroll --> ShowReport[Hiển thị dashboard/báo cáo]
    HidePayroll --> ShowReport
    ShowReport --> Dashboard

    Action -->|Đăng xuất / kết thúc| End((Kết thúc))
```

## Nguồn đối chiếu trong dự án

- `services/auth-service/index.js`: đăng ký, đăng nhập, đổi mật khẩu, danh sách tài khoản và cập nhật vai trò.
- `services/analytics-service/index.js`: quyền truy cập dashboard/ngưỡng cảnh báo, tổng hợp KPI và các dịch vụ nguồn.
- `gateway/server.js` và `config/policies.json`: xác thực JWT, quyền theo route và chuyển tiếp API.
- `database/01_auth_db.sql` và `database/08_analytics_db.sql`: mô hình tài khoản, refresh token và schema analytics.
- `public/js/app.js` và `public/index.html`: các form/màn hình và hành vi giao diện tương ứng.
