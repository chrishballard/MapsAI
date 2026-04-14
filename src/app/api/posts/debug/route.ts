import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PostType } from "@/generated/prisma/client";
import { createGoogleClient } from "@/lib/google";

const POST_TYPE_TO_GBP: Record<PostType, "STANDARD" | "EVENT" | "OFFER"> = {
  [PostType.WHATS_NEW]: "STANDARD",
  [PostType.EVENT]: "EVENT",
  [PostType.OFFER]: "OFFER",
};

/**
 * GET /api/posts/debug
 *
 * Shows failed posts and the exact request that would be sent to Google,
 * helping diagnose "Request contains an invalid argument" errors.
 *
 * ?retry=true — attempts to re-publish the first FAILED post and returns
 * the full Google error response.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const shouldRetry = url.searchParams.get("retry") === "true";

  const results: Record<string, unknown>[] = [];

  try {
    // 1. Find failed posts
    const failedPosts = await prisma.post.findMany({
      where: { status: "FAILED" },
      include: {
        profile: {
          select: {
            id: true,
            name: true,
            locationName: true,
            accountResourceName: true,
            googleAccountId: true,
          },
        },
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    });

    results.push({
      step: "failed_posts",
      count: failedPosts.length,
      posts: failedPosts.map((p) => ({
        id: p.id,
        type: p.type,
        content: p.content,
        contentLength: p.content.length,
        callToAction: p.callToAction,
        status: p.status,
        errorMessage: p.errorMessage,
        scheduledAt: p.scheduledAt,
        createdAt: p.createdAt,
        profile: p.profile,
      })),
    });

    if (failedPosts.length === 0) {
      // Also check scheduled posts
      const scheduledPosts = await prisma.post.findMany({
        where: { status: "SCHEDULED" },
        take: 5,
        orderBy: { scheduledAt: "asc" },
        select: {
          id: true,
          type: true,
          content: true,
          callToAction: true,
          scheduledAt: true,
          status: true,
        },
      });
      results.push({ step: "scheduled_posts", count: scheduledPosts.length, posts: scheduledPosts });
      return NextResponse.json({ status: "no_failed_posts", results });
    }

    // 2. Show what the request would look like for the first failed post
    const post = failedPosts[0];
    const profile = post.profile;
    const topicType = POST_TYPE_TO_GBP[post.type];
    const parent = `${profile.accountResourceName}/${profile.locationName}`;
    const apiUrl = `https://mybusiness.googleapis.com/v4/${parent}/localPosts`;

    const body: Record<string, unknown> = {
      languageCode: "en-US",
      summary: post.content,
      topicType,
    };

    if (post.callToAction && post.callToAction.startsWith("http")) {
      body.callToAction = { actionType: "LEARN_MORE", url: post.callToAction };
    }

    results.push({
      step: "request_details",
      postId: post.id,
      apiUrl,
      parentPath: parent,
      accountResourceName: profile.accountResourceName,
      locationName: profile.locationName,
      body,
      contentLength: post.content.length,
      issues: [
        ...(post.content.length > 1500 ? ["CONTENT_TOO_LONG: " + post.content.length + " chars (max 1500)"] : []),
        ...(!profile.accountResourceName ? ["MISSING_ACCOUNT_RESOURCE_NAME"] : []),
        ...(!profile.locationName ? ["MISSING_LOCATION_NAME"] : []),
        ...(post.callToAction && !post.callToAction.startsWith("http") ? ["CTA_NOT_A_URL: " + post.callToAction] : []),
        ...(topicType === undefined ? ["UNKNOWN_POST_TYPE: " + post.type] : []),
      ],
    });

    // 3. If ?retry=true, attempt the publish and capture the full error
    if (shouldRetry) {
      try {
        const oauth2Client = await createGoogleClient(profile.googleAccountId);
        const response = await oauth2Client.request({
          url: apiUrl,
          method: "POST",
          data: body,
        });
        results.push({
          step: "retry_publish",
          success: true,
          httpStatus: response.status,
          responseData: response.data,
        });
      } catch (err: unknown) {
        const e = err as {
          response?: { status?: number; data?: unknown; statusText?: string };
          message?: string;
          code?: string;
        };
        results.push({
          step: "retry_publish",
          success: false,
          httpStatus: e.response?.status,
          statusText: e.response?.statusText,
          errorData: e.response?.data,
          errorMessage: e.message,
          errorCode: e.code,
        });
      }
    }

    return NextResponse.json({ status: "debug_complete", results });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    return NextResponse.json(
      { status: "error", message: e.message, stack: e.stack, results },
      { status: 500 }
    );
  }
}
