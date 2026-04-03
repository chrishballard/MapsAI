import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGoogleClient } from "@/lib/google";
import { google } from "googleapis";

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

    const account = accounts[0];
    const oauth2Client = await createGoogleClient(account.id);

    // 2. Try v4 accounts endpoint
    try {
      const res = await oauth2Client.request<{ accounts?: unknown[] }>({
        url: "https://mybusiness.googleapis.com/v4/accounts",
        method: "GET",
      });
      results.push({ step: "v4_accounts", success: true, data: res.data });
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      results.push({ step: "v4_accounts", success: false, status: e.response?.status, error: String(e.response?.data || e.message).slice(0, 200) });
    }

    // 3. Try Account Management API (sub-API)
    try {
      const mgmt = google.mybusinessaccountmanagement({ version: "v1", auth: oauth2Client });
      const res = await mgmt.accounts.list();
      results.push({ step: "account_mgmt_api", success: true, accounts: res.data.accounts });
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      results.push({ step: "account_mgmt_api", success: false, status: e.response?.status, error: String(e.response?.data || e.message).slice(0, 300) });
    }

    // 4. Try Business Information API for locations (if we have account name from either source)
    const accountName = (results.find(r => r.step === "v4_accounts" && r.success) as Record<string,unknown>)?.data as { accounts?: Array<{ name?: string }> } | undefined;
    const mgmtAccounts = (results.find(r => r.step === "account_mgmt_api" && r.success) as Record<string,unknown>)?.accounts as Array<{ name?: string }> | undefined;
    const firstAccountName = accountName?.accounts?.[0]?.name || mgmtAccounts?.[0]?.name;

    if (firstAccountName) {
      // Try v4 locations
      try {
        const res = await oauth2Client.request<{ locations?: unknown[] }>({
          url: `https://mybusiness.googleapis.com/v4/${firstAccountName}/locations?pageSize=10`,
          method: "GET",
        });
        results.push({ step: "v4_locations", success: true, count: res.data.locations?.length ?? 0, locations: res.data.locations });
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: unknown }; message?: string };
        results.push({ step: "v4_locations", success: false, status: e.response?.status, error: String(e.response?.data || e.message).slice(0, 200) });
      }

      // Try Business Information API locations
      try {
        const biz = google.mybusinessbusinessinformation({ version: "v1", auth: oauth2Client });
        const res = await biz.accounts.locations.list({
          parent: firstAccountName,
          readMask: "name,title",
          pageSize: 10,
        });
        results.push({ step: "biz_info_locations", success: true, count: res.data.locations?.length ?? 0, locations: res.data.locations });
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: unknown }; message?: string };
        results.push({ step: "biz_info_locations", success: false, status: e.response?.status, error: String(e.response?.data || e.message).slice(0, 300) });
      }
    } else {
      results.push({ step: "locations_skip", reason: "no account name from either API" });
    }

    // 5. DB profiles
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
