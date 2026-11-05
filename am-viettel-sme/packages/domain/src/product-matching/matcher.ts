import { CustomerSegment } from "../classification/customer-classifier.js";

export interface ProductMatchInput {
  segment: CustomerSegment;
  businessNeeds?: string[];
  fleetCount?: number;
  branchCount?: number;
  employeeCount?: number;
}

export interface ProductMatch {
  serviceId: string;
  serviceName: string;
  bundleAvailable: boolean;
  bundleName?: string;
  painPointsAddressed: string[];
  policyStatus: "CAN_XAC_NHAN_LAI" | "CURRENT_CONFIRMED";
  requiredConfirmations: string[];
}

export function matchProductsForCustomer(input: ProductMatchInput): ProductMatch[] {
  const matches: ProductMatch[] = [];

  switch (input.segment) {
    case CustomerSegment.NEW_ESTABLISHED: {
      matches.push({
        serviceId: "VIETTEL_CA",
        serviceName: "Chữ ký số doanh nghiệp Viettel CA",
        bundleAvailable: true,
        bundleName: "Combo Khởi tạo doanh nghiệp (Viettel CA + Sinvoice)",
        painPointsAddressed: [
          "Kê khai thuế điện tử ban đầu bắt buộc",
          "Ký nộp tờ khai hải quan và bảo hiểm xã hội",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận bảng giá và ưu đãi bundle hiện hành",
          "Kiểm tra yêu cầu hồ sơ đăng ký mới theo quy định",
        ],
      });

      matches.push({
        serviceId: "HOA_DON_DIEN_TU",
        serviceName: "Hóa đơn điện tử Sinvoice",
        bundleAvailable: true,
        bundleName: "Combo Khởi tạo doanh nghiệp (Viettel CA + Sinvoice)",
        painPointsAddressed: [
          "Phát hành hóa đơn điện tử hợp pháp cho khách hàng",
          "Tích hợp tự động với phần mềm kế toán",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận số lượng dải hóa đơn và biểu giá hiện hành",
        ],
      });

      matches.push({
        serviceId: "FTTH",
        serviceName: "Internet Cáp quang Doanh nghiệp FTTH",
        bundleAvailable: false,
        painPointsAddressed: [
          "Hạ tầng internet ổn định, băng thông quốc tế cam kết",
          "Wi-Fi phủ sóng cho văn phòng làm việc",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Kiểm tra hạ tầng kỹ thuật và vùng phủ tại địa chỉ văn phòng",
        ],
      });
      break;
    }

    case CustomerSegment.LOGISTICS_TRANSPORT: {
      matches.push({
        serviceId: "VTRACKING",
        serviceName: "Thiết bị giám sát hành trình vTracking",
        bundleAvailable: true,
        bundleName: "Combo Giám sát vận tải toàn diện (vTracking + Camera ND10)",
        painPointsAddressed: [
          "Theo dõi vị trí hành trình phương tiện theo thời gian thực",
          "Quản lý định mức tiêu hao nhiên liệu và cảnh báo quá tốc độ",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận danh mục thiết bị hợp chuẩn QCVN 31:2014/BGTVT",
          "Cập nhật biểu phí dịch vụ duy trì hàng năm",
        ],
      });

      matches.push({
        serviceId: "CAMERA_ND10",
        serviceName: "Camera giám sát theo Nghị định 10",
        bundleAvailable: true,
        bundleName: "Combo Giám sát vận tải toàn diện (vTracking + Camera ND10)",
        painPointsAddressed: [
          "Truyền dữ liệu hình ảnh trực tiếp lên Tổng cục Đường bộ",
          "Ghi nhận hình ảnh người lái xe và cửa lên xuống",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận chuẩn kết nối API truyền Tổng cục Đường bộ",
        ],
      });

      matches.push({
        serviceId: "M2M_IOT",
        serviceName: "SIM data M2M/IoT chuyên dụng",
        bundleAvailable: false,
        painPointsAddressed: [
          "Kết nối internet liên tục cho thiết bị hành trình",
          "Quản lý gói data tập trung qua portal",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận gói cước M2M doanh nghiệp và điều kiện đấu nối",
        ],
      });
      break;
    }

    case CustomerSegment.RETAIL_FNB: {
      matches.push({
        serviceId: "TENDOO",
        serviceName: "Phần mềm quản lý bán hàng Tendoo POS",
        bundleAvailable: true,
        bundleName: "Combo Bán hàng thông minh (Tendoo + Sinvoice)",
        painPointsAddressed: [
          "Quản lý order, bàn, menu và phân loại doanh thu",
          "Kiểm soát tồn kho và ca làm việc của nhân viên",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận chính sách cấp phép module và thiết bị tương thích",
        ],
      });

      matches.push({
        serviceId: "HOA_DON_DIEN_TU",
        serviceName: "Hóa đơn điện tử khởi tạo từ máy tính tiền",
        bundleAvailable: true,
        bundleName: "Combo Bán hàng thông minh (Tendoo + Sinvoice)",
        painPointsAddressed: [
          "Tuân thủ Nghị định 123 và Thông tư 78 về hóa đơn máy tính tiền",
          "In hóa đơn xuất trực tiếp tại quầy thanh toán",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận kết nối dữ liệu máy tính tiền với cơ quan thuế",
        ],
      });

      matches.push({
        serviceId: "FTTH",
        serviceName: "Internet Cáp quang SMB Wi-Fi Mesh",
        bundleAvailable: false,
        painPointsAddressed: [
          "Wi-Fi chịu tải cao cho lượng khách đông cùng lúc",
          "Đường truyền riêng cho máy POS và camera an ninh",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Kiểm tra hạ tầng và thiết bị modem/mesh tương thích",
        ],
      });
      break;
    }

    case CustomerSegment.PROFESSIONAL_SERVICES: {
      matches.push({
        serviceId: "EASYBOOKS",
        serviceName: "Phần mềm kế toán EasyBooks",
        bundleAvailable: true,
        bundleName: "Combo Kế toán số (EasyBooks + MySign)",
        painPointsAddressed: [
          "Tự động hóa sổ sách, báo cáo tài chính và kê khai thuế",
          "Hỗ trợ quản lý nhiều công ty đối với đại lý thuế",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận gói bản quyền theo số lượng MST quản lý",
        ],
      });

      matches.push({
        serviceId: "MYSIGN",
        serviceName: "Chữ ký số từ xa Cloud PKI MySign",
        bundleAvailable: true,
        bundleName: "Combo Kế toán số (EasyBooks + MySign)",
        painPointsAddressed: [
          "Ký số linh hoạt trên điện thoại, máy tính không cần USB Token",
          "Phân quyền ký duyệt chứng từ và hợp đồng đa người dùng",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận điều kiện cấp chứng thư số cá nhân và doanh nghiệp",
        ],
      });

      matches.push({
        serviceId: "VOICE_BRANDNAME",
        serviceName: "Cuộc gọi thương hiệu Voice Brandname",
        bundleAvailable: false,
        painPointsAddressed: [
          "Hiển thị tên công ty khi gọi tư vấn hoặc chăm sóc khách hàng",
          "Nâng cao tỷ lệ nhấc máy và uy tín thương hiệu",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận thủ tục đăng ký tên định danh theo Nghị định 91",
        ],
      });
      break;
    }

    case CustomerSegment.MANUFACTURING_DISTRIBUTION: {
      matches.push({
        serviceId: "DMS_4_0",
        serviceName: "Hệ thống quản lý kênh phân phối DMS 4.0",
        bundleAvailable: false,
        painPointsAddressed: [
          "Giám sát lộ trình viếng thăm điểm bán của đội ngũ sales",
          "Cập nhật đơn hàng và báo cáo tồn kho nhà phân phối realtime",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Khảo sát quy trình phân phối và xây dựng kế hoạch POC",
        ],
      });

      matches.push({
        serviceId: "OFFICE_1",
        serviceName: "Nền tảng quản trị doanh nghiệp hợp nhất 1Office",
        bundleAvailable: false,
        painPointsAddressed: [
          "Số hóa quy trình phê duyệt nội bộ, HRM và CRM",
          "Quản lý chấm công, tính lương và hợp đồng lao động",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận số lượng user và chi phí triển khai",
        ],
      });

      matches.push({
        serviceId: "VCONTRACT",
        serviceName: "Hợp đồng điện tử vContract",
        bundleAvailable: false,
        painPointsAddressed: [
          "Ký hợp đồng cung ứng và đại lý từ xa",
          "Lưu trữ và tra cứu hợp đồng có chứng thực Trục eContract",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận chính sách gói số lượng hợp đồng",
        ],
      });
      break;
    }

    case CustomerSegment.MICRO_INDIVIDUAL:
    default: {
      matches.push({
        serviceId: "VIETTEL_CA",
        serviceName: "Chữ ký số Viettel CA",
        bundleAvailable: true,
        bundleName: "Combo Hộ kinh doanh số",
        painPointsAddressed: [
          "Kê khai thuế định kỳ và ký hóa đơn điện tử",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận bảng giá hộ kinh doanh cá thể",
        ],
      });

      matches.push({
        serviceId: "HOA_DON_DIEN_TU",
        serviceName: "Hóa đơn điện tử Sinvoice",
        bundleAvailable: true,
        bundleName: "Combo Hộ kinh doanh số",
        painPointsAddressed: [
          "Xuất hóa đơn bán hàng cho khách hàng cá nhân và doanh nghiệp",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Xác nhận gói cước hóa đơn theo dải số lượng",
        ],
      });

      matches.push({
        serviceId: "FTTH",
        serviceName: "Internet Cáp quang FTTH",
        bundleAvailable: false,
        painPointsAddressed: [
          "Kết nối internet cho cơ sở kinh doanh",
        ],
        policyStatus: "CAN_XAC_NHAN_LAI",
        requiredConfirmations: [
          "Kiểm tra vùng phủ cáp quang tại địa chỉ cơ sở",
        ],
      });
      break;
    }
  }

  return matches;
}
