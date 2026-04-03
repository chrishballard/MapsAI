import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1F2937",
  },
  header: {
    marginBottom: 20,
    borderBottom: "2px solid #3B82F6",
    paddingBottom: 12,
  },
  businessName: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: "#6B7280",
    marginBottom: 2,
  },
  reportTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#3B82F6",
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 8,
    marginTop: 16,
    borderBottom: "1px solid #E5E7EB",
    paddingBottom: 4,
  },
  metricsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 8,
  },
  metricBox: {
    flex: 1,
    padding: 10,
    backgroundColor: "#F9FAFB",
    borderRadius: 4,
    border: "1px solid #E5E7EB",
  },
  metricLabel: {
    fontSize: 9,
    color: "#6B7280",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  metricChange: {
    fontSize: 9,
    marginTop: 2,
  },
  changePositive: {
    color: "#059669",
  },
  changeNegative: {
    color: "#DC2626",
  },
  changeNeutral: {
    color: "#6B7280",
  },
  chartImage: {
    width: "100%",
    marginVertical: 12,
  },
  table: {
    marginTop: 8,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    borderBottom: "1px solid #D1D5DB",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1px solid #E5E7EB",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tableCell: {
    fontSize: 9,
  },
  tableCellRank: {
    width: 30,
    fontSize: 9,
  },
  tableCellKeyword: {
    flex: 1,
    fontSize: 9,
  },
  tableCellImpressions: {
    width: 80,
    fontSize: 9,
    textAlign: "right",
  },
  tableHeaderText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 16,
  },
  summaryItem: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 9,
    color: "#6B7280",
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#9CA3AF",
    fontSize: 8,
    borderTop: "1px solid #E5E7EB",
    paddingTop: 8,
  },
  narrativeBlock: {
    borderLeft: "3px solid #7c3aed",
    backgroundColor: "#F9FAFB",
    padding: 10,
    marginBottom: 16,
  },
  narrativeText: {
    fontSize: 10,
    fontStyle: "italic",
    color: "#374151",
    lineHeight: 1.5,
  },
  sparklineRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    marginBottom: 8,
    gap: 12,
  },
  sparklineImage: {
    width: 120,
    height: 40,
  },
  sparklineLabel: {
    fontSize: 10,
    color: "#6B7280",
    width: 120,
  },
});

export interface ReportData {
  businessName: string;
  address: string | null;
  category: string | null;
  month: string; // "March 2026"
  currentMetrics: {
    totalImpressions: number;
    websiteClicks: number;
    callClicks: number;
    directionRequests: number;
  };
  previousMetrics: {
    totalImpressions: number;
    websiteClicks: number;
    callClicks: number;
    directionRequests: number;
  };
  chartImageUri: string | null;
  keywords: Array<{ keyword: string; impressions: number }>;
  reviewCount: number;
  averageRating: number;
  responseRate: number;
  postsCount: number;
}

function formatChange(current: number, previous: number): { text: string; style: typeof styles.changePositive } {
  if (previous === 0) {
    return { text: "N/A", style: styles.changeNeutral };
  }
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  const text = `${sign}${pct.toFixed(1)}% vs prev month`;
  const style = pct > 0 ? styles.changePositive : pct < 0 ? styles.changeNegative : styles.changeNeutral;
  return { text, style };
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export interface DashboardReportData {
  businessName: string;
  address: string | null;
  category: string | null;
  periodLabel: string; // "Mar 1, 2026 - Mar 31, 2026"
  narrativeText: string | null; // AI summary
  currentMetrics: {
    searchImpressions: number;
    mapsImpressions: number;
    websiteClicks: number;
    callClicks: number;
    directionRequests: number;
  };
  previousMetrics: {
    searchImpressions: number;
    mapsImpressions: number;
    websiteClicks: number;
    callClicks: number;
    directionRequests: number;
  };
  impressionsChartUri: string | null;
  callsSparkUri: string | null;
  clicksSparkUri: string | null;
  directionsSparkUri: string | null;
  actions: Array<{ label: string; profileName: string; date: string }>;
}

export function DashboardReportDocument({
  data,
}: {
  data: DashboardReportData;
}) {
  const searchChange = formatChange(
    data.currentMetrics.searchImpressions,
    data.previousMetrics.searchImpressions
  );
  const mapsChange = formatChange(
    data.currentMetrics.mapsImpressions,
    data.previousMetrics.mapsImpressions
  );
  const clickChange = formatChange(
    data.currentMetrics.websiteClicks,
    data.previousMetrics.websiteClicks
  );
  const callChange = formatChange(
    data.currentMetrics.callClicks,
    data.previousMetrics.callClicks
  );
  const dirChange = formatChange(
    data.currentMetrics.directionRequests,
    data.previousMetrics.directionRequests
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.businessName}>{data.businessName}</Text>
          {data.address && <Text style={styles.subtitle}>{data.address}</Text>}
          {data.category && (
            <Text style={styles.subtitle}>{data.category}</Text>
          )}
          <Text style={styles.reportTitle}>
            Performance Dashboard - {data.periodLabel}
          </Text>
        </View>

        {/* AI Narrative Block */}
        {data.narrativeText && (
          <View style={styles.narrativeBlock}>
            <Text style={styles.narrativeText}>{data.narrativeText}</Text>
          </View>
        )}

        {/* Key Metrics — row 1: Search + Maps + Website */}
        <Text style={styles.sectionTitle}>Key Metrics</Text>
        <View style={styles.metricsRow}>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Search Impressions</Text>
            <Text style={styles.metricValue}>
              {formatNumber(data.currentMetrics.searchImpressions)}
            </Text>
            <Text style={[styles.metricChange, searchChange.style]}>
              {searchChange.text}
            </Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Maps Impressions</Text>
            <Text style={styles.metricValue}>
              {formatNumber(data.currentMetrics.mapsImpressions)}
            </Text>
            <Text style={[styles.metricChange, mapsChange.style]}>
              {mapsChange.text}
            </Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Website Clicks</Text>
            <Text style={styles.metricValue}>
              {formatNumber(data.currentMetrics.websiteClicks)}
            </Text>
            <Text style={[styles.metricChange, clickChange.style]}>
              {clickChange.text}
            </Text>
          </View>
        </View>

        {/* Key Metrics — row 2: Calls + Directions */}
        <View style={styles.metricsRow}>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Phone Calls</Text>
            <Text style={styles.metricValue}>
              {formatNumber(data.currentMetrics.callClicks)}
            </Text>
            <Text style={[styles.metricChange, callChange.style]}>
              {callChange.text}
            </Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Direction Requests</Text>
            <Text style={styles.metricValue}>
              {formatNumber(data.currentMetrics.directionRequests)}
            </Text>
            <Text style={[styles.metricChange, dirChange.style]}>
              {dirChange.text}
            </Text>
          </View>
          {/* Empty spacer to balance the 3-column grid */}
          <View style={styles.metricBox} />
        </View>

        {/* Impressions Trend Chart */}
        {data.impressionsChartUri && (
          <>
            <Text style={styles.sectionTitle}>Impressions Trend</Text>
            <Image style={styles.chartImage} src={data.impressionsChartUri} />
          </>
        )}

        {/* Sparkline Charts */}
        {(data.callsSparkUri ||
          data.clicksSparkUri ||
          data.directionsSparkUri) && (
          <>
            <Text style={styles.sectionTitle}>Activity Trends</Text>
            {data.callsSparkUri && (
              <View style={styles.sparklineRow}>
                <Text style={styles.sparklineLabel}>Phone Calls</Text>
                <Image
                  style={styles.sparklineImage}
                  src={data.callsSparkUri}
                />
              </View>
            )}
            {data.clicksSparkUri && (
              <View style={styles.sparklineRow}>
                <Text style={styles.sparklineLabel}>Website Clicks</Text>
                <Image
                  style={styles.sparklineImage}
                  src={data.clicksSparkUri}
                />
              </View>
            )}
            {data.directionsSparkUri && (
              <View style={styles.sparklineRow}>
                <Text style={styles.sparklineLabel}>Direction Requests</Text>
                <Image
                  style={styles.sparklineImage}
                  src={data.directionsSparkUri}
                />
              </View>
            )}
          </>
        )}

        {/* Actions Log */}
        {data.actions.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Actions Log</Text>
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.tableCellKeyword, styles.tableHeaderText]}>
                  Action
                </Text>
                <Text
                  style={[styles.tableCellImpressions, styles.tableHeaderText]}
                >
                  Date
                </Text>
              </View>
              {data.actions.map((action, i) => (
                <View style={styles.tableRow} key={i}>
                  <Text style={styles.tableCellKeyword}>
                    {action.label} - {action.profileName}
                  </Text>
                  <Text style={styles.tableCellImpressions}>{action.date}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          Generated by MapsAI - {new Date().toLocaleDateString("en-US")}
        </Text>
      </Page>
    </Document>
  );
}

export function ReportDocument({ data }: { data: ReportData }) {
  const impChange = formatChange(data.currentMetrics.totalImpressions, data.previousMetrics.totalImpressions);
  const clickChange = formatChange(data.currentMetrics.websiteClicks, data.previousMetrics.websiteClicks);
  const callChange = formatChange(data.currentMetrics.callClicks, data.previousMetrics.callClicks);
  const dirChange = formatChange(data.currentMetrics.directionRequests, data.previousMetrics.directionRequests);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.businessName}>{data.businessName}</Text>
          {data.address && <Text style={styles.subtitle}>{data.address}</Text>}
          {data.category && <Text style={styles.subtitle}>{data.category}</Text>}
          <Text style={styles.reportTitle}>
            Performance Report - {data.month}
          </Text>
        </View>

        {/* Key Metrics */}
        <Text style={styles.sectionTitle}>Key Metrics</Text>
        <View style={styles.metricsRow}>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Total Impressions</Text>
            <Text style={styles.metricValue}>{formatNumber(data.currentMetrics.totalImpressions)}</Text>
            <Text style={[styles.metricChange, impChange.style]}>{impChange.text}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Website Clicks</Text>
            <Text style={styles.metricValue}>{formatNumber(data.currentMetrics.websiteClicks)}</Text>
            <Text style={[styles.metricChange, clickChange.style]}>{clickChange.text}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Phone Calls</Text>
            <Text style={styles.metricValue}>{formatNumber(data.currentMetrics.callClicks)}</Text>
            <Text style={[styles.metricChange, callChange.style]}>{callChange.text}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Direction Requests</Text>
            <Text style={styles.metricValue}>{formatNumber(data.currentMetrics.directionRequests)}</Text>
            <Text style={[styles.metricChange, dirChange.style]}>{dirChange.text}</Text>
          </View>
        </View>

        {/* Impressions Chart */}
        {data.chartImageUri && (
          <>
            <Text style={styles.sectionTitle}>Impressions Trend</Text>
            <Image style={styles.chartImage} src={data.chartImageUri} />
          </>
        )}

        {/* Top Keywords */}
        {data.keywords.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Top Search Keywords</Text>
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.tableCellRank, styles.tableHeaderText]}>#</Text>
                <Text style={[styles.tableCellKeyword, styles.tableHeaderText]}>Keyword</Text>
                <Text style={[styles.tableCellImpressions, styles.tableHeaderText]}>Impressions</Text>
              </View>
              {data.keywords.map((kw, i) => (
                <View style={styles.tableRow} key={i}>
                  <Text style={styles.tableCellRank}>{i + 1}</Text>
                  <Text style={styles.tableCellKeyword}>{kw.keyword}</Text>
                  <Text style={styles.tableCellImpressions}>{formatNumber(kw.impressions)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Reviews & Posts Summary */}
        <Text style={styles.sectionTitle}>Reviews & Activity</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Reviews This Month</Text>
            <Text style={styles.summaryValue}>{data.reviewCount}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Average Rating</Text>
            <Text style={styles.summaryValue}>
              {data.averageRating > 0 ? data.averageRating.toFixed(1) : "N/A"}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Response Rate</Text>
            <Text style={styles.summaryValue}>
              {data.reviewCount > 0 ? `${data.responseRate.toFixed(0)}%` : "N/A"}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Posts Published</Text>
            <Text style={styles.summaryValue}>{data.postsCount}</Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          Generated by MapsAI - {new Date().toLocaleDateString("en-US")}
        </Text>
      </Page>
    </Document>
  );
}
