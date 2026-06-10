-- CreateIndex
CREATE INDEX "Post_profileId_status_idx" ON "Post"("profileId", "status");

-- CreateIndex
CREATE INDEX "Post_status_scheduledAt_idx" ON "Post"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Review_profileId_repliedExternally_idx" ON "Review"("profileId", "repliedExternally");
