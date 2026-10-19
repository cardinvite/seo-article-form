# Gold Home SEO Content

Ứng dụng quản lý bài viết chuẩn SEO cho `goldhomecons.vn`, dùng Google Apps Script làm Web App và Google Sheet làm nơi lưu dữ liệu.

## Chức năng

- Đăng nhập bằng tài khoản Google và kiểm tra danh sách admin ở máy chủ.
- Màn hình danh sách, tìm kiếm và lọc trạng thái bài viết.
- Tạo, sửa và xóa bài viết trong Google Sheet.
- Form nội dung, danh mục, ảnh đại diện, Rank Math, social card và thiết lập xuất bản.
- Tính điểm SEO trực tiếp theo 13 tiêu chí on-page, hiển thị từng mục đạt/chưa đạt, số từ và mật độ từ khóa ngay khi nhập.

## Triển khai ứng dụng thật

Thực hiện theo [GOOGLE-SHEETS-SETUP.md](GOOGLE-SHEETS-SETUP.md). Hai file cần đưa vào project Apps Script là:

- [Code.gs](google-apps-script/Code.gs)
- [Admin.html](google-apps-script/Admin.html)

## GitHub Pages

`index.html` không còn chứa form công khai. Trang này chỉ là cổng đăng nhập và tự động chuyển người dùng đến Apps Script Web App được cấu hình trong `config.js`.

- Người chưa đăng nhập sẽ được Google yêu cầu đăng nhập theo cấu hình deployment.
- Người đã đăng nhập nhưng không thuộc `ADMIN_EMAILS` sẽ bị `Code.gs` từ chối.
- Các thao tác xem, tạo, sửa và xóa đều kiểm tra lại quyền ở máy chủ.
- `Code.gs` cũng đối chiếu Active User với Effective User và từ chối nếu Web App bị deploy nhầm dưới tài khoản chủ sở hữu.

Luồng xác thực: `index.html` → Google Account Chooser → `doGet()` kiểm tra admin → dashboard → API CRUD kiểm tra admin lần nữa.

`styles.css` và `app.js` được giữ lại làm mã tham khảo của prototype cũ nhưng không còn được tải bởi `index.html`.

## Các nhóm dữ liệu chính

- Nội dung: tiêu đề, slug, nội dung HTML và đoạn trích.
- Media/taxonomy: ảnh đại diện, alt text, danh mục chính, danh mục và thẻ.
- Rank Math: focus keyword, SEO title, meta description, canonical, robots, schema và pillar content.
- Social: Open Graph/Facebook và X/Twitter card.
- Xuất bản: trạng thái, lịch đăng, tác giả, hiển thị, bình luận và pingback.

Các trường nonce, ID phiên, ID bài viết, cấu hình giao diện, LiteSpeed và dữ liệu nội bộ của plugin không được đưa vào vì chúng phải do WordPress tạo ở phía máy chủ. Phiên bản hiện tại quản lý nội dung trong Google Sheet và chưa tự động đăng bài lên WordPress.
