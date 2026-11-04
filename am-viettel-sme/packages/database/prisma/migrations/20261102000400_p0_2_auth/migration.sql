CREATE TABLE "UserPasswordCredential" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "passwordHash" VARCHAR(512) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UserPasswordCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthSession_expiry_after_creation_check" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "UserPasswordCredential_workspaceId_id_key"
    ON "UserPasswordCredential"("workspaceId", "id");
CREATE UNIQUE INDEX "UserPasswordCredential_workspaceId_userId_key"
    ON "UserPasswordCredential"("workspaceId", "userId");
CREATE UNIQUE INDEX "AuthSession_workspaceId_id_key"
    ON "AuthSession"("workspaceId", "id");
CREATE UNIQUE INDEX "AuthSession_tokenHash_key"
    ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_workspaceId_userId_expiresAt_idx"
    ON "AuthSession"("workspaceId", "userId", "expiresAt");
CREATE INDEX "AuthSession_workspaceId_revokedAt_expiresAt_idx"
    ON "AuthSession"("workspaceId", "revokedAt", "expiresAt");

ALTER TABLE "UserPasswordCredential"
    ADD CONSTRAINT "UserPasswordCredential_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserPasswordCredential"
    ADD CONSTRAINT "UserPasswordCredential_workspaceId_userId_fkey"
    FOREIGN KEY ("workspaceId", "userId") REFERENCES "User"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthSession"
    ADD CONSTRAINT "AuthSession_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthSession"
    ADD CONSTRAINT "AuthSession_workspaceId_userId_fkey"
    FOREIGN KEY ("workspaceId", "userId") REFERENCES "User"("workspaceId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User"
    ADD CONSTRAINT "User_invitationTokenHash_sha256_check"
    CHECK ("invitationTokenHash" IS NULL OR "invitationTokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "UserPasswordCredential"
    ADD CONSTRAINT "UserPasswordCredential_argon2id_hash_check"
    CHECK ("passwordHash" LIKE '$argon2id$%');
ALTER TABLE "AuthSession"
    ADD CONSTRAINT "AuthSession_tokenHash_sha256_check"
    CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
