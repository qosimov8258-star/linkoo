/** Column widths measured from the reference app, keyed by route. */
export const REF_COLUMNS: Record<string, { n: number; cols: string; inset?: number }> = {
  "/analytics/expected-payments": {
    "n": 7,
    "cols": "123.3px 230.7px 230.7px 115.3px 231px 230px 231px",
    "inset": 22
  },
  "/analytics/price-formation": {
    "n": 6,
    "cols": "469.3px 230.7px 230.7px 115.3px 230.6px 126px",
    "inset": 22
  },
  "/analytics/surveys": {
    "n": 4,
    "cols": "minmax(0,123fr) minmax(0,577fr) minmax(0,346fr) minmax(0,376fr)",
    "inset": 22
  },
  "/analytics/survey-plans": {
    "n": 2,
    "cols": "700px minmax(0,1fr)",
    "inset": 22
  },
  "/analytics/draft-orders": {
    "n": 8,
    "cols": "123px 116px 230px 116px 230px 231px 230px minmax(0,1fr)",
    "inset": 22
  },
  "/clients": {
    "n": 9,
    "cols": "182px 182px 170px 85px 170px 122px 122px 97px minmax(0,1fr)"
  },
  "/clients/financial-accounts": {
    "n": 4,
    "cols": "minmax(0,123.3fr) minmax(0,461.3fr) minmax(0,461.3fr) minmax(0,346.1fr)",
    "inset": 22
  },
  "/clients/telegram-users": {
    "n": 8,
    "cols": "minmax(0,123.3fr) minmax(0,230.7fr) minmax(0,230.6fr) minmax(0,230.7fr) minmax(0,115.3fr) minmax(0,230.7fr) minmax(0,127.7fr) minmax(0,103fr)",
    "inset": 22
  },
  "/clients/restrictions": {
    "n": 2,
    "cols": "minmax(0,700fr) minmax(0,692fr)",
    "inset": 22
  },
  "/clients/client-restrictions": {
    "n": 2,
    "cols": "minmax(0,700fr) minmax(0,692fr)",
    "inset": 22
  },
  "/analytics/sales": {
    "n": 10,
    "cols": "85px 195px 170px 122px 146px 97px 97px 122px 109px minmax(0,1fr)"
  },
  "/analytics/returns": {
    "n": 9,
    "cols": "59.3px 241.2px 133.2px 133.2px 154.8px 165.6px 165.6px 165.6px 165.6px"
  },
  "/analytics/refusals": {
    "n": 5,
    "cols": "minmax(0,1fr) minmax(0,3fr) minmax(0,3fr) minmax(0,3fr) minmax(0,2fr)"
  },
  "/analytics/marketing-campaigns": {
    "n": 5,
    "cols": "minmax(0,1fr) minmax(0,5fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr)"
  },
  "/analytics/client-bonuses": {
    "n": 4,
    "cols": "123px 692px 231px minmax(0,1fr)",
    "inset": 22
  },
  "/analytics/salary-planning": {
    "n": 5,
    "cols": "391px 193px 205px 141px minmax(0,1fr)",
    "inset": 22
  },
  "/analytics/kpi-tasks": {
    "n": 6,
    "cols": "123.3px 230.7px 461.3px 230.7px 230.7px minmax(0,1fr)",
    "inset": 22
  },
  "/analytics/tasks": {
    "n": 6,
    "cols": "103px 206px 103px 206px minmax(0,1fr) minmax(0,1fr)"
  },
  "/analytics/goods-movement": {
    "n": 6,
    "cols": "412px 103px 103px 206px 206px minmax(0,1fr)"
  },
  "/analytics/repricing": {
    "n": 6,
    "cols": "103px 309px 309px 206px 206px minmax(0,1fr)"
  },
  "/analytics/internal-transfers": {
    "n": 8,
    "cols": "103px 206px 206px 206px 103px 103px 206px minmax(0,1fr)"
  },
  "/analytics/inventory-management": {
    "n": 7,
    "cols": "123px 231px 231px 230px 231px 239px minmax(0,1fr)",
    "inset": 22
  },
  "/analytics/expected-expenses": {
    "n": 7,
    "cols": "87px 247px 173px 124px 148px 124px minmax(0,1fr)"
  },
  "/analytics/receipt-transfer-plan": {
    "n": 5,
    "cols": "206px 412px 206px 206px minmax(0,1fr)"
  }
}
