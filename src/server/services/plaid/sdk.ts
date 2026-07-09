import "server-only";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";
import { UpstreamError } from "@/server/lib/errors";
import { nullableDollarsToCents } from "@/server/lib/money";
import type {
  AccountsResult,
  InstitutionData,
  ExchangeResult,
  LinkTokenResult,
  PlaidService,
} from "./types";

export interface PlaidSdkConfig {
  clientId: string;
  secret: string;
  environment: "sandbox" | "production";
  webhookUrl?: string;
}

/**
 * Real PlaidService. Environment switching is config-only (§6.1). Full error
 * classification (retryable / re-auth / fatal) lands with sync in M3; until
 * then failures surface as UpstreamError carrying the Plaid error code.
 */
export function createPlaidSdkService(cfg: PlaidSdkConfig): PlaidService {
  const client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[cfg.environment],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": cfg.clientId,
          "PLAID-SECRET": cfg.secret,
        },
      },
    }),
  );

  function toUpstreamError(err: unknown): UpstreamError {
    const data =
      err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { error_code?: string } } }).response
            ?.data
        : undefined;
    const code = data?.error_code ?? "PLAID_ERROR";
    // cause carries the Plaid error body for logs; publicMessage stays generic
    return new UpstreamError(`Bank connection service failed (${code}).`, {
      cause: data ?? err,
    });
  }

  return {
    async createLinkToken({ userId, accessToken }): Promise<LinkTokenResult> {
      try {
        const res = await client.linkTokenCreate({
          user: { client_user_id: userId },
          client_name: "Finance Dashboard",
          language: "en",
          country_codes: [CountryCode.Us],
          // update mode re-authenticates an existing Item; products only for new links
          ...(accessToken
            ? { access_token: accessToken }
            : {
                products: [Products.Transactions],
                transactions: { days_requested: 365 },
              }),
          ...(cfg.webhookUrl ? { webhook: cfg.webhookUrl } : {}),
        });
        return {
          linkToken: res.data.link_token,
          expiration: res.data.expiration,
        };
      } catch (err) {
        throw toUpstreamError(err);
      }
    },

    async exchangePublicToken(publicToken): Promise<ExchangeResult> {
      try {
        const res = await client.itemPublicTokenExchange({
          public_token: publicToken,
        });
        return {
          accessToken: res.data.access_token,
          plaidItemId: res.data.item_id,
        };
      } catch (err) {
        throw toUpstreamError(err);
      }
    },

    async getAccounts(accessToken): Promise<AccountsResult> {
      try {
        const res = await client.accountsGet({ access_token: accessToken });
        return {
          institutionId: res.data.item.institution_id ?? null,
          accounts: res.data.accounts.map((a) => ({
            plaidAccountId: a.account_id,
            name: a.name,
            officialName: a.official_name ?? null,
            mask: a.mask ?? null,
            type: a.type,
            subtype: a.subtype ?? null,
            currentBalanceCents: nullableDollarsToCents(a.balances.current),
            availableBalanceCents: nullableDollarsToCents(a.balances.available),
            isoCurrencyCode: a.balances.iso_currency_code ?? "USD",
          })),
        };
      } catch (err) {
        throw toUpstreamError(err);
      }
    },

    async getInstitution(institutionId): Promise<InstitutionData> {
      try {
        const res = await client.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        return {
          institutionId,
          name: res.data.institution.name,
        };
      } catch (err) {
        throw toUpstreamError(err);
      }
    },

    async removeItem(accessToken): Promise<void> {
      try {
        await client.itemRemove({ access_token: accessToken });
      } catch (err) {
        throw toUpstreamError(err);
      }
    },
  };
}
