import "server-only";

/**
 * PlaidService boundary (ARCHITECTURE.md §6.2, D-007). Business logic depends
 * on this interface and these DTOs only — the Plaid SDK never leaks upward.
 * Sync and webhook-verification methods join the interface in M3.
 */
export interface LinkTokenResult {
  linkToken: string;
  expiration: string;
}

export interface PlaidAccountData {
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: bigint | null;
  availableBalanceCents: bigint | null;
  isoCurrencyCode: string;
}

export interface ExchangeResult {
  accessToken: string;
  plaidItemId: string;
}

export interface AccountsResult {
  institutionId: string | null;
  accounts: PlaidAccountData[];
}

export interface InstitutionData {
  institutionId: string;
  name: string;
}

export interface PlaidService {
  createLinkToken(opts: {
    userId: string;
    /** decrypted access token — presence switches Link to update mode (M7) */
    accessToken?: string;
  }): Promise<LinkTokenResult>;
  exchangePublicToken(publicToken: string): Promise<ExchangeResult>;
  getAccounts(accessToken: string): Promise<AccountsResult>;
  getInstitution(institutionId: string): Promise<InstitutionData>;
  removeItem(accessToken: string): Promise<void>;
}
