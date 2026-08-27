type UserRow = {
  id: string;
  name: string;
  email: string;
  balance: string;
  role: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type TransactionRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount: string;
  status: string;
  failure_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  failed_at: Date | string | null;
};

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function toNullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

export function serializeUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    balance: row.balance,
    role: row.role,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export function serializeTransaction(row: TransactionRow) {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    amount: row.amount,
    status: row.status,
    failureCode: row.failure_code,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: toNullableIso(row.completed_at),
    failedAt: toNullableIso(row.failed_at)
  };
}
