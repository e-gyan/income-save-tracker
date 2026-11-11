# Security Specification: Income Allocation and Finance Tracker

## 1. Data Invariants

1. **User Data Isolation**: All documents reside under `/users/{userId}/...`. A user can strictly only read, create, update, or delete records where `{userId}` matches `request.auth.uid`.
2. **Owner Identity Guarantee**: The document `userId` field must match `request.auth.uid` on write.
3. **Non-Negative Financial Bounds**: All financial amounts (`grossAmount`, `subscriptionFee`, `dataBundleFee`, `projectBuildingsRate`, `amount`, `expectedGross`, `expectedReceiptCount`) must be numeric and non-negative.
4. **String and ID Boundary Guard**: All document IDs and string fields must satisfy strict size constraints (`size() <= maxLength`) to prevent denial-of-wallet resource attacks.
5. **Deductions Audit Coherence**: Mandatory cuts rates cannot exceed 100% in configuration.
6. **Temporal Invariants**: Timestamps on creation must be valid and immutable during updates.
7. **Action Authorization**: Unauthenticated callers are strictly denied across all paths.

## 2. The Dirty Dozen Payloads

1. **Identity Spoofing on Settings**: Write to `/users/alice/settings/config` with `request.auth.uid = 'bob'`. (Result: PERMISSION_DENIED)
2. **Ghost Field Poisoning on Income**: Income payload containing hidden `isAdmin: true` or malicious shadow keys. (Result: PERMISSION_DENIED)
3. **Negative Gross Income**: Income payload with `grossAmount: -5000`. (Result: PERMISSION_DENIED)
4. **Excessive String Payload**: Income payload where `clientOrSource` exceeds 500 characters. (Result: PERMISSION_DENIED)
5. **Path ID Traversal Attack**: Writing to path `/users/{userId}/incomes/../../../evil`. (Result: PERMISSION_DENIED via `isValidId`)
6. **Cross-User Income Sniffing**: Reading `/users/alice/incomes` as unauthenticated user or user `bob`. (Result: PERMISSION_DENIED)
7. **Negative Deduction Fee**: Writing `subscriptionFee: -100` in Settings. (Result: PERMISSION_DENIED)
8. **Negative Flexible Expense**: Writing `amount: -250` in flexible expenses. (Result: PERMISSION_DENIED)
9. **Negative Receipt Count in Forecast**: Writing `expectedReceiptCount: -3` in Forecast. (Result: PERMISSION_DENIED)
10. **Tampering With User ID in Income Update**: Trying to alter `userId` from `alice` to `bob` on update. (Result: PERMISSION_DENIED)
11. **Blanket Collection Scraping**: Querying collection without authenticated owner context. (Result: PERMISSION_DENIED)
12. **Tampering With Revision Snapshot History**: Attempting to forge another user's revision audit record. (Result: PERMISSION_DENIED)
