-- Local development seed only. All values are synthetic; no user account or contact route is provisioned.
INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'am-sme-local-synthetic',
  'AM SME Local Synthetic Workspace',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

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
  'Synthetic district',
  'Synthetic province',
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
