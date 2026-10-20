# Gold Home SEO Content

Ứng dụng quản lý bài viết chuẩn SEO cho `goldhomecons.vn`, giao diện chạy trên GitHub Pages, Google Apps Script làm API và Google Sheet làm nơi lưu dữ liệu.

## Chức năng

- Đăng nhập bằng nút Sign in with Google; máy chủ xác minh token và kiểm tra tab `Users` (ADMIN/EDITOR) ở mọi thao tác.
- Màn hình danh sách, tìm kiếm và lọc trạng thái bài viết.
- Tạo, sửa và xóa bài viết trong Google Sheet.
- Form nội dung, danh mục, ảnh đại diện, Rank Math, social card và thiết lập xuất bản.
- Tính điểm SEO trực tiếp theo 13 tiêu chí on-page; mục chưa đạt có gợi ý sửa và bấm vào để nhảy tới ô cần sửa. Hiển thị số từ, mật độ từ khóa và xem trước kết quả Google (máy tính/di động).
- Thanh công cụ HTML (H2, H3, đoạn văn, đậm, nghiêng, danh sách, liên kết, ảnh); phím tắt `Ctrl+S` để lưu, `Ctrl+B`/`Ctrl+I`/`Ctrl+K` trong ô nội dung.
- Cảnh báo khi rời trình soạn thảo hoặc đóng tab mà chưa lưu.
- Danh sách sắp xếp theo điểm SEO hoặc ngày cập nhật; mở lại trang hiện ngay dữ liệu lần trước rồi cập nhật ngầm.

## Cấu trúc

- `index.html`, `app.js`, `styles.css`: giao diện quản trị chạy trên GitHub Pages.
- `config.js`: URL Web App `/exec` và OAuth Client ID (dùng chung với `goldhome-edu-dangky`).
- [google-apps-script/Code.gs](google-apps-script/Code.gs), [appsscript.json](google-apps-script/appsscript.json): API trên Apps Script.

## Triển khai

Thực hiện theo [GOOGLE-SHEETS-SETUP.md](GOOGLE-SHEETS-SETUP.md).

Luồng xác thực: nút Google trên `index.html` → Google ID token → `doPost` action `login` xác minh token và tab `Users` → cấp phiên HMAC 24 giờ → các action `list/get/save/delete` kiểm tra phiên và tab `Users` lần nữa.

## Các nhóm dữ liệu chính

- Nội dung: tiêu đề, slug, nội dung HTML và đoạn trích.
- Media/taxonomy: ảnh đại diện, alt text, danh mục chính, danh mục và thẻ.
- Rank Math: focus keyword, SEO title, meta description, canonical, robots, schema và pillar content.
- Social: Open Graph/Facebook và X/Twitter card.
- Xuất bản: trạng thái, lịch đăng, tác giả, hiển thị, bình luận và pingback.

Các trường nonce, ID phiên, ID bài viết, cấu hình giao diện, LiteSpeed và dữ liệu nội bộ của plugin không được đưa vào vì chúng phải do WordPress tạo ở phía máy chủ. Phiên bản hiện tại quản lý nội dung trong Google Sheet và chưa tự động đăng bài lên WordPress.
