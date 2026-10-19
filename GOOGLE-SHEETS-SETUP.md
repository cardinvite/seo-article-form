# Triển khai ứng dụng quản lý bài SEO bằng Google Apps Script

Ứng dụng gồm màn hình đăng nhập Google, danh sách bài viết, form chuẩn SEO và các thao tác tạo, sửa, xóa. Dữ liệu được lưu trong tab `SEO Posts` của Google Sheet.

## 1. Tạo Google Sheet

1. Tạo một Google Sheet mới.
2. Lấy Spreadsheet ID trong URL:

   ```text
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
   ```

3. Chia sẻ quyền **Editor** của Sheet cho ba tài khoản quản trị:

   - `dannguyen22993@gmail.com`
   - `thanhdieuhr211@gmail.com`
   - `nguyenthienhoang0412000@gmail.com`

Không cần tạo cột thủ công. Hàm `setup()` sẽ tạo tab `SEO Posts`, tiêu đề cột và định dạng cơ bản.

## 2. Tạo project Apps Script

1. Trong Google Sheet, mở **Extensions → Apps Script**.
2. Thay nội dung file `Code.gs` bằng nội dung của [google-apps-script/Code.gs](google-apps-script/Code.gs).
3. Tạo file HTML mới tên chính xác là `Admin` rồi dán nội dung [google-apps-script/Admin.html](google-apps-script/Admin.html).
4. Trong `Code.gs`, thay:

   ```js
   SPREADSHEET_ID: 'PASTE_GOOGLE_SHEET_ID_HERE'
   ```

   bằng Spreadsheet ID ở bước 1.
5. Chọn hàm `setup`, bấm **Run** và chấp nhận quyền truy cập. Sau khi chạy thành công, Sheet sẽ có tab `SEO Posts`.

## 3. Deploy Web App có đăng nhập

1. Chọn **Deploy → New deployment**.
2. Chọn loại **Web app**.
3. Ở **Execute as**, chọn **User accessing the web app**.
4. Ở **Who has access**, chọn phạm vi yêu cầu đăng nhập Google phù hợp, thường là **Anyone with Google account**.
5. Bấm **Deploy** và sao chép URL kết thúc bằng `/exec`.

Mở URL `/exec` để sử dụng ứng dụng. Mỗi quản trị viên có thể phải chấp nhận quyền trong lần mở đầu tiên.

> Không chọn **Execute as: Me**. Ứng dụng dùng email của người đang truy cập để kiểm tra danh sách admin ở phía máy chủ. Ba tài khoản admin cũng cần quyền Editor đối với Google Sheet.

## 4. Cập nhật phiên bản

Sau khi sửa `Code.gs` hoặc `Admin.html`:

1. Mở **Deploy → Manage deployments**.
2. Chọn deployment hiện tại và bấm **Edit**.
3. Chọn **New version**.
4. Bấm **Deploy**.

URL `/exec` cũ vẫn được giữ nguyên.

## Quyền quản trị

Danh sách tài khoản được khai báo trong `ADMIN_EMAILS` của `Code.gs`. Việc đọc danh sách, xem chi tiết, lưu và xóa đều gọi `requireAdmin_()` trên máy chủ; sửa HTML phía trình duyệt không thể vượt qua kiểm tra này.

Nếu cần thêm tài khoản, hãy đồng thời:

1. Thêm email viết thường vào `ADMIN_EMAILS`.
2. Chia sẻ quyền Editor của Google Sheet cho email đó.
3. Deploy một phiên bản Apps Script mới.

## Ghi chú dữ liệu

- `submission_id` là mã duy nhất dùng để xác định dòng khi sửa hoặc xóa.
- `created_at` được giữ nguyên khi sửa; `updated_at` và `updated_by` được cập nhật mỗi lần lưu.
- Nội dung bắt đầu bằng `=`, `+`, `-` hoặc `@` được vô hiệu hóa để tránh công thức ngoài ý muốn trong Sheet.
- Ảnh được lưu dưới dạng URL. Ứng dụng chưa tải file ảnh nhị phân lên Google Drive.
- Trường mật khẩu bài viết được lưu trong Sheet nếu dùng chế độ bảo vệ bằng mật khẩu; chỉ nên chia sẻ Sheet cho đúng quản trị viên.
