-- CreateTable
CREATE TABLE "teacher_allowlist" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "github_login" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_allowlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teacher_allowlist_github_login_key" ON "teacher_allowlist"("github_login");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_allowlist_email_key" ON "teacher_allowlist"("email");
