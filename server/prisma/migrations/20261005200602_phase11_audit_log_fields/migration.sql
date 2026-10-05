-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "details" JSONB,
ADD COLUMN     "subjectPatientId" INTEGER;

-- CreateIndex
CREATE INDEX "audit_logs_subjectPatientId_timestamp_idx" ON "audit_logs"("subjectPatientId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_userId_timestamp_idx" ON "audit_logs"("userId", "timestamp");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_subjectPatientId_fkey" FOREIGN KEY ("subjectPatientId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
