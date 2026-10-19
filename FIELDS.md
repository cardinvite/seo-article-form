# Danh sách input cho form viết bài chuẩn SEO

## 1. Cần thiết để tạo bài viết

| Nhãn | `name` đề xuất | Loại input | Ghi chú |
|---|---|---|---|
| Tiêu đề bài viết | `post_title` | text | Bắt buộc |
| Slug | `post_name` | text | Tự tạo từ tiêu đề, cho phép sửa |
| Nội dung | `content` | textarea/editor HTML | Bắt buộc |
| Mô tả ngắn | `post_excerpt` | textarea | Dùng trên trang danh sách và làm mô tả dự phòng |
| Danh mục | `post_category[]` | checkbox | Cho phép chọn nhiều |
| Danh mục chính | `rank_math_primary_category` | select | Dùng cho breadcrumb/SEO |
| Thẻ | `tax_input[post_tag]` | text/tags | Phân cách bằng dấu phẩy |
| Ảnh đại diện | `featured_image` hoặc `featured_image_url` | file/url | Nên có |
| Alt ảnh | `featured_image_alt` | text | Quan trọng cho SEO ảnh và accessibility |

## 2. Cần thiết cho SEO on-page

| Nhãn | `name` đề xuất | Loại input | Ghi chú |
|---|---|---|---|
| Từ khóa chính | `rank_math_focus_keyword` | text/tags | Bắt buộc trong mô phỏng |
| Tiêu đề SEO | `rank_math_title` | text | Khoảng 30–60 ký tự |
| Mô tả SEO | `rank_math_description` | textarea | Khoảng 120–160 ký tự |
| Canonical URL | `rank_math_canonical_url` | url | Để trống nếu URL hiện tại là bản chính |
| Robots Meta | `rank_math_robots[]` | checkbox/toggle | `index`, `follow`, `noindex`, `nofollow`, `noarchive`, `nosnippet` |
| Schema | `rank_math_schema_type` | select | Mặc định `BlogPosting` |
| Nội dung trụ cột | `rank_math_pillar_content` | checkbox | Tùy chọn |

## 3. Mạng xã hội

| Nhãn | `name` đề xuất |
|---|---|
| Facebook title | `rank_math_facebook_title` |
| Facebook description | `rank_math_facebook_description` |
| Facebook image | `rank_math_facebook_image` |
| Twitter card type | `rank_math_twitter_card_type` |
| Dùng dữ liệu Facebook | `rank_math_twitter_use_facebook` |
| Twitter title/description/image | `rank_math_twitter_title`, `rank_math_twitter_description`, `rank_math_twitter_image` |

## 4. Xuất bản

| Nhãn | `name` đề xuất |
|---|---|
| Trạng thái | `post_status` |
| Ngày giờ đăng | `publish_at` |
| Tác giả | `post_author` |
| Hiển thị | `visibility` |
| Mật khẩu | `post_password` |
| Ghim bài | `sticky` |
| Bình luận | `comment_status` |
| Pingback/trackback | `ping_status` |

## 5. Không nên đưa vào form mô phỏng

- `_wpnonce`, `_wp_http_referer`, `samplepermalinknonce`.
- `post_ID`, `user_ID`, `meta-box-order-nonce`, `closedpostboxesnonce`.
- Trạng thái UI như metabox đóng/mở, số cột hoặc tab đang chọn.
- Dữ liệu LiteSpeed Cache, khóa API, token phiên và cấu hình plugin nội bộ.

Các giá trị này phải được WordPress hoặc máy chủ sinh ở thời điểm gửi dữ liệu; sao chép từ HTML snapshot vừa không cần thiết vừa không an toàn.
