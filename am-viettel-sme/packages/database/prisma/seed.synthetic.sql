-- Local development seed only. All values are synthetic; no real PII or contact route is provisioned.
INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'am-sme-local-synthetic',
  'Viettel AM SME Local Synthetic Workspace (Dĩ An - Bình Dương)',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

-- ============================================================================
-- MODULE 01: Customer Acquisition & Lead Workspace (MOD-CA-001)
-- ============================================================================
INSERT INTO "Lead" (
  "id",
  "workspaceId",
  "companyName",
  "normalizedCompanyName",
  "industry",
  "district",
  "province",
  "stage",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000011',
  workspace."id",
  'Cong ty Thu nghiem Alpha',
  'cong ty thu nghiem alpha',
  'Synthetic industry',
  'Dĩ An',
  'Bình Dương',
  'PENDING_REVIEW',
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LeadContact" (
  "id",
  "workspaceId",
  "leadId",
  "contactName",
  "contactType",
  "contactabilityStatus",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000021',
  workspace."id",
  lead."id",
  'Synthetic Work Contact',
  'BUSINESS_CONTACT',
  'UNKNOWN',
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
JOIN "Lead" AS lead ON lead."workspaceId" = workspace."id"
WHERE workspace."slug" = 'am-sme-local-synthetic'
  AND lead."id" = '00000000-0000-4000-8000-000000000011'
ON CONFLICT ("id") DO NOTHING;

-- ============================================================================
-- MODULE 02: Personal Branding & Content Library (MOD-PB-002)
-- ============================================================================
INSERT INTO "SocialAccount" (
  "id",
  "workspaceId",
  "accountCode",
  "platform",
  "displayName",
  "ownerUserId",
  "profileDir",
  "assignedTopics",
  "maxPostsPerDay",
  "minIntervalMinutes",
  "preferredWindows",
  "status",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000101',
  workspace."id",
  'zalo-dian-am01',
  'ZALO',
  'Zalo Lê Văn AM (Viettel Dĩ An)',
  'user-am',
  'storage/browser_profiles/zalo-dian-am01',
  ARRAY['CHU_KY_SO', 'HOA_DON_DIEN_TU']::TEXT[],
  2,
  180,
  ARRAY['08:00-10:00', '13:30-15:30']::TEXT[],
  'ACTIVE',
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "accountCode") DO NOTHING;

INSERT INTO "SocialAccount" (
  "id",
  "workspaceId",
  "accountCode",
  "platform",
  "displayName",
  "ownerUserId",
  "profileDir",
  "assignedTopics",
  "maxPostsPerDay",
  "minIntervalMinutes",
  "preferredWindows",
  "status",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000102',
  workspace."id",
  'fb-viettel-sme',
  'FACEBOOK',
  'Facebook Viettel SME Bình Dương',
  'user-am',
  'storage/browser_profiles/fb-viettel-sme',
  ARRAY['CHU_KY_SO', 'VCONTRACT', 'FTTH']::TEXT[],
  2,
  180,
  ARRAY['08:30-10:30', '14:00-16:00']::TEXT[],
  'ACTIVE',
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "accountCode") DO NOTHING;

INSERT INTO "ContentPost" (
  "id",
  "workspaceId",
  "postCode",
  "title",
  "body",
  "topicCode",
  "targetAudience",
  "platforms",
  "status",
  "priority",
  "hashtags",
  "version",
  "contentHash",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000201',
  workspace."id",
  'PB001',
  'Vì sao doanh nghiệp mới thành lập tại Dĩ An nên kích hoạt Chữ ký số Viettel-CA Cloud?',
  'Chữ ký số từ xa Viettel-CA Cloud giúp Giám đốc ký tờ khai thuế, hóa đơn điện tử và hợp đồng ngay trên điện thoại không cần USB Token.',
  'CHU_KY_SO',
  'BUSINESS_OWNER',
  ARRAY['ZALO', 'FACEBOOK']::TEXT[],
  'APPROVED',
  'HIGH',
  ARRAY['#ViettelCA', '#ChuKySo', '#DoanhNghiepMoi']::TEXT[],
  1,
  'synthetic_hash_pb001',
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "postCode") DO NOTHING;

INSERT INTO "ContentPost" (
  "id",
  "workspaceId",
  "postCode",
  "title",
  "body",
  "topicCode",
  "targetAudience",
  "platforms",
  "status",
  "priority",
  "hashtags",
  "version",
  "contentHash",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000202',
  workspace."id",
  'PB002',
  'Lưu ý khi phát hành Hóa đơn điện tử khởi tạo từ máy tính tiền S-Invoice 2026',
  'Giải pháp S-Invoice kết nối trực tiếp Tổng cục Thuế, tích hợp sẵn chữ ký số HSM tốc độ cao cho doanh nghiệp SME.',
  'HOA_DON_DIEN_TU',
  'BUSINESS_OWNER',
  ARRAY['ZALO', 'FACEBOOK']::TEXT[],
  'APPROVED',
  'NORMAL',
  ARRAY['#SInvoice', '#HoaDonDienTu', '#ViettelSME']::TEXT[],
  1,
  'synthetic_hash_pb002',
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "postCode") DO NOTHING;

INSERT INTO "MediaAsset" (
  "id",
  "workspaceId",
  "driveFileId",
  "fileName",
  "mimeType",
  "sizeBytes",
  "checksum",
  "topicCode",
  "postCodeHint",
  "platforms",
  "status",
  "version",
  "isSharedMedia",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000301',
  workspace."id",
  'drive-file-pb001-banner',
  'PB001_viettel_ca_cloud_banner.png',
  'image/png',
  245760,
  'sha256_pb001_banner',
  'CHU_KY_SO',
  'PB001',
  ARRAY['ZALO', 'FACEBOOK']::TEXT[],
  'APPROVED',
  1,
  false,
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "driveFileId") DO NOTHING;

-- ============================================================================
-- MODULE 03: Partner & Group Campaign Automation (MOD-PC-003)
-- ============================================================================
INSERT INTO "CommunityGroup" (
  "id",
  "workspaceId",
  "groupCode",
  "platform",
  "name",
  "url",
  "category",
  "postingPermission",
  "minHoursBetweenPosts",
  "active",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000401',
  workspace."id",
  'grp-ketoan-binhduong',
  'ZALO',
  'Hội Kế toán Thuế Bình Dương & Dĩ An',
  'https://zalo.me/g/ketoanbinhduong',
  'ACCOUNTING_TAX',
  'ALLOWED',
  24,
  true,
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "groupCode") DO NOTHING;

INSERT INTO "CommunityGroup" (
  "id",
  "workspaceId",
  "groupCode",
  "platform",
  "name",
  "url",
  "category",
  "postingPermission",
  "minHoursBetweenPosts",
  "active",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000402',
  workspace."id",
  'grp-doanhnhan-dian',
  'FACEBOOK',
  'Hội Doanh nhân Trẻ TP. Dĩ An',
  'https://facebook.com/groups/doanhnhandian',
  'BUSINESS_ASSOCIATION',
  'MODERATED_ALLOWED',
  24,
  true,
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "groupCode") DO NOTHING;

INSERT INTO "GroupCampaign" (
  "id",
  "workspaceId",
  "campaignCode",
  "name",
  "campaignType",
  "targetCategories",
  "contentTemplate",
  "mediaPaths",
  "status",
  "approvedByAmId",
  "approvedAt",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000501',
  workspace."id",
  'camp-ctv-ketoan-2026',
  'Chiến dịch Tuyển CTV Kế toán & Đại lý Thuế Bình Dương Q4/2026',
  'PARTNER_RECRUITMENT',
  ARRAY['ACCOUNTING_TAX', 'BUSINESS_ASSOCIATION']::TEXT[],
  'Viettel Bình Dương hợp tác CTV Kế toán triển khai combo Chữ ký số Viettel-CA & Hóa đơn điện tử S-Invoice cho DN mới thành lập.',
  ARRAY['storage/media/ctv-banner.png']::TEXT[],
  'APPROVED',
  'user-am',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "campaignCode") DO NOTHING;

INSERT INTO "PartnerLead" (
  "id",
  "workspaceId",
  "partnerCode",
  "fullName",
  "phoneMasked",
  "phoneHash",
  "profession",
  "stage",
  "sourceGroupId",
  "notes",
  "updatedByAmId",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000601',
  workspace."id",
  'ctv-ketoan-01',
  'Trần Thị Minh Châu (Đại lý Thuế Dĩ An)',
  '0918***432',
  'synthetic_sha256_phone_0918765432',
  'ACCOUNTANT',
  'ACTIVE_PARTNER',
  'grp-ketoan-binhduong',
  'Đầu mối dịch vụ kế toán KCN Sóng Thần',
  'user-am',
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "partnerCode") DO NOTHING;

INSERT INTO "PartnerReferral" (
  "id",
  "workspaceId",
  "referralCode",
  "partnerId",
  "companyName",
  "normalizedTaxCode",
  "productCodes",
  "status",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000701',
  workspace."id",
  'ref-seed-001',
  '00000000-0000-4000-8000-000000000601',
  'CÔNG TY TNHH CƠ KHÍ & CHẾ TẠO DĨ AN',
  '3702998811',
  ARRAY['CA', 'SINVOICE']::TEXT[],
  'CONVERTED',
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "referralCode") DO NOTHING;

INSERT INTO "PartnerConversion" (
  "id",
  "workspaceId",
  "conversionCode",
  "referralId",
  "partnerId",
  "contractRevenueVnd",
  "commissionRatePercent",
  "commissionAmountVnd",
  "commissionPolicyConfirmedByAmId",
  "policyReferenceNote",
  "payoutStatus",
  "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000801',
  workspace."id",
  'conv-seed-001',
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000601',
  4500000,
  10.0,
  450000,
  'user-am',
  'Chính sách CTV SME Q4/2026 đã phê duyệt',
  'APPROVED_PENDING_PAYOUT',
  CURRENT_TIMESTAMP
FROM "Workspace" AS workspace
WHERE workspace."slug" = 'am-sme-local-synthetic'
ON CONFLICT ("workspaceId", "conversionCode") DO NOTHING;
