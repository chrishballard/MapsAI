import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGoogleClient } from "@/lib/google";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown>[] = [];

  try {
    // 1. Check Google Accounts in DB
    const accounts = await prisma.googleAccount.findMany({
      select: { id: true, googleEmail: true, tokenExpiry: true },
    });
    results.push({ step: "google_accounts", count: accounts.length, accounts });

    if (accounts.length === 0) {
      return NextResponse.json({ status: "no_google_accounts", results });
    }

    // 2. Try to list accounts via v4 API
    const account = accounts[0];
    const oauth2Client = await createGoogleClient(account.id);

    try {
      const accountsRes = await oauth2Client.request<{ accounts?: unknown[] }>({
        url: "https://mybusiness.googleapis.com/v4/accounts",
        method: "GET",
      });
      results.push({
        step: "v4_accounts_list",
        success: true,
        accountCount: accountsRes.data.accounts?.length ?? 0,
        accounts: accountsRes.data.accounts,
      });

      // 3. Try to list locations for first account
      const firstAccount = accountsRes.data.accounts?.[0] as { name?: string } | undefined;
      if (firstAccount?.name) {
        try {
          const locationsRes = await oauth2Client.request<{ locations?: unknown[] }>({
            url: `https://mybusiness.googleapis.com/v4/${firstAccount.name}/locations?readMask=name,title,storefrontAddress,phoneNumbers,categories,websiteUri,metadata&pageSize=100`,
            method: "GET",
          });
          results.push({
            step: "v4_locations_list",
            success: true,
            locationCount: locationsRes.data.locations?.length ?? 0,
            locations: locationsRes.data.locations,
          });
        } catch (locErr: unknown) {
          const e = locErr as { message?: string; response?: { status?: number; data?: unknown } };
          results.push({
            step: "v4_locations_list",
            success: false,
            error: e.message,
            status: e.response?.status,
            data: e.response?.data,
          });
        }
      }
    } catch (apiErr: unknown) {
      const e = apiErr as { message?: string; response?: { status?: number; data?: unknown } };
      results.push({
        step: "v4_accounts_list",
        success: false,
        error: e.message,
        status: e.response?.status,
        data: e.response?.data,
      });
    }

    // 4. Check profiles in DB
    const profiles = await prisma.profile.findMany({
      select: { id: true, name: true, isConnected: true, isOnboarded: true, locationName: true },
    });
    results.push({ step: "db_profiles", count: profiles.length, profiles });

    return NextResponse.json({ status: "debug_complete", results });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    return NextResponse.json({ status: "error", message: e.message, stack: e.stack }, { status: 500 });
  }
}
