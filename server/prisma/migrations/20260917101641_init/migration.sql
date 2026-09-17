-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('local', 'google');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('view_only', 'full_access', 'alerts_only');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('pending', 'active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "ProposedRole" AS ENUM ('patient', 'caregiver');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('sent', 'accepted', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "DoctorSource" AS ENUM ('ocr_scan', 'manual');

-- CreateEnum
CREATE TYPE "MedicineForm" AS ENUM ('tablet', 'capsule', 'syrup', 'liquid', 'injection', 'ointment', 'cream', 'drops', 'inhaler', 'patch', 'powder', 'spray', 'other');

-- CreateEnum
CREATE TYPE "TrackingType" AS ENUM ('countable', 'volume_ml', 'weight_grams');

-- CreateEnum
CREATE TYPE "MedicationStatus" AS ENUM ('active', 'completed', 'discontinued');

-- CreateEnum
CREATE TYPE "AddedVia" AS ENUM ('manual', 'ocr_scan');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('processing', 'completed', 'failed', 'needs_review');

-- CreateEnum
CREATE TYPE "DoseStatus" AS ENUM ('pending', 'taken', 'skipped', 'snoozed', 'missed');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('reminder', 'refill', 'escalation', 'weekly_summary', 'system');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'push', 'sms', 'in_app');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('sent', 'delivered', 'failed', 'read');

-- CreateEnum
CREATE TYPE "EscalationResolutionStatus" AS ENUM ('open', 'resolved', 'ignored');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "ReportSentStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('user', 'ai');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('adherence_pattern', 'schedule_suggestion');

-- CreateEnum
CREATE TYPE "SeverityLevel" AS ENUM ('mild', 'moderate', 'severe');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('light', 'dark');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "passwordHash" TEXT,
    "authProvider" "AuthProvider" NOT NULL DEFAULT 'local',
    "googleId" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "profilePictureUrl" TEXT,
    "address" TEXT,
    "timezone" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_patient_links" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "caregiverId" INTEGER NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "permissionLevel" "PermissionLevel" NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'pending',
    "invitedByUserId" INTEGER,
    "linkedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caregiver_patient_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" SERIAL NOT NULL,
    "inviterUserId" INTEGER NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "proposedRole" "ProposedRole" NOT NULL,
    "inviteToken" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'sent',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "doctorName" TEXT NOT NULL,
    "specialization" TEXT,
    "clinicHospitalName" TEXT,
    "contactNumber" TEXT,
    "address" TEXT,
    "source" "DoctorSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "doctorId" INTEGER,
    "medicineName" TEXT NOT NULL,
    "genericName" TEXT,
    "medicineForm" "MedicineForm" NOT NULL,
    "trackingType" "TrackingType" NOT NULL,
    "dosageAmount" DECIMAL(6,2) NOT NULL,
    "dosageUnit" TEXT NOT NULL,
    "frequencyText" TEXT NOT NULL,
    "instructions" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "MedicationStatus" NOT NULL DEFAULT 'active',
    "addedVia" "AddedVia" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_scans" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "medicationId" INTEGER,
    "doctorId" INTEGER,
    "imageUrl" TEXT NOT NULL,
    "ocrRawText" TEXT,
    "ocrExtractedData" JSONB,
    "ocrConfidenceScore" DECIMAL(5,2),
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'processing',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "prescription_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_schedules" (
    "id" SERIAL NOT NULL,
    "medicationId" INTEGER NOT NULL,
    "timeOfDay" TIME NOT NULL,
    "daysOfWeek" TEXT NOT NULL,
    "doseAmount" DECIMAL(6,2) NOT NULL,
    "isTaperSchedule" BOOLEAN NOT NULL DEFAULT false,
    "taperDetails" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medication_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dose_logs" (
    "id" SERIAL NOT NULL,
    "scheduleId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "scheduledDatetime" TIMESTAMP(3) NOT NULL,
    "actualActionDatetime" TIMESTAMP(3),
    "status" "DoseStatus" NOT NULL DEFAULT 'pending',
    "loggedByUserId" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dose_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_inventory" (
    "id" SERIAL NOT NULL,
    "medicationId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "quantityUnit" TEXT NOT NULL,
    "quantityTotal" DECIMAL(8,2) NOT NULL,
    "quantityRemaining" DECIMAL(8,2) NOT NULL,
    "estimatedUsagePerDose" DECIMAL(6,2),
    "refillThreshold" DECIMAL(8,2) NOT NULL,
    "refillAmount" DECIMAL(8,2) NOT NULL,
    "estimatedRunoutDate" TIMESTAMP(3),
    "lastRefillDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "relatedDoseLogId" INTEGER,
    "notificationType" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'sent',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_alerts" (
    "id" SERIAL NOT NULL,
    "doseLogId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "caregiverId" INTEGER,
    "escalationLevel" INTEGER NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionStatus" "EscalationResolutionStatus" NOT NULL DEFAULT 'open',

    CONSTRAINT "escalation_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adherence_stats" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "periodType" "PeriodType" NOT NULL,
    "periodStartDate" TIMESTAMP(3) NOT NULL,
    "periodEndDate" TIMESTAMP(3) NOT NULL,
    "totalScheduledDoses" INTEGER NOT NULL,
    "takenCount" INTEGER NOT NULL,
    "missedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "adherencePercentage" DECIMAL(5,2) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adherence_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_summary_reports" (
    "id" SERIAL NOT NULL,
    "caregiverId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "weekEndDate" TIMESTAMP(3) NOT NULL,
    "summaryText" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentStatus" "ReportSentStatus" NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "weekly_summary_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_conversations" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "relatedMedicationId" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ai_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_messages" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "senderType" "SenderType" NOT NULL,
    "messageText" TEXT NOT NULL,
    "disclaimerShown" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "relatedMedicationId" INTEGER,
    "insightType" "InsightType" NOT NULL,
    "insightText" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDismissed" BOOLEAN NOT NULL DEFAULT false,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drug_interactions" (
    "id" SERIAL NOT NULL,
    "medicineNameA" TEXT NOT NULL,
    "medicineNameB" TEXT NOT NULL,
    "severityLevel" "SeverityLevel" NOT NULL,
    "description" TEXT NOT NULL,
    "sourceReference" TEXT,

    CONSTRAINT "drug_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_interaction_flags" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "medicationId1" INTEGER NOT NULL,
    "medicationId2" INTEGER NOT NULL,
    "interactionId" INTEGER NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "medication_interaction_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "preferredNotificationChannel" "NotificationChannel" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "theme" "Theme" NOT NULL DEFAULT 'light',
    "timezone" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_inviteToken_key" ON "invitations"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

-- AddForeignKey
ALTER TABLE "caregiver_patient_links" ADD CONSTRAINT "caregiver_patient_links_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_patient_links" ADD CONSTRAINT "caregiver_patient_links_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_patient_links" ADD CONSTRAINT "caregiver_patient_links_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_scans" ADD CONSTRAINT "prescription_scans_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_scans" ADD CONSTRAINT "prescription_scans_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_scans" ADD CONSTRAINT "prescription_scans_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "medication_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_loggedByUserId_fkey" FOREIGN KEY ("loggedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_inventory" ADD CONSTRAINT "medicine_inventory_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_inventory" ADD CONSTRAINT "medicine_inventory_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_relatedDoseLogId_fkey" FOREIGN KEY ("relatedDoseLogId") REFERENCES "dose_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_alerts" ADD CONSTRAINT "escalation_alerts_doseLogId_fkey" FOREIGN KEY ("doseLogId") REFERENCES "dose_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_alerts" ADD CONSTRAINT "escalation_alerts_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_alerts" ADD CONSTRAINT "escalation_alerts_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adherence_stats" ADD CONSTRAINT "adherence_stats_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_summary_reports" ADD CONSTRAINT "weekly_summary_reports_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_summary_reports" ADD CONSTRAINT "weekly_summary_reports_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_relatedMedicationId_fkey" FOREIGN KEY ("relatedMedicationId") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_chat_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_relatedMedicationId_fkey" FOREIGN KEY ("relatedMedicationId") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_interaction_flags" ADD CONSTRAINT "medication_interaction_flags_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_interaction_flags" ADD CONSTRAINT "medication_interaction_flags_medicationId1_fkey" FOREIGN KEY ("medicationId1") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_interaction_flags" ADD CONSTRAINT "medication_interaction_flags_medicationId2_fkey" FOREIGN KEY ("medicationId2") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_interaction_flags" ADD CONSTRAINT "medication_interaction_flags_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "drug_interactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
