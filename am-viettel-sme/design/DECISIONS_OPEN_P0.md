# Quyết định triển khai — P0 AM Viettel SME

Các yêu cầu đã chốt:

1. Kiến trúc local-first: modular monolith TypeScript + Next.js, NestJS + Prisma được chọn làm phương án cụ thể, PostgreSQL, Redis/BullMQ. CRM adapter chỉ là interface trong P0, chưa kết nối CRM thật.
2. Auth: không có đăng ký công khai; chỉ admin mời người dùng và phân quyền AM/Manager/Admin. Chỉ account đã được mời và kích hoạt mới đăng nhập. Không có endpoint self-signup.
3. Dữ liệu: chỉ lưu tối thiểu cần thiết; retention cấu hình được. Lead/contact opt-out phải bị chặn ngay và có audit log.
4. P0 chỉ local/staging, chỉ dữ liệu giả hoặc danh sách được phép thử nghiệm. Zalo không gửi tin thật; mọi tích hợp ngoài dùng mock/sandbox.
5. P0: Excel import, lead management, RBAC/audit và lịch công việc AM. Telegram bot tiếp tục để phase sau; API/task model được thiết kế để tái sử dụng.
6. Không commit workbook hay dữ liệu thật; không dùng cột CMND/CCCD, ngày/nơi cấp trong import, DB hoặc fixture. Nguồn/căn cứ/kênh được AM xác nhận trước khi tạo liên hệ.

Còn cần xác nhận trước khi pilot với người thật (không chặn coding local): địa bàn, tên AM, ưu tiên dịch vụ, giờ làm, nguồn lead được phép, KPI theo văn bản hiện hành, retention value mặc định được duyệt, người chịu trách nhiệm duyệt nguồn/căn cứ. Zalo mode/quyền OA chỉ cần trước giai đoạn tích hợp sau.

Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 có hiệu lực từ 01/01/2026. Cần pháp chế/đơn vị tuân thủ xác định nghĩa vụ xử lý cụ thể cho nguồn dữ liệu, mục đích và kênh liên hệ; tài liệu này không thay tư vấn pháp lý.
