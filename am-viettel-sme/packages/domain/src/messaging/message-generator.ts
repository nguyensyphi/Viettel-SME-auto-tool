import {
  evaluateContactTaskEligibility,
  type ContactTaskEligibilityInput,
  type ContactTaskBlockReason,
} from "../contactability/policy.js";

export type OutreachChannel = "SMS" | "ZALO" | "EMAIL" | "CALL_SCRIPT";

export interface AmProfile {
  fullName: string;
  title: string;
  phoneNumber: string;
}

export interface OutreachMessageRequest {
  channel: OutreachChannel;
  businessName: string;
  contactName?: string;
  serviceOffering: string;
  amProfile: AmProfile;
  eligibilityInput: ContactTaskEligibilityInput;
}

export type OutreachMessageResult =
  | { allowed: true; messageText: string; channel: OutreachChannel }
  | { allowed: false; blockReason: ContactTaskBlockReason };

export function generateOutreachMessage(
  request: OutreachMessageRequest,
): OutreachMessageResult {
  // CRITICAL FAIL-CLOSED GATE: Check contactability eligibility before generating any text
  const eligibility = evaluateContactTaskEligibility(request.eligibilityInput);
  if (!eligibility.allowed) {
    return {
      allowed: false,
      blockReason: eligibility.reason,
    };
  }

  const contactGreeting = request.contactName ? request.contactName : "Quý Doanh nghiệp";
  const businessName = request.businessName.trim();
  const am = request.amProfile;

  let serviceDescription = "";
  switch (request.serviceOffering) {
    case "VIETTEL_CA":
      serviceDescription = "giải pháp Chữ ký số Viettel CA hỗ trợ kê khai thuế, hải quan và ký số điện tử";
      break;
    case "HOA_DON_DIEN_TU":
      serviceDescription = "giải pháp Hóa đơn điện tử Sinvoice và hóa đơn từ máy tính tiền";
      break;
    case "VTRACKING":
      serviceDescription = "thiết bị giám sát hành trình vTracking và camera Nghị định 10 cho phương tiện";
      break;
    case "FTTH":
      serviceDescription = "đường truyền Internet cáp quang doanh nghiệp FTTH băng thông cao";
      break;
    default:
      serviceDescription = "các giải pháp chuyển đổi số dành cho doanh nghiệp SME của Viettel";
      break;
  }

  let text = "";

  if (request.channel === "SMS") {
    // Concise SMS format with AM signature and mandatory opt-out syntax
    text = `Viettel kinh gui ${businessName}: Dong hanh cung doanh nghiep voi ${request.serviceOffering === "VIETTEL_CA" ? "Viettel CA" : "giai phap so Viettel"}. Chi tiet lien he AM ${am.fullName} - ${am.phoneNumber}. Tu choi quang cao, soan TC gui 1313.`;
  } else if (request.channel === "ZALO") {
    // Polite and professional Zalo message format
    text =
      `Kính gửi ${contactGreeting} - ${businessName},\n\n` +
      `Em là ${am.fullName} từ Viettel SME. Em xin phép gửi thông tin giới thiệu về ${serviceDescription} với chính sách ưu đãi hỗ trợ doanh nghiệp.\n\n` +
      `Nếu ${contactGreeting} đang có nhu cầu tư vấn hoặc demo giải pháp, em sẵn sàng hỗ trợ trực tiếp.\n\n` +
      `Trân trọng,\n` +
      `${am.fullName} - ${am.title}\n` +
      `Hotline/Zalo: ${am.phoneNumber}\n\n` +
      `---\n` +
      `(Nếu không có nhu cầu, ${contactGreeting} vui lòng nhắn 'Dừng' để hệ thống không tiếp tục gửi thông tin).`;
  } else if (request.channel === "EMAIL") {
    text =
      `Kính gửi: Ban Giám đốc và Phụ trách ${businessName},\n\n` +
      `Viettel xin trân trọng giới thiệu đến Quý Doanh nghiệp ${serviceDescription}.\n\n` +
      `Chúng tôi cam kết mang lại giải pháp công nghệ ổn định, tuân thủ quy định pháp luật với chi phí tối ưu nhất cho doanh nghiệp.\n\n` +
      `Để đặt lịch tư vấn và dùng thử, xin vui lòng liên hệ:\n` +
      `${am.fullName} - ${am.title}\n` +
      `Số điện thoại: ${am.phoneNumber}\n\n` +
      `Trân trọng cảm ơn Quý Khách hàng!\n\n` +
      `[Từ chối nhận email tiếp thị: Nhấn vào liên kết hủy đăng ký bên dưới]`;
  } else {
    // CALL_SCRIPT
    text =
      `[Lời thoại AM chào hỏi]: Kính chào ${contactGreeting} của đơn vị ${businessName}. ` +
      `Em là ${am.fullName}, chuyên viên khách hàng doanh nghiệp Viettel. ` +
      `Em gọi điện để hỗ trợ tư vấn ${serviceDescription} cho doanh nghiệp mình ạ.`;
  }

  return {
    allowed: true,
    messageText: text,
    channel: request.channel,
  };
}
