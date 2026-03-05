import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import type { ChartConfiguration } from "chart.js";

const chartCanvas = new ChartJSNodeCanvas({
  width: 600,
  height: 300,
  backgroundColour: "white",
});

interface DailyChartData {
  date: string;
  search: number;
  maps: number;
}

export async function renderImpressionsChart(
  dailyData: DailyChartData[]
): Promise<Buffer> {
  const sorted = [...dailyData].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const labels = sorted.map((d) => {
    const date = new Date(d.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const config: ChartConfiguration = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Search Impressions",
          data: sorted.map((d) => d.search),
          borderColor: "#3B82F6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          fill: true,
          tension: 0.3,
        },
        {
          label: "Maps Impressions",
          data: sorted.map((d) => d.maps),
          borderColor: "#10B981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      animation: false,
      responsive: false,
      plugins: {
        legend: {
          position: "bottom",
        },
        title: {
          display: true,
          text: "Daily Impressions Trend",
          font: { size: 14 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0,
          },
        },
      },
    },
  };

  return await chartCanvas.renderToBuffer(config);
}
