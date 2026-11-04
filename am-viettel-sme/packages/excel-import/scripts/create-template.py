from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

FIELDS = [
    "lead_id", "company_name", "contact_name", "phone", "email", "industry", "district",
    "source", "source_url", "lawful_contact_basis", "consent_status", "product_interest",
    "owner_am", "stage", "last_contact_at", "next_action_at", "notes",
]
SOURCE_TYPES = ["AM_ENTERED", "CUSTOMER_REQUEST", "REFERRAL", "WEB_SOURCE", "IMPORTED", "OTHER"]
CONTACT_BASES = [
    "UNKNOWN", "CUSTOMER_REQUEST", "EXISTING_RELATIONSHIP", "CONSENT_RECORDED", "OTHER_REVIEW_REQUIRED",
]
CONSENT_STATUSES = ["UNKNOWN", "REVIEW_REQUIRED", "ALLOWED_FOR_RECORDED_PURPOSE", "OPTED_OUT"]
FIELD_GUIDE = [
    ("lead_id", "Không bắt buộc", "Để trống với lead mới; hệ thống sẽ cấp ID ở bước import sau."),
    ("company_name", "Bắt buộc", "Tên doanh nghiệp; sẽ trim, gộp khoảng trắng và chuẩn hóa Unicode NFC; giữ tên hiển thị."),
    ("contact_name", "Không bắt buộc", "Tên đầu mối công việc; có thể để trống."),
    ("phone", "Không bắt buộc", "Nhập dạng văn bản: 0 + 9 chữ số hoặc +84 + 9 chữ số. Số quốc tế + khác cần review; số sai báo lỗi."),
    ("email", "Không bắt buộc", "Nhập email hợp lệ; hệ thống trim, giữ giá trị hiển thị và tạo key lowercase riêng để match."),
    ("industry", "Không bắt buộc", "Ngành do AM cung cấp; không tự suy đoán."),
    ("district", "Không bắt buộc", "Quận/huyện do AM cung cấp; không tự tra cứu."),
    ("source", "Không bắt buộc khi còn review", "Chỉ nhận enum trong danh sách thả xuống."),
    ("source_url", "Không bắt buộc", "URL nguồn; chưa truy cập tự động."),
    ("lawful_contact_basis", "Mặc định UNKNOWN", "Chọn enum phù hợp; nguồn công khai tự nó không phải căn cứ liên hệ."),
    ("consent_status", "Mặc định UNKNOWN", "Giá trị ALLOWED trong Excel không tự cấp quyền liên hệ; vẫn cần review/evidence."),
    ("product_interest", "Không bắt buộc", "Mã catalog hoặc nội dung để AM review; không tự tạo quy tắc sản phẩm."),
    ("owner_am", "Không bắt buộc", "Tài khoản AM sẽ được kiểm tra ở bước sau."),
    ("stage", "Bắt buộc PENDING_REVIEW", "Lead mới luôn bắt đầu ở PENDING_REVIEW; không nhập stage tiến trình khác."),
    ("last_contact_at", "Không bắt buộc", "Nếu có, dùng ISO 8601, ví dụ 2026-11-02T09:30:00+07:00."),
    ("next_action_at", "Không bắt buộc", "Nếu có, dùng ISO 8601; không tự tạo tác vụ gọi/gửi."),
    ("notes", "Không bắt buộc", "Không nhập dữ liệu định danh nhạy cảm hoặc nội dung không cần thiết."),
]
WIDTHS = [20, 32, 24, 18, 32, 20, 20, 22, 38, 30, 32, 28, 22, 22, 30, 30, 44]
NAVY, TEAL, PALE_BLUE, PALE_TEAL, WHITE, DARK, GRAY = (
    "17324D", "1A9B8A", "EAF2F8", "E6F5F2", "FFFFFF", "1F2937", "64748B",
)


def add_list_validation(sheet, column, values, title, prompt, error):
    validation = DataValidation(type="list", formula1=f'"{",".join(values)}"', allow_blank=True)
    validation.errorTitle = "Giá trị không hợp lệ"
    validation.error = error
    validation.promptTitle = title
    validation.prompt = prompt
    validation.showErrorMessage = True
    validation.showInputMessage = True
    validation.errorStyle = "stop"
    sheet.add_data_validation(validation)
    validation.add(f"{column}2:{column}1001")


def configure_print(sheet, print_area, fit_height):
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = fit_height
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins.left = 0.25
    sheet.page_margins.right = 0.25
    sheet.page_margins.top = 0.4
    sheet.page_margins.bottom = 0.4
    sheet.print_area = print_area


def main():
    output = Path(__file__).resolve().parents[1] / "templates" / "lead-import-template.xlsx"
    output.parent.mkdir(parents=True, exist_ok=True)
    workbook = Workbook()
    leads = workbook.active
    leads.title = "Leads"
    leads.sheet_view.showGridLines = False
    leads.sheet_view.zoomScale = 85
    leads.freeze_panes = "A2"
    leads.sheet_properties.tabColor = TEAL
    leads.auto_filter.ref = "A1:Q1"
    leads.row_dimensions[1].height = 42

    for column, (field, width) in enumerate(zip(FIELDS, WIDTHS, strict=True), start=1):
        cell = leads.cell(row=1, column=column, value=field)
        cell.font = Font(name="Aptos", size=10, bold=True, color=WHITE)
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        cell.border = Border(bottom=Side(style="medium", color=TEAL))
        leads.column_dimensions[cell.column_letter].width = width
        leads.column_dimensions[cell.column_letter].number_format = "@"

    add_list_validation(
        leads, "H", SOURCE_TYPES, "Nguồn lead",
        "Chọn enum phù hợp; nguồn còn có thể cần review.",
        "Hãy chọn một giá trị trong danh sách nguồn được phép.",
    )
    add_list_validation(
        leads, "J", CONTACT_BASES, "Căn cứ liên hệ",
        "Để trống sẽ mặc định UNKNOWN; nguồn công khai không tự cấp căn cứ liên hệ.",
        "Hãy chọn một giá trị trong danh sách căn cứ được phép.",
    )
    add_list_validation(
        leads, "K", CONSENT_STATUSES, "Trạng thái consent",
        "Để trống sẽ mặc định UNKNOWN; giá trị ALLOWED vẫn cần review/evidence.",
        "Hãy chọn một giá trị trong danh sách trạng thái được phép.",
    )
    add_list_validation(
        leads, "N", ["PENDING_REVIEW"], "Stage cho lead mới",
        "Lead mới luôn ở PENDING_REVIEW.",
        "Lead mới chỉ được nhập với stage PENDING_REVIEW hoặc để trống.",
    )
    configure_print(leads, "A1:Q1", 1)

    guide = workbook.create_sheet("HuongDan")
    guide.sheet_view.showGridLines = False
    guide.sheet_view.zoomScale = 90
    guide.sheet_properties.tabColor = NAVY
    guide.merge_cells("A1:C1")
    guide["A1"] = "HƯỚNG DẪN TEMPLATE IMPORT LEAD — P0.3b"
    guide["A1"].font = Font(name="Aptos Display", size=16, bold=True, color=WHITE)
    guide["A1"].fill = PatternFill("solid", fgColor=NAVY)
    guide["A1"].alignment = Alignment(vertical="center")
    guide.row_dimensions[1].height = 34
    guidance = [
        "Chỉ dùng dữ liệu tổng hợp hoặc danh sách đã được duyệt; workbook mẫu này không chứa dữ liệu khách hàng.",
        "Sheet Leads có đúng 17 header được hỗ trợ. Không đổi tên cột nếu muốn tự động map.",
        "company_name là bắt buộc. lead_id để trống với lead mới; package này chỉ map thành null, chưa sinh ID.",
        "Lead mới luôn PENDING_REVIEW. Consent và contactability mặc định UNKNOWN; không có thao tác liên hệ tự động.",
        "Không thêm CMND/CCCD, số hộ chiếu, ngày sinh, ngày cấp hoặc nơi cấp. Cột ngoài allow-list không được map; cột định danh cá nhân sẽ chặn file để review.",
        "company_name được chuẩn hóa NFC/gộp khoảng trắng. Phone VN nhận 0 + 9 chữ số, +84 + 9 chữ số hoặc prefix 84 đúng 11 chữ số; + quốc tế khác ở NEEDS_REVIEW, không tạo key dedupe.",
        "Email được trim/validate; key match viết thường, còn giá trị hiển thị giữ riêng. Phone/email preview/log phải mask; package chỉ cung cấp helper mask, chưa có UI/log preview.",
        "Ngày giờ (nếu có) nên dùng ISO 8601 có múi giờ. P0.3b chưa parse XLSX, dedupe/merge, lưu DB, consent/provenance end-to-end hoặc commit import.",
    ]
    for row, text in enumerate(guidance, start=3):
        guide.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
        cell = guide.cell(row=row, column=1, value=text)
        cell.font = Font(name="Aptos", size=10, color=DARK)
        cell.fill = PatternFill("solid", fgColor=PALE_BLUE if row % 2 else PALE_TEAL)
        cell.alignment = Alignment(vertical="top", wrap_text=True)
        guide.row_dimensions[row].height = 34 if row in (4, 7, 8, 9, 10) else 28

    table_header_row = 12
    for column, title in enumerate(["Field", "Bắt buộc / mặc định", "Mô tả và ranh giới"], start=1):
        cell = guide.cell(row=table_header_row, column=column, value=title)
        cell.font = Font(name="Aptos", size=10, bold=True, color=WHITE)
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    guide.row_dimensions[table_header_row].height = 30
    for row, values in enumerate(FIELD_GUIDE, start=table_header_row + 1):
        for column, value in enumerate(values, start=1):
            cell = guide.cell(row=row, column=column, value=value)
            cell.font = Font(name="Aptos", size=10, color=DARK if column == 1 else GRAY)
            cell.fill = PatternFill("solid", fgColor=PALE_BLUE if row % 2 else WHITE)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
        guide.row_dimensions[row].height = 34
    guide.column_dimensions["A"].width = 24
    guide.column_dimensions["B"].width = 26
    guide.column_dimensions["C"].width = 96
    guide.freeze_panes = "A13"
    configure_print(guide, f"A1:C{table_header_row + len(FIELD_GUIDE)}", 0)

    workbook.properties.title = "AM Viettel SME — Lead Import Template P0.3b"
    workbook.properties.subject = "17-field allow-list template; synthetic-free"
    workbook.properties.creator = "AM Viettel SME project"
    workbook.save(output)
    print(output)


if __name__ == "__main__":
    main()
