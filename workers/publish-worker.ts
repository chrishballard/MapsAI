import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { createGBPPost } from "../src/lib/google-posts";
import { prisma } from "../src/lib/prisma";
import { PostType } from "../src/generated/prisma/client";

interface PublishJobData {
  postId: string;
}

const POST_TYPE_TO_GBP: Record<PostType, "STANDARD" | "EVENT" | "OFFER"> = {
  [PostType.WHATS_NEW]: "STANDARD",
  [PostType.EVENT]: "EVENT",
  [PostType.OFFER]: "OFFER",
};

export const worker = new Worker<PublishJobData>(
  "post-publish",
  async (job: Job<PublishJobData>) => {
    const { postId } = job.data;

    console.log(`Processing publish job for post ${postId}`);

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
      include: {
        profile: {
          include: {
            googleAccount: true,
          },
        },
      },
    });

    // Skip if already published
    if (post.status === "PUBLISHED") {
      console.log(`Post ${postId} already published, skipping`);
      return;
    }

    if (!post.profile.accountResourceName) {
      throw new Error(
        `Profile ${post.profileId} is missing accountResourceName`
      );
    }

    const topicType = POST_TYPE_TO_GBP[post.type];

    const result = await createGBPPost({
      googleAccountId: post.profile.googleAccountId,
      accountResourceName: post.profile.accountResourceName,
      locationName: post.profile.locationName,
      summary: post.content,
      topicType,
      callToAction:
        post.callToAction && post.callToAction.startsWith("http")
          ? { actionType: "LEARN_MORE", url: post.callToAction }
          : undefined,
    });

    // Update post as published
    await prisma.post.update({
      where: { id: postId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        googlePostId: result.name,
      },
    });

    console.log(`Post ${postId} published successfully as ${result.name}`);
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed for post ${job.data.postId}`);
});

worker.on("failed", async (job, err) => {
  if (!job) return;

  console.error(
    `Job ${job.id} failed for post ${job.data.postId}: ${err.message}`
  );

  // On final attempt, mark post as FAILED
  const maxAttempts = job.opts.attempts ?? 3;
  if (job.attemptsMade >= maxAttempts) {
    console.error(`Post ${job.data.postId} permanently failed after ${job.attemptsMade} attempts`);
    try {
      await prisma.post.update({
        where: { id: job.data.postId },
        data: {
          status: "FAILED",
          errorMessage: err.message,
        },
      });
    } catch (updateErr) {
      console.error(`Failed to update post status: ${updateErr}`);
    }
  }
});

console.log("Publish worker started, waiting for jobs...");
