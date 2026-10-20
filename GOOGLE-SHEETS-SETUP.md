# Triển khai ứng dụng quản lý bài SEO

Giao diện quản trị (`index.html`, `app.js`, `styles.css`, `config.js`) chạy trên GitHub Pages. Google Apps Script chỉ làm API, đọc/ghi tab `SEO Posts` của Google Sheet. Đăng nhập dùng nút **Sign in with Google** (Google Identity Services), giống repo `goldhome-edu-dangky`.

## Luồng đăng nhập

1. `index.html` hiển thị nút Google bằng `googleClientId` trong `config.js`.
2. Đăng nhập xong, trình duyệt nhận Google ID token và gửi `{action: 'login', idToken}` tới Web App `/exec`.
3. `Code.gs` xác minh token qua `oauth2.googleapis.com/tokeninfo`: đúng Client ID (`aud`), do Google phát hành (`iss`), email đã xác minh.
4. Email phải có trong tab `Users` và `active` khác `FALSE`. Máy chủ cấp phiên ký HMAC (`SESSION_SECRET`) hạn 24 giờ, lưu trong `localStorage`.
5. Mọi request sau gửi kèm phiên; máy chủ kiểm tra chữ ký, hạn và đọc lại tab `Users` mỗi lần, nên khóa tài khoản có hiệu lực ngay.

Admin **không cần quyền trên Google Sheet**: Web App chạy dưới tài khoản chủ sở hữu (Execute as: Me).

## 1. OAuth Client ID

Dùng chung Client ID với `goldhome-edu-dangky` (đã có trong `config.js`). Hai repo cùng chạy trên origin `https://cardinvite.github.io`, origin không tính đường dẫn, nên không cần sửa gì trong Google Cloud Console.

Chỉ khi chạy ở domain khác (custom domain, `http://localhost:...` để test) mới cần vào **Google Cloud Console → APIs & Services → Credentials → OAuth client** và thêm domain đó vào **Authorized JavaScript origins**.

## 2. Google Sheet và Apps Script

1. Tạo Google Sheet, lấy Spreadsheet ID trong URL `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit` và điền vào `CONFIG.SPREADSHEET_ID` của [Code.gs](google-apps-script/Code.gs).
2. Trong Sheet, mở **Extensions → Apps Script**, dán nội dung `Code.gs`. Bật **Project Settings → Show "appsscript.json"** rồi dán [appsscript.json](google-apps-script/appsscript.json).
3. **Project Settings → Script Properties → Add script property**: `GOOGLE_CLIENT_ID` = giá trị `googleClientId` trong `config.js`.
4. Chọn hàm `setup`, bấm **Run** và chấp nhận quyền (Sheets, gọi URL bên ngoài để xác minh token). Hàm này:
   - tạo tab `SEO Posts` với tiêu đề cột và định dạng;
   - tạo tab `Users` và thêm tài khoản đang chạy làm `ADMIN`;
   - tạo Script Property `SESSION_SECRET`.

## 3. Deploy Web App

1. **Deploy → New deployment → Web app**.
2. **Execute as: Me**, **Who has access: Anyone**.
3. Bấm **Deploy**, sao chép URL `/exec` và dán vào `appsScriptUrl` trong `config.js`, rồi push lên GitHub Pages.

> Deployment cũ dạng *User accessing the web app* không dùng được với cách đăng nhập này. Hãy tạo deployment mới như trên (hoặc sửa deployment cũ sang Execute as: Me) và cập nhật URL trong `config.js`.

`Who has access: Anyone` là bắt buộc để trình duyệt gọi được API từ GitHub Pages. Không ai đọc được dữ liệu nếu không có Google ID token hợp lệ của email trong tab `Users`.

## 4. Quản lý người dùng

Sửa trực tiếp tab `Users`, mỗi người một dòng:

| email | name | role | active |
|---|---|---|---|
| admin@gmail.com | Admin | ADMIN | TRUE |
| editor@gmail.com | Biên tập | EDITOR | TRUE |

- Email viết thường, đúng tài khoản Google người đó đăng nhập.
- `ADMIN`: xem, tạo, sửa, xóa bài. `EDITOR`: xem, tạo, sửa (không xóa).
- Đặt `active` = `FALSE` để khóa ngay, kể cả khi phiên còn hạn.
- Không cần deploy lại khi sửa tab `Users`.
- Muốn đăng xuất mọi người: xóa Script Property `SESSION_SECRET` rồi chạy lại `setup()`.

## 5. Cập nhật phiên bản

Sau khi sửa `Code.gs`: **Deploy → Manage deployments → Edit → New version → Deploy**. URL `/exec` giữ nguyên. Sửa `index.html`, `app.js`, `styles.css`, `config.js` chỉ cần push lên GitHub Pages.

## Bảo mật

- Phiên nằm trong `localStorage`. `index.html` có Content-Security-Policy chỉ cho chạy script từ chính trang và `accounts.google.com/gsi/client`, nên HTML trong nội dung bài viết không thể chạy script để đánh cắp phiên. Khi thêm thư viện ngoài, phải bổ sung nguồn đó vào CSP.
- Nội dung bài viết luôn được hiển thị bằng `textContent` hoặc qua `escapeHtml`; đếm từ dùng `DOMParser` (không tải ảnh, không chạy handler).
- Dùng máy chung thì bấm **Đăng xuất**.

## Ghi chú dữ liệu

- `submission_id` là mã duy nhất dùng để xác định dòng khi sửa hoặc xóa.
- Khi lưu, máy chủ so sánh `updated_at` lúc mở bài với giá trị hiện tại trong Sheet. Nếu người khác đã lưu hoặc xóa bài trong lúc đó, thao tác lưu bị từ chối để không ghi đè dữ liệu.
- `created_at` được giữ nguyên khi sửa; `updated_at` và `updated_by` được cập nhật mỗi lần lưu.
- Các cột văn bản được định dạng Plain text trước khi ghi để Sheet không tự đổi chuỗi thành số/ngày (ví dụ mật khẩu `0123`). Với Sheet đã có dữ liệu từ phiên bản cũ, chạy lại `setup()` một lần để áp định dạng cho toàn bộ cột.
- Nội dung bắt đầu bằng `=`, `+`, `-` hoặc `@` được vô hiệu hóa để tránh công thức ngoài ý muốn trong Sheet.
- Ảnh được lưu dưới dạng URL. Ứng dụng chưa tải file ảnh nhị phân lên Google Drive.
- Mật khẩu bài viết chỉ được lưu khi chọn chế độ hiển thị "Có mật khẩu".
