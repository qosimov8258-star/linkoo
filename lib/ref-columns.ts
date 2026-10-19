/** Column widths measured from the reference app, keyed by route. */
export const REF_COLUMNS: Record<string, { n: number; cols: string; inset?: number }> = {
  "/clients": {
    "n": 9,
    "cols": "182px 182px 170px 85px 170px 122px 122px 97px minmax(0,1fr)"
  },
  "/clients/financial-accounts": {
    "n": 4,
    "cols": "103px 412px 412px minmax(0,1fr)"
  },
  "/clients/telegram-users": {
    "n": 8,
    "cols": "minmax(0,123fr) minmax(0,231fr) minmax(0,231fr) minmax(0,230fr) minmax(0,116fr) minmax(0,230fr) minmax(0,120fr) minmax(0,103fr)",
    "inset": 22
  },
  "/clients/restrictions": {
    "n": 2,
    "cols": "618px minmax(0,1fr)"
  },
  "/analytics/sales": {
    "n": 10,
    "cols": "85px 195px 170px 122px 146px 97px 97px 122px 109px minmax(0,1fr)"
  },
  "/analytics/returns": {
    "n": 10,
    "cols": "59px 214px 118px 118px 138px 147px 147px 147px 150px minmax(0,1fr)"
  },
  "/analytics/refusals": {
    "n": 5,
    "cols": "103px 309px 309px 309px minmax(0,1fr)"
  },
  "/analytics/marketing-campaigns": {
    "n": 5,
    "cols": "103px 515px 206px 206px minmax(0,1fr)"
  },
  "/analytics/client-bonuses": {
    "n": 5,
    "cols": "103px 618px 206px minmax(0,1fr) minmax(0,1fr)"
  },
  "/analytics/kpi-tasks": {
    "n": 6,
    "cols": "103px 206px 412px 206px 206px minmax(0,1fr)"
  },
  "/analytics/tasks": {
    "n": 6,
    "cols": "103px 206px 103px 206px minmax(0,1fr) minmax(0,1fr)"
  },
  "/analytics/goods-movement": {
    "n": 6,
    "cols": "412px 103px 103px 206px 206px minmax(0,1fr)"
  },
  "/analytics/inventory": {
    "n": 7,
    "cols": "103px 206px 206px 206px 206px 206px minmax(0,1fr)"
  },
  "/analytics/customer-payments": {
    "n": 11,
    "cols": "37px 148px 124px 124px 124px 124px 124px 124px 124px 62px minmax(0,1fr)"
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
    "cols": "103px 206px 206px 206px 206px 206px minmax(0,1fr)"
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
