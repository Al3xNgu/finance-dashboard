import "server-only";
import type {
  AccountsResult,
  InstitutionData,
  ExchangeResult,
  LinkTokenResult,
  PlaidAccountData,
  PlaidService,
  SyncPage,
} from "./types";

/**
 * In-memory, scriptable PlaidService for unit/integration tests (D-007).
 * Configure canned data per public token; every call is recorded.
 */
export interface FakePlaidItemFixture {
  plaidItemId: string;
  accessToken: string;
  institutionId: string;
  institutionName: string;
  accounts: PlaidAccountData[];
}

export class FakePlaidService implements PlaidService {
  readonly calls: { method: string; args: unknown }[] = [];
  private byPublicToken = new Map<string, FakePlaidItemFixture>();
  private byAccessToken = new Map<string, FakePlaidItemFixture>();
  private institutions = new Map<string, string>();

  addItemFixture(publicToken: string, fixture: FakePlaidItemFixture): void {
    this.byPublicToken.set(publicToken, fixture);
    this.byAccessToken.set(fixture.accessToken, fixture);
    this.institutions.set(fixture.institutionId, fixture.institutionName);
  }

  async createLinkToken(opts: {
    userId: string;
    accessToken?: string;
  }): Promise<LinkTokenResult> {
    this.calls.push({ method: "createLinkToken", args: opts });
    return {
      linkToken: `link-fake-${opts.userId}`,
      expiration: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
    this.calls.push({ method: "exchangePublicToken", args: publicToken });
    const fixture = this.byPublicToken.get(publicToken);
    if (!fixture) throw new Error(`FakePlaid: unknown public token`);
    return {
      accessToken: fixture.accessToken,
      plaidItemId: fixture.plaidItemId,
    };
  }

  async getAccounts(accessToken: string): Promise<AccountsResult> {
    this.calls.push({ method: "getAccounts", args: accessToken });
    const fixture = this.byAccessToken.get(accessToken);
    if (!fixture) throw new Error(`FakePlaid: unknown access token`);
    return {
      institutionId: fixture.institutionId,
      accounts: fixture.accounts,
    };
  }

  async getInstitution(institutionId: string): Promise<InstitutionData> {
    this.calls.push({ method: "getInstitution", args: institutionId });
    const name = this.institutions.get(institutionId);
    if (!name) throw new Error(`FakePlaid: unknown institution`);
    return { institutionId, name };
  }

  async removeItem(accessToken: string): Promise<void> {
    this.calls.push({ method: "removeItem", args: accessToken });
  }

  /**
   * Sync scripting: pages are keyed by the cursor that requests them
   * (null-cursor key is ""). A page may instead be an Error to throw —
   * lets tests simulate TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION etc.
   */
  private syncPages = new Map<string, SyncPage | Error>();

  scriptSyncPage(cursor: string | null, page: SyncPage | Error): void {
    this.syncPages.set(cursor ?? "", page);
  }

  async syncTransactions(
    accessToken: string,
    cursor: string | null,
  ): Promise<SyncPage> {
    this.calls.push({ method: "syncTransactions", args: { accessToken, cursor } });
    const page = this.syncPages.get(cursor ?? "");
    if (!page) {
      // default: empty caught-up page
      return {
        added: [],
        modified: [],
        removed: [],
        accounts: [],
        nextCursor: cursor ?? "cursor-0",
        hasMore: false,
      };
    }
    if (page instanceof Error) {
      // one-shot error: next call with the same cursor proceeds
      this.syncPages.delete(cursor ?? "");
      throw page;
    }
    return page;
  }

  webhookValid = true;

  async verifyWebhook(): Promise<boolean> {
    this.calls.push({ method: "verifyWebhook", args: null });
    return this.webhookValid;
  }
}
