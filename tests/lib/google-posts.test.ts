import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { fetchPosts, type GBPPost } from "@/lib/google-posts";
import { createGoogleClient } from "@/lib/google";

vi.mock("@/lib/google", () => ({
  createGoogleClient: vi.fn(),
}));

const mockedCreateGoogleClient = createGoogleClient as unknown as Mock;

function mockClientWith(data: { localPosts?: GBPPost[]; nextPageToken?: string }) {
  const request = vi.fn().mockResolvedValue({ data });
  mockedCreateGoogleClient.mockResolvedValue({ request });
  return request;
}

const baseParams = {
  googleAccountId: "acct-id",
  accountResourceName: "accounts/123",
  locationName: "locations/456",
};

describe("fetchPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns posts and nextPageToken when API yields a page", async () => {
    const samplePosts: GBPPost[] = [
      { name: "accounts/123/locations/456/localPosts/1", summary: "first", state: "LIVE" },
      { name: "accounts/123/locations/456/localPosts/2", summary: "second", state: "LIVE" },
    ];
    const request = mockClientWith({ localPosts: samplePosts, nextPageToken: "next-cursor" });

    const result = await fetchPosts(baseParams);

    expect(result.posts).toEqual(samplePosts);
    expect(result.nextPageToken).toBe("next-cursor");
    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0][0];
    expect(call.method).toBe("GET");
    expect(call.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/123/locations/456/localPosts?pageSize=50"
    );
  });

  it("returns empty array when API omits localPosts", async () => {
    mockClientWith({}); // no localPosts field

    const result = await fetchPosts(baseParams);

    expect(result.posts).toEqual([]);
    expect(result.nextPageToken).toBeUndefined();
  });

  it("forwards pageToken via URL-encoded query param", async () => {
    const request = mockClientWith({ localPosts: [] });

    await fetchPosts({ ...baseParams, pageToken: "abc=def&ghi" });

    const call = request.mock.calls[0][0];
    expect(call.url).toContain("pageToken=abc%3Ddef%26ghi");
  });

  it("honors custom pageSize", async () => {
    const request = mockClientWith({ localPosts: [] });

    await fetchPosts({ ...baseParams, pageSize: 25 });

    const call = request.mock.calls[0][0];
    expect(call.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/123/locations/456/localPosts?pageSize=25"
    );
  });

  it("propagates errors from the OAuth client", async () => {
    const request = vi.fn().mockRejectedValue(new Error("auth refresh failed"));
    mockedCreateGoogleClient.mockResolvedValue({ request });

    await expect(fetchPosts(baseParams)).rejects.toThrow("auth refresh failed");
  });
});
