-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "relatedPatientId" INTEGER;

-- CreateIndex
CREATE INDEX "notifications_userId_relatedPatientId_idx" ON "notifications"("userId", "relatedPatientId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_relatedPatientId_fkey" FOREIGN KEY ("relatedPatientId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
