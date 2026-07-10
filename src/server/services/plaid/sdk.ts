import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type Transaction as PlaidTransaction,
} from "plaid";
import { dollarsToCents, nullableDollarsToCents } from "@/server/lib/money";
import { toPlaidApiError } from "./errors";
import type {
  AccountsResult,
  InstitutionData,
  ExchangeResult,
  LinkTokenResult,
  PlaidService,
  PlaidTransactionData,
  SyncPage,
} from "./types";

export interface PlaidSdkConfig {
  clientId: string;
  secret: string;
  environment: "sandbox" | "production";
  webhookUrl?: string;
}

/**
 * Real PlaidService. Environment switching is config-only (§6.1). Failures
 * surface as PlaidApiError with retryable/re-auth/fatal classification (§6.7).
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

  const verificationKeyCache = new Map<string, JWK>();

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
        throw toPlaidApiError(err);
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
        throw toPlaidApiError(err);
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
        throw toPlaidApiError(err);
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
        throw toPlaidApiError(err);
      }
    },

    async removeItem(accessToken): Promise<void> {
      try {
        await client.itemRemove({ access_token: accessToken });
      } catch (err) {
        throw toPlaidApiError(err);
      }
    },

    async syncTransactions(accessToken, cursor): Promise<SyncPage> {
      try {
        const res = await client.transactionsSync({
          access_token: accessToken,
          ...(cursor ? { cursor } : {}),
          count: 100,
        });
        const mapTxn = (t: PlaidTransaction): PlaidTransactionData => ({
          plaidTransactionId: t.transaction_id,
          plaidAccountId: t.account_id,
          pendingTransactionId: t.pending_transaction_id ?? null,
          amountCents: dollarsToCents(t.amount),
          isoCurrencyCode: t.iso_currency_code ?? "USD",
          date: t.date,
          authorizedDate: t.authorized_date ?? null,
          name: t.name,
          merchantName: t.merchant_name ?? null,
          pending: t.pending,
          pfcPrimary: t.personal_finance_category?.primary ?? null,
          pfcDetailed: t.personal_finance_category?.detailed ?? null,
        });
        return {
          added: res.data.added.map(mapTxn),
          modified: res.data.modified.map(mapTxn),
          removed: res.data.removed.map((r) => ({
            plaidTransactionId: r.transaction_id,
          })),
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
          nextCursor: res.data.next_cursor,
          hasMore: res.data.has_more,
        };
      } catch (err) {
        throw toPlaidApiError(err);
      }
    },

    async verifyWebhook(rawBody, headers): Promise<boolean> {
      return verifyPlaidWebhook(client, rawBody, headers, verificationKeyCache);
    },
  };
}

/**
 * Plaid webhook verification: the Plaid-Verification header is an ES256 JWT
 * whose request_body_sha256 claim must match the raw body. Keys are fetched
 * via /webhook_verification_key/get and cached by kid.
 * https://plaid.com/docs/api/webhooks/webhook-verification/
 */
async function verifyPlaidWebhook(
  client: PlaidApi,
  rawBody: string,
  headers: Headers,
  keyCache: Map<string, JWK>,
): Promise<boolean> {
  try {
    const jwt = headers.get("plaid-verification");
    if (!jwt) return false;

    const header = decodeProtectedHeader(jwt);
    if (header.alg !== "ES256" || typeof header.kid !== "string") return false;

    let jwk = keyCache.get(header.kid);
    if (!jwk) {
      const res = await client.webhookVerificationKeyGet({
        key_id: header.kid,
      });
      jwk = res.data.key as unknown as JWK;
      keyCache.set(header.kid, jwk);
    }

    const { payload } = await jwtVerify(jwt, await importJWK(jwk, "ES256"), {
      maxTokenAge: "5 minutes",
    });

    const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
    const claimed = payload.request_body_sha256;
    return (
      typeof claimed === "string" &&
      claimed.length === bodyHash.length &&
      timingSafeEqual(Buffer.from(claimed, "utf8"), Buffer.from(bodyHash, "utf8"))
    );
  } catch {
    return false;
  }
}
