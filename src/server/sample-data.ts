import type { ScenarioAssumptions } from "../domain/types.ts";

export const sampleLongCsv = `month,department,account,value
2025-01,GPU Cloud,Revenue,4200000
2025-01,GPU Cloud,COGS,2310000
2025-01,GPU Cloud,Headcount,42
2025-01,GPU Cloud,OpEx,798000
2025-01,Inference Platform,Revenue,2600000
2025-01,Inference Platform,COGS,1092000
2025-01,Inference Platform,Headcount,31
2025-01,Inference Platform,OpEx,558000
2025-01,Engineering,Revenue,0
2025-01,Engineering,COGS,0
2025-01,Engineering,Headcount,96
2025-01,Engineering,OpEx,2112000
2025-01,Sales,Revenue,0
2025-01,Sales,COGS,0
2025-01,Sales,Headcount,36
2025-01,Sales,OpEx,612000
2025-02,GPU Cloud,Revenue,4435200
2025-02,GPU Cloud,COGS,2395008
2025-02,GPU Cloud,Headcount,44
2025-02,GPU Cloud,OpEx,836000
2025-02,Inference Platform,Revenue,2745600
2025-02,Inference Platform,COGS,1125696
2025-02,Inference Platform,Headcount,32
2025-02,Inference Platform,OpEx,576000
2025-02,Engineering,Revenue,0
2025-02,Engineering,COGS,0
2025-02,Engineering,Headcount,99
2025-02,Engineering,OpEx,2178000
2025-02,Sales,Revenue,0
2025-02,Sales,COGS,0
2025-02,Sales,Headcount,37
2025-02,Sales,OpEx,629000
2025-03,GPU Cloud,Revenue,4683571
2025-03,GPU Cloud,COGS,2482292
2025-03,GPU Cloud,Headcount,46
2025-03,GPU Cloud,OpEx,874000
2025-03,Inference Platform,Revenue,2899354
2025-03,Inference Platform,COGS,1159742
2025-03,Inference Platform,Headcount,33
2025-03,Inference Platform,OpEx,594000
2025-03,Engineering,Revenue,0
2025-03,Engineering,COGS,0
2025-03,Engineering,Headcount,102
2025-03,Engineering,OpEx,2244000
2025-03,Sales,Revenue,0
2025-03,Sales,COGS,0
2025-03,Sales,Headcount,38
2025-03,Sales,OpEx,646000
2025-04,GPU Cloud,Revenue,4945841
2025-04,GPU Cloud,COGS,2571837
2025-04,GPU Cloud,Headcount,48
2025-04,GPU Cloud,OpEx,912000
2025-04,Inference Platform,Revenue,3061720
2025-04,Inference Platform,COGS,1194071
2025-04,Inference Platform,Headcount,34
2025-04,Inference Platform,OpEx,612000
2025-04,Engineering,Revenue,0
2025-04,Engineering,COGS,0
2025-04,Engineering,Headcount,105
2025-04,Engineering,OpEx,2310000
2025-04,Sales,Revenue,0
2025-04,Sales,COGS,0
2025-04,Sales,Headcount,39
2025-04,Sales,OpEx,663000
2025-05,GPU Cloud,Revenue,5222788
2025-05,GPU Cloud,COGS,2663622
2025-05,GPU Cloud,Headcount,50
2025-05,GPU Cloud,OpEx,950000
2025-05,Inference Platform,Revenue,3233180
2025-05,Inference Platform,COGS,1228608
2025-05,Inference Platform,Headcount,35
2025-05,Inference Platform,OpEx,630000
2025-05,Engineering,Revenue,0
2025-05,Engineering,COGS,0
2025-05,Engineering,Headcount,108
2025-05,Engineering,OpEx,2376000
2025-05,Sales,Revenue,0
2025-05,Sales,COGS,0
2025-05,Sales,Headcount,40
2025-05,Sales,OpEx,680000
2025-06,GPU Cloud,Revenue,5515234
2025-06,GPU Cloud,COGS,2757617
2025-06,GPU Cloud,Headcount,52
2025-06,GPU Cloud,OpEx,988000
2025-06,Inference Platform,Revenue,3414242
2025-06,Inference Platform,COGS,1263260
2025-06,Inference Platform,Headcount,36
2025-06,Inference Platform,OpEx,648000
2025-06,Engineering,Revenue,0
2025-06,Engineering,COGS,0
2025-06,Engineering,Headcount,111
2025-06,Engineering,OpEx,2442000
2025-06,Sales,Revenue,0
2025-06,Sales,COGS,0
2025-06,Sales,Headcount,41
2025-06,Sales,OpEx,697000
2025-07,GPU Cloud,Revenue,5824057
2025-07,GPU Cloud,COGS,2853788
2025-07,GPU Cloud,Headcount,54
2025-07,GPU Cloud,OpEx,1026000
2025-07,Inference Platform,Revenue,3605440
2025-07,Inference Platform,COGS,1297958
2025-07,Inference Platform,Headcount,37
2025-07,Inference Platform,OpEx,666000
2025-07,Engineering,Revenue,0
2025-07,Engineering,COGS,0
2025-07,Engineering,Headcount,114
2025-07,Engineering,OpEx,2508000
2025-07,Sales,Revenue,0
2025-07,Sales,COGS,0
2025-07,Sales,Headcount,42
2025-07,Sales,OpEx,714000
2025-08,GPU Cloud,Revenue,6149214
2025-08,GPU Cloud,COGS,2951623
2025-08,GPU Cloud,Headcount,56
2025-08,GPU Cloud,OpEx,1064000
2025-08,Inference Platform,Revenue,3807339
2025-08,Inference Platform,COGS,1332569
2025-08,Inference Platform,Headcount,38
2025-08,Inference Platform,OpEx,684000
2025-08,Engineering,Revenue,0
2025-08,Engineering,COGS,0
2025-08,Engineering,Headcount,117
2025-08,Engineering,OpEx,2574000
2025-08,Sales,Revenue,0
2025-08,Sales,COGS,0
2025-08,Sales,Headcount,43
2025-08,Sales,OpEx,731000
2025-09,GPU Cloud,Revenue,6491627
2025-09,GPU Cloud,COGS,3051065
2025-09,GPU Cloud,Headcount,58
2025-09,GPU Cloud,OpEx,1102000
2025-09,Inference Platform,Revenue,4020532
2025-09,Inference Platform,COGS,1366981
2025-09,Inference Platform,Headcount,39
2025-09,Inference Platform,OpEx,702000
2025-09,Engineering,Revenue,0
2025-09,Engineering,COGS,0
2025-09,Engineering,Headcount,120
2025-09,Engineering,OpEx,2640000
2025-09,Sales,Revenue,0
2025-09,Sales,COGS,0
2025-09,Sales,Headcount,44
2025-09,Sales,OpEx,748000
2025-10,GPU Cloud,Revenue,6852318
2025-10,GPU Cloud,COGS,3152066
2025-10,GPU Cloud,Headcount,60
2025-10,GPU Cloud,OpEx,1140000
2025-10,Inference Platform,Revenue,4245642
2025-10,Inference Platform,COGS,1401062
2025-10,Inference Platform,Headcount,40
2025-10,Inference Platform,OpEx,720000
2025-10,Engineering,Revenue,0
2025-10,Engineering,COGS,0
2025-10,Engineering,Headcount,123
2025-10,Engineering,OpEx,2706000
2025-10,Sales,Revenue,0
2025-10,Sales,COGS,0
2025-10,Sales,Headcount,45
2025-10,Sales,OpEx,765000
2025-11,GPU Cloud,Revenue,7232292
2025-11,GPU Cloud,COGS,3254531
2025-11,GPU Cloud,Headcount,62
2025-11,GPU Cloud,OpEx,1178000
2025-11,Inference Platform,Revenue,4483326
2025-11,Inference Platform,COGS,1434664
2025-11,Inference Platform,Headcount,41
2025-11,Inference Platform,OpEx,738000
2025-11,Engineering,Revenue,0
2025-11,Engineering,COGS,0
2025-11,Engineering,Headcount,126
2025-11,Engineering,OpEx,2772000
2025-11,Sales,Revenue,0
2025-11,Sales,COGS,0
2025-11,Sales,Headcount,46
2025-11,Sales,OpEx,782000
2025-12,GPU Cloud,Revenue,7632725
2025-12,GPU Cloud,COGS,3358359
2025-12,GPU Cloud,Headcount,64
2025-12,GPU Cloud,OpEx,1216000
2025-12,Inference Platform,Revenue,4734281
2025-12,Inference Platform,COGS,1467617
2025-12,Inference Platform,Headcount,42
2025-12,Inference Platform,OpEx,756000
2025-12,Engineering,Revenue,0
2025-12,Engineering,COGS,0
2025-12,Engineering,Headcount,129
2025-12,Engineering,OpEx,2838000
2025-12,Sales,Revenue,0
2025-12,Sales,COGS,0
2025-12,Sales,Headcount,47
2025-12,Sales,OpEx,799000
`;

const forecastMonths = [
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12",
];

function deptMonthly(
  base: Record<string, number>,
  tweaks: Record<string, Record<string, number>> = {},
): { monthly: Record<string, Record<string, number>> } {
  return {
    monthly: Object.fromEntries(
      forecastMonths.map((month) => [month, { ...base, ...tweaks[month] }]),
    ),
  };
}

export const sampleWideCsv = `department,account,2025-01,2025-02,2025-03,2025-04,2025-05,2025-06,2025-07,2025-08,2025-09,2025-10,2025-11,2025-12
GPU Cloud,Revenue,4200000,4435200,4683571,4945841,5222788,5515234,5824057,6149214,6491627,6852318,7232292,7632725
GPU Cloud,COGS,2310000,2395008,2482292,2571837,2663622,2757617,2853788,2951623,3051065,3152066,3254531,3358359
GPU Cloud,Headcount,42,44,46,48,50,52,54,56,58,60,62,64
GPU Cloud,OpEx,798000,836000,874000,912000,950000,988000,1026000,1064000,1102000,1140000,1178000,1216000
Inference Platform,Revenue,2600000,2745600,2899354,3061720,3233180,3414242,3605440,3807339,4020532,4245642,4483326,4734281
Inference Platform,COGS,1092000,1125696,1159742,1194071,1228608,1263260,1297958,1332569,1366981,1401062,1434664,1467617
Inference Platform,Headcount,31,32,33,34,35,36,37,38,39,40,41,42
Inference Platform,OpEx,558000,576000,594000,612000,630000,648000,666000,684000,702000,720000,738000,756000
Engineering,Headcount,96,99,102,105,108,111,114,117,120,123,126,129
Engineering,OpEx,2112000,2178000,2244000,2310000,2376000,2442000,2508000,2574000,2640000,2706000,2772000,2838000
Sales,Headcount,36,37,38,39,40,41,42,43,44,45,46,47
Sales,OpEx,612000,629000,646000,663000,680000,697000,714000,731000,748000,765000,782000,799000
`;

export const defaultScenarios: ScenarioAssumptions[] = [
  {
    name: "Base Case",
    varOverrides: {
      "GPU Cloud": deptMonthly(
        { revenueGrowthRate: 0.035, cogsPctOfRevenue: 0.44, headcountGrowthRate: 0.015, costPerHead: 19000 },
        { "2026-07": { revenueGrowthRate: 0.04 }, "2026-10": { cogsPctOfRevenue: 0.43 } },
      ),
      "Inference Platform": deptMonthly(
        { revenueGrowthRate: 0.035, cogsPctOfRevenue: 0.44, headcountGrowthRate: 0.015, costPerHead: 19000 },
        { "2026-07": { revenueGrowthRate: 0.04 }, "2026-10": { cogsPctOfRevenue: 0.43 } },
      ),
      Engineering: deptMonthly({ headcountGrowthRate: 0.018, costPerHead: 22500 }),
      Sales: deptMonthly({ headcountGrowthRate: 0.02, costPerHead: 18000 }),
    },
  },
  {
    name: "Aggressive Growth",
    varOverrides: {
      "GPU Cloud": deptMonthly(
        { revenueGrowthRate: 0.065, cogsPctOfRevenue: 0.41, headcountGrowthRate: 0.025, costPerHead: 19500 },
      ),
      "Inference Platform": deptMonthly(
        { revenueGrowthRate: 0.055, cogsPctOfRevenue: 0.42, headcountGrowthRate: 0.025, costPerHead: 19500 },
        { "2026-03": { revenueGrowthRate: 0.06 }, "2026-06": { revenueGrowthRate: 0.062 }, "2026-09": { cogsPctOfRevenue: 0.41 } },
      ),
      Engineering: deptMonthly({ headcountGrowthRate: 0.03, costPerHead: 23250 }),
      Sales: deptMonthly({ headcountGrowthRate: 0.035, costPerHead: 19500 }),
    },
  },
  {
    name: "Conservative",
    varOverrides: {
      "GPU Cloud": deptMonthly(
        { revenueGrowthRate: 0.018, cogsPctOfRevenue: 0.47, headcountGrowthRate: 0.006, costPerHead: 18500 },
        { "2026-04": { revenueGrowthRate: 0.012 }, "2026-08": { headcountGrowthRate: 0.002 } },
      ),
      "Inference Platform": deptMonthly(
        { revenueGrowthRate: 0.018, cogsPctOfRevenue: 0.47, headcountGrowthRate: 0.006, costPerHead: 18500 },
        { "2026-04": { revenueGrowthRate: 0.012 }, "2026-08": { headcountGrowthRate: 0.002 } },
      ),
      Engineering: deptMonthly({ headcountGrowthRate: 0.004, costPerHead: 21800 }),
      Sales: deptMonthly({ headcountGrowthRate: 0.005, costPerHead: 18500 }),
    },
  },
];
