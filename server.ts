import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;
const FIREBASE_PROJECT_ID =
  process.env.VITE_FIREBASE_PROJECT_ID || 'gen-lang-client-0061014295';

// Reverse-proxy Firebase Auth handler routes (/__/auth/* and /__/firebase/*)
// so same-origin OAuth redirects and popups resolve cleanly on Render.
app.use(['/__/auth', '/__/firebase'], async (req: Request, res: Response) => {
  try {
    const targetUrl = `https://${FIREBASE_PROJECT_ID}.firebaseapp.com${req.originalUrl}`;
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'user-agent': req.headers['user-agent'] || 'SaveNKnow-Auth-Proxy',
        accept: req.headers['accept'] || '*/*',
      },
      redirect: 'manual',
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        lower !== 'content-encoding' &&
        lower !== 'transfer-encoding' &&
        lower !== 'connection'
      ) {
        res.setHeader(key, value);
      }
    });

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Firebase auth proxy error:', err);
    res.status(502).send('Authentication proxy error');
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Real-Time Market Exchange Rate Sync Service (2-Point Floating Precision)
 * Baseline USD market rates used only if upstream FX providers are unreachable.
 */
const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  GHS: 15.85,
  NGN: 1620.0,
  KES: 129.5,
  ZAR: 18.15,
  CAD: 1.39,
  AUD: 1.53,
};

interface CachedFxEntry {
  base: string;
  rates: Record<string, number>;
  updatedAt: string;
  timestamp: number;
  source: 'live_market' | 'fallback_market';
}

const fxCache = new Map<string, CachedFxEntry>();
const FX_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function round2dp(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

function buildFallbackRatesForBase(base: string): Record<string, number> {
  const upperBase = (base || 'USD').toUpperCase();
  const basePerUsd = FALLBACK_USD_RATES[upperBase] || 1.0;
  const result: Record<string, number> = {};
  for (const [code, usdRate] of Object.entries(FALLBACK_USD_RATES)) {
    if (code === upperBase) {
      result[code] = 1.0;
    } else {
      result[code] = Number((usdRate / basePerUsd).toFixed(6));
    }
  }
  return result;
}

app.get('/api/fx/rates', async (req: Request, res: Response) => {
  const base = String(req.query.base || 'USD')
    .trim()
    .toUpperCase();
  const now = Date.now();
  const cached = fxCache.get(base);

  if (cached && now - cached.timestamp < FX_CACHE_TTL_MS) {
    const rates2dp: Record<string, number> = {};
    for (const [k, v] of Object.entries(cached.rates)) {
      rates2dp[k] = round2dp(v);
    }
    return res.json({
      success: true,
      base: cached.base,
      rates: cached.rates,
      rates2dp,
      updatedAt: cached.updatedAt,
      source: cached.source,
    });
  }

  const providers = [
    `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
    `https://api.exchangerate-api.com/v4/latest/${encodeURIComponent(base)}`,
  ];

  for (const url of providers) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data: any = await response.json();
        const rawRates = data?.rates || data?.conversion_rates;
        if (rawRates && typeof rawRates === 'object') {
          const normalizedRates: Record<string, number> = {
            ...buildFallbackRatesForBase(base),
          };
          for (const [code, val] of Object.entries(rawRates)) {
            const num = Number(val);
            if (Number.isFinite(num) && num > 0) {
              normalizedRates[code.toUpperCase()] = num;
            }
          }
          normalizedRates[base] = 1.0;

          const entry: CachedFxEntry = {
            base,
            rates: normalizedRates,
            updatedAt: new Date().toISOString(),
            timestamp: now,
            source: 'live_market',
          };
          fxCache.set(base, entry);

          const rates2dp: Record<string, number> = {};
          for (const [k, v] of Object.entries(normalizedRates)) {
            rates2dp[k] = round2dp(v);
          }

          return res.json({
            success: true,
            base,
            rates: normalizedRates,
            rates2dp,
            updatedAt: entry.updatedAt,
            source: entry.source,
          });
        }
      }
    } catch {
      // Try next provider
    }
  }

  const fallbackRates = buildFallbackRatesForBase(base);
  const fallbackRates2dp: Record<string, number> = {};
  for (const [k, v] of Object.entries(fallbackRates)) {
    fallbackRates2dp[k] = round2dp(v);
  }

  return res.json({
    success: true,
    base,
    rates: fallbackRates,
    rates2dp: fallbackRates2dp,
    updatedAt: new Date().toISOString(),
    source: 'fallback_market',
  });
});

/**
 * Multi-Turn Deduction & Financial Intelligence Chat Route
 */
app.post('/api/ai/chat-deductions', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { messages = [], modelTier = 'general', financialContext = {} } = req.body;

    const selectedModel =
      modelTier === 'fast' ? 'gemini-3.1-flash-lite' : 'gemini-3.8-flash';

    const systemInstruction = `
You are the Deduction & Financial Intelligence Agent for Save N Know.
Your role is to learn from the user's income records, defined deductions, quarterly savings rates (Q1, Q2, Q3, Q4), savings vault splits, and expense categories/subcategories (such as Giving & Speaking -> Givings for "Others to support"), and suggest accurate deductions or records for the user to select and record.
Keep all statements and sentences simple, clear, and brief within a professional financial context.

Current User Ledger Summary:
${JSON.stringify(financialContext, null, 2)}
`;

    const formattedHistory = Array.isArray(messages)
      ? messages
          .slice(0, -1)
          .filter((m: any) => m && typeof m.content === 'string' && m.content.trim())
          .map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }))
      : [];

    const latestUserMessage =
      Array.isArray(messages) && messages.length > 0
        ? String(messages[messages.length - 1]?.content || '')
        : 'Analyze my deductions across the board and suggest what I should select and record.';

    const chat = ai.chats.create({
      model: selectedModel,
      history: formattedHistory,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description:
                'Simple, clear, brief professional response summarizing what was learned and recommended.',
            },
            suggestions: {
              type: Type.ARRAY,
              description:
                'Optional actionable deduction rules or records the user can select and record.',
              items: {
                type: Type.OBJECT,
                properties: {
                  kind: {
                    type: Type.STRING,
                    description:
                      'One of: apply_deduction_rule, record_income, record_expense',
                  },
                  title: {
                    type: Type.STRING,
                    description: 'Short label for the suggestion.',
                  },
                  summary: {
                    type: Type.STRING,
                    description: 'Brief rate/amount and category summary.',
                  },
                  reason: {
                    type: Type.STRING,
                    description: 'Short explanation of how this was learned from user data.',
                  },
                  name: {
                    type: Type.STRING,
                    description: 'Deduction name, income source, or expense recipient.',
                  },
                  deductionType: {
                    type: Type.STRING,
                    description: 'percentage or fixed',
                  },
                  amount: {
                    type: Type.NUMBER,
                    description: 'Numeric percentage rate or amount.',
                  },
                  routeTo: {
                    type: Type.STRING,
                    description: 'expense or savings_split',
                  },
                  expenseCategory: {
                    type: Type.STRING,
                    description: 'Matched expense category name.',
                  },
                  expenseSubcategory: {
                    type: Type.STRING,
                    description: 'Matched expense subcategory name.',
                  },
                },
              },
            },
          },
        },
      },
    });

    const response = await chat.sendMessage({
      message: latestUserMessage,
    });

    const rawText = (response.text ?? '{}').trim();
    let parsed: { reply?: string; suggestions?: any[] } = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { reply: rawText, suggestions: [] };
    }

    res.json({
      success: true,
      reply:
        parsed.reply ||
        'I have reviewed your deduction patterns and prepared suggestions below.',
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      modelUsed: selectedModel,
    });
  } catch (error: any) {
    console.error('Gemini Chat Deductions Error:', error);
    res.status(500).json({
      success: false,
      error:
        error.message ||
        'Unable to reach the Gemini service right now. Local learned suggestions remain available.',
    });
  }
});

/**
 * Intelligent Financial Advisor Route
 */
app.post('/api/ai/advisor', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { financialState, userQuery, driveFolderContext, attachedDocuments } = req.body;

    const systemInstruction = `
You are a senior financial advisor and strategic capital allocation specialist reviewing a financial ledger.
Maintain a formal, insightful, clear financial tone. Keep sentences simple, clear, and brief.
STRICT RULE: DO NOT USE ANY EMOJIS, ICONS, OR INFORMAL PUNCTUATION. Use clean, professional grammar.
`;

    const allDocs = [
      ...(driveFolderContext?.documents || []),
      ...(attachedDocuments || []),
    ];

    const textDocs = allDocs.filter((d: any) => !d.base64Data || d.mimeType !== 'application/pdf');
    const pdfDocs = allDocs.filter((d: any) => d.base64Data && d.mimeType === 'application/pdf');

    const folderTitle = driveFolderContext?.folderName ? ` (Folder: "${driveFolderContext.folderName}")` : '';

    const textDocsBlock =
      textDocs.length > 0
        ? `\n\nExternal Financial Documents & Context${folderTitle}:\n` +
          textDocs
            .map(
              (doc: any, i: number) =>
                `Document ${i + 1} [${doc.title}] (${(doc.fileType || doc.mimeType || 'doc').toUpperCase()}):\n${doc.snippet || doc.content || 'Content provided in context.'}`
            )
            .join('\n\n')
        : '';

    const textPrompt = `
Analyze the following financial state and strategic documents to answer the inquiry:

User Financial Snapshot:
${JSON.stringify(financialState, null, 2)}
${textDocsBlock}

${pdfDocs.length > 0 ? `Note: ${pdfDocs.length} attached PDF document(s) [${pdfDocs.map((p: any) => p.title).join(', ')}] are provided directly to this request.\n` : ''}
User Inquiry / Focus Area:
${userQuery || 'Provide an executive financial health analysis, deduction efficiency check, and account balance review.'}
`;

    const contents: any[] = [{ text: textPrompt }];

    for (const pdf of pdfDocs) {
      if (pdf.base64Data) {
        contents.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: pdf.base64Data,
          },
        });
      }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
      },
    });

    res.json({
      success: true,
      analysis: response.text || 'Analysis generated successfully.',
      modelUsed: 'gemini-3.8-flash',
    });
  } catch (error: any) {
    console.error('Gemini Advisor Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate intelligent financial analysis.',
    });
  }
});

/**
 * Natural Language Income Parser Route
 */
app.post('/api/ai/parse-income', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { textInput, defaultCurrency } = req.body;

    if (!textInput || typeof textInput !== 'string') {
      return res.status(400).json({ success: false, error: 'Text input is required.' });
    }

    const prompt = `
Extract income entry parameters from the following natural language sentence:
Sentence: "${textInput}"
Default currency: ${defaultCurrency || 'GHS'}
Current year: ${new Date().getFullYear()}

Return STRICTLY a JSON object with this exact shape:
{
  "clientOrSource": "string (name of client or payer)",
  "grossAmount": number (numeric value only),
  "date": "YYYY-MM-DD (format)",
  "category": "string (e.g. Consulting, Salary, Retainer, Sales, Project)",
  "receiptId": "string (or empty if not provided)",
  "notes": "string (brief summary or empty)"
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsedJson = JSON.parse(response.text?.trim() || '{}');
    res.json({ success: true, data: parsedJson });
  } catch (error: any) {
    console.error('Gemini Parser Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to parse natural language income receipt.',
    });
  }
});

/**
 * Helper to split a single CSV/TSV line respecting quoted fields
 */
function parseDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function detectCurrencyAndCleanNumber(
  rawVal: any,
  fallbackCurrency: string
): { amount: number; currency: string } {
  if (typeof rawVal === 'number') {
    return {
      amount: round2dp(rawVal),
      currency: fallbackCurrency.toUpperCase(),
    };
  }
  const str = String(rawVal || '').trim();
  let detectedCurr = fallbackCurrency.toUpperCase();
  const upper = str.toUpperCase();
  const codes = ['GHS', 'USD', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR', 'CAD', 'AUD'];
  for (const code of codes) {
    if (upper.includes(code)) {
      detectedCurr = code;
      break;
    }
  }
  if (detectedCurr === fallbackCurrency.toUpperCase()) {
    if (str.includes('GH₵') || str.includes('₵')) detectedCurr = 'GHS';
    else if (str.includes('€')) detectedCurr = 'EUR';
    else if (str.includes('£')) detectedCurr = 'GBP';
    else if (str.includes('₦')) detectedCurr = 'NGN';
    else if (str.includes('$')) detectedCurr = 'USD';
  }
  const numericStr = str.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(numericStr);
  return {
    amount: Number.isFinite(parsed) ? round2dp(parsed) : 0,
    currency: detectedCurr,
  };
}

function normalizeDateString(rawDate: any): string {
  const today = new Date().toISOString().split('T')[0];
  if (!rawDate) return today;
  const s = String(rawDate).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return today;
}

function getQuarterFromDateStr(dateStr: string): 'Q1' | 'Q2' | 'Q3' | 'Q4' {
  const month = parseInt(dateStr.split('-')[1] || '1', 10);
  if (month <= 3) return 'Q1';
  if (month <= 6) return 'Q2';
  if (month <= 9) return 'Q3';
  return 'Q4';
}

function convertServer2dp(
  amount: number,
  fromCurr: string,
  toCurr: string,
  ratesForBase: Record<string, number>,
  baseCurr: string
): { convertedAmount: number; exchangeRate2dp: number } {
  const from = (fromCurr || baseCurr || 'USD').toUpperCase();
  const to = (toCurr || baseCurr || 'USD').toUpperCase();
  const cleanAmt = round2dp(amount);
  if (from === to) {
    return { convertedAmount: cleanAmt, exchangeRate2dp: 1.0 };
  }
  const base = (baseCurr || 'USD').toUpperCase();
  let rawRate = 1.0;
  if (from === base && ratesForBase[to]) {
    rawRate = ratesForBase[to];
  } else if (to === base && ratesForBase[from]) {
    rawRate = 1 / ratesForBase[from];
  } else if (ratesForBase[from] && ratesForBase[to]) {
    rawRate = ratesForBase[to] / ratesForBase[from];
  }
  const rate2dp = round2dp(rawRate) > 0 ? round2dp(rawRate) : Number(rawRate.toFixed(4));
  const multiplier = rate2dp >= 0.01 ? rate2dp : rawRate;
  return {
    convertedAmount: round2dp(cleanAmt * multiplier),
    exchangeRate2dp: rate2dp,
  };
}

/**
 * Seamless File Import & Record Normalization Endpoint (`POST /api/import/parse`)
 * Supports CSV, TSV, JSON, TXT, MD, PDF, and BAK (.bak) backup files.
 * Automatically converts currencies at 2-point floating market rates and syncs with the app's ledger architecture.
 */
app.post('/api/import/parse', async (req: Request, res: Response) => {
  try {
    const {
      fileName = 'import.csv',
      mimeType = 'text/csv',
      content = '',
      base64Data = '',
      isBase64 = false,
      baseCurrency = 'USD',
      accounts = [],
    } = req.body || {};

    const upperBase = String(baseCurrency || 'USD').trim().toUpperCase();
    const cachedFx = fxCache.get(upperBase);
    const activeRates = cachedFx?.rates || buildFallbackRatesForBase(upperBase);

    const defaultAccount =
      (Array.isArray(accounts) &&
        (accounts.find((a: any) => a.isDefaultDeposit && !a.isVirtual) ||
          accounts.find((a: any) => !a.isVirtual) ||
          accounts[0])) || { id: 'acc-main-op', name: 'Main Operating Account', currency: upperBase };

    const matchAccountId = (accountHint: any): { id: string; currency: string } => {
      if (!accountHint || !Array.isArray(accounts) || accounts.length === 0) {
        return {
          id: defaultAccount.id || 'acc-main-op',
          currency: (defaultAccount.currency || upperBase).toUpperCase(),
        };
      }
      const hint = String(accountHint).trim().toLowerCase();
      const found = accounts.find(
        (a: any) =>
          String(a.id || '').toLowerCase() === hint ||
          String(a.name || '').toLowerCase() === hint ||
          String(a.name || '').toLowerCase().includes(hint) ||
          hint.includes(String(a.name || '').toLowerCase())
      );
      if (found) {
        return {
          id: found.id,
          currency: (found.currency || upperBase).toUpperCase(),
        };
      }
      return {
        id: defaultAccount.id || 'acc-main-op',
        currency: (defaultAccount.currency || upperBase).toUpperCase(),
      };
    };

    const parsedIncomes: any[] = [];
    const parsedExpenses: any[] = [];
    const parsedAccounts: any[] = [];
    const parsedTransfers: any[] = [];

    const normalizeRawRecord = (raw: any, explicitType?: string) => {
      if (!raw || typeof raw !== 'object') return;
      const recordType = String(
        explicitType ||
          raw.recordType ||
          raw.type ||
          raw.kind ||
          raw.entryType ||
          ''
      )
        .trim()
        .toLowerCase();

      // 1. Account record
      if (
        recordType === 'account' ||
        raw.initialBalance !== undefined ||
        (raw.institution && raw.name && raw.grossAmount === undefined && raw.amount === undefined)
      ) {
        const rawBal =
          raw.originalInitialBalance ??
          raw.initialBalance ??
          raw.balance ??
          raw.openingBalance ??
          0;
        const { amount: nativeBal, currency: accCurr } = detectCurrencyAndCleanNumber(
          rawBal,
          raw.currency || upperBase
        );
        const { convertedAmount, exchangeRate2dp } = convertServer2dp(
          nativeBal,
          accCurr,
          upperBase,
          activeRates,
          upperBase
        );
        parsedAccounts.push({
          name: String(raw.name || raw.accountName || 'Imported Account').trim(),
          type: String(raw.accountType || raw.type || 'Operating Account').trim(),
          institution: String(raw.institution || raw.bank || 'Bank').trim(),
          currency: accCurr,
          originalInitialBalance: nativeBal,
          exchangeRate: exchangeRate2dp,
          initialBalance: convertedAmount,
          isVirtual: Boolean(raw.isVirtual),
          description: String(raw.description || raw.notes || '').trim(),
        });
        return;
      }

      // 2. Transfer record
      if (
        recordType === 'transfer' ||
        (raw.sourceAccountId && raw.destinationAccountId) ||
        (raw.fromAccount && raw.toAccount)
      ) {
        const fromMatch = matchAccountId(raw.sourceAccountId || raw.fromAccount || raw.sourceAccount);
        const toMatch = matchAccountId(raw.destinationAccountId || raw.toAccount || raw.destinationAccount);
        const { amount: rawAmt, currency: txCurr } = detectCurrencyAndCleanNumber(
          raw.sourceAmount ?? raw.amount ?? 0,
          raw.sourceCurrency || raw.currency || fromMatch.currency
        );
        if (Math.abs(rawAmt) <= 0) return;
        const cleanSourceAmt = Math.abs(rawAmt);
        const baseConv = convertServer2dp(
          cleanSourceAmt,
          txCurr,
          upperBase,
          activeRates,
          upperBase
        );
        const destConv = convertServer2dp(
          cleanSourceAmt,
          txCurr,
          toMatch.currency,
          activeRates,
          upperBase
        );
        parsedTransfers.push({
          date: normalizeDateString(raw.date || raw.transactionDate),
          sourceAccountId: fromMatch.id,
          destinationAccountId: toMatch.id,
          amount: baseConv.convertedAmount,
          sourceCurrency: txCurr,
          sourceAmount: cleanSourceAmt,
          destinationCurrency: toMatch.currency,
          destinationAmount: destConv.convertedAmount,
          exchangeRate: destConv.exchangeRate2dp,
          transferType: 'general',
          description: String(raw.description || raw.notes || 'Imported transfer').trim(),
        });
        return;
      }

      // Determine whether row is Income or Expense
      const rawVal =
        raw.grossAmount ??
        raw.originalGrossAmount ??
        raw.originalAmount ??
        raw.amount ??
        raw.value ??
        raw.total ??
        raw.credit ??
        (raw.debit ? -Math.abs(Number(raw.debit)) : 0);

      const accMatch = matchAccountId(raw.accountId || raw.account || raw.accountName);
      const { amount: signedAmt, currency: rowCurr } = detectCurrencyAndCleanNumber(
        rawVal,
        raw.currency || accMatch.currency || upperBase
      );

      const isIncome =
        recordType === 'income' ||
        recordType === 'inflow' ||
        recordType === 'credit' ||
        recordType === 'revenue' ||
        recordType === 'salary' ||
        raw.grossAmount !== undefined ||
        raw.clientOrSource !== undefined ||
        (recordType !== 'expense' &&
          recordType !== 'outflow' &&
          recordType !== 'debit' &&
          signedAmt > 0 &&
          Boolean(raw.source || raw.client || raw.incomeSource) &&
          !raw.recipient &&
          !raw.subcategory);

      const absAmt = Math.abs(signedAmt);
      if (absAmt <= 0) return;

      const { convertedAmount, exchangeRate2dp } = convertServer2dp(
        absAmt,
        rowCurr,
        upperBase,
        activeRates,
        upperBase
      );
      const dateStr = normalizeDateString(raw.date || raw.transactionDate || raw.createdAt);

      if (isIncome) {
        // Save income in its account/record currency without conversion; totals convert via real-time market rate
        parsedIncomes.push({
          date: dateStr,
          quarter: getQuarterFromDateStr(dateStr),
          clientOrSource: String(
            raw.clientOrSource ||
              raw.incomeSource ||
              raw.source ||
              raw.client ||
              'Income'
          ).trim(),
          category: String(raw.category || 'Salary').trim(),
          accountId: accMatch.id,
          currency: rowCurr,
          originalGrossAmount: absAmt,
          exchangeRate: exchangeRate2dp,
          grossAmount: absAmt,
          baseConvertedAmount: convertedAmount,
          notes: String(raw.notes || raw.origin || raw.description || '').trim(),
          receiptId: String(
            raw.receiptId || `IMP-${Date.now().toString().slice(-5)}-${parsedIncomes.length + 1}`
          ),
        });
      } else {
        const cleanCat = String(raw.category || 'General').trim();
        const cleanSub = String(raw.subcategory || cleanCat || 'General').trim();
        parsedExpenses.push({
          date: dateStr,
          accountId: accMatch.id,
          recipient: String(
            raw.recipient || raw.to || raw.payee || raw.vendor || raw.merchant || ''
          ).trim(),
          category: cleanCat,
          subcategory: cleanSub,
          notes: String(raw.notes || raw.description || '').trim() || undefined,
          description: cleanSub,
          currency: rowCurr,
          originalAmount: absAmt,
          exchangeRate: exchangeRate2dp,
          amount: convertedAmount,
        });
      }
    };

    const lowerName = String(fileName).toLowerCase();
    const isPdf = lowerName.endsWith('.pdf') || mimeType === 'application/pdf';
    const isBak = lowerName.endsWith('.bak');

    // Normalize incoming text content (including decoding base64-encoded .bak payloads if applicable)
    let textContent = String(content || '').trim();
    if (!textContent && base64Data && !isPdf) {
      try {
        textContent = Buffer.from(String(base64Data), 'base64')
          .toString('utf8')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, '\n')
          .trim();
      } catch {
        textContent = '';
      }
    } else if (isBak && textContent) {
      // Check if the .bak file itself contains a single base64-encoded JSON/CSV string
      if (/^[A-Za-z0-9+/=\r\n]+$/.test(textContent) && textContent.length > 24 && !textContent.includes(',')) {
        try {
          const decoded = Buffer.from(textContent.replace(/\s+/g, ''), 'base64').toString('utf8').trim();
          if (decoded.startsWith('{') || decoded.startsWith('[') || decoded.includes(',')) {
            textContent = decoded;
          }
        } catch {
          // keep original textContent
        }
      }
      // Strip any binary control characters from hybrid .bak files
      textContent = textContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, '\n').trim();
    }

    const ingestJsonContainer = (obj: any) => {
      if (!obj) return;
      if (Array.isArray(obj)) {
        obj.forEach((item) => normalizeRawRecord(item));
        return;
      }
      if (typeof obj !== 'object') return;

      const incList = obj.incomes || obj.incomeReceipts || obj.income_receipts;
      if (Array.isArray(incList)) {
        incList.forEach((item: any) => normalizeRawRecord(item, 'income'));
      }

      const expList = obj.expenses || obj.flexible_expenses || obj.flexibleExpenses;
      if (Array.isArray(expList)) {
        expList.forEach((item: any) => normalizeRawRecord(item, 'expense'));
      }

      const accList = obj.accounts || obj.financialAccounts || obj.financial_accounts;
      if (Array.isArray(accList)) {
        accList.forEach((item: any) => normalizeRawRecord(item, 'account'));
      }

      const trList = obj.transfers || obj.accountTransfers || obj.account_transfers;
      if (Array.isArray(trList)) {
        trList.forEach((item: any) => normalizeRawRecord(item, 'transfer'));
      }

      const genericList = obj.records || obj.transactions || obj.entries || obj.items;
      if (Array.isArray(genericList)) {
        genericList.forEach((item: any) => normalizeRawRecord(item));
      }

      // Recurse into common .bak wrapper keys (data, backup, state, payload, ledger, collections)
      for (const wrapperKey of ['data', 'backup', 'state', 'payload', 'ledger', 'collections']) {
        if (obj[wrapperKey] && typeof obj[wrapperKey] === 'object') {
          ingestJsonContainer(obj[wrapperKey]);
        }
      }
    };

    // Stage A: JSON or .bak JSON / NDJSON deterministic parsing
    if (
      !isPdf &&
      (lowerName.endsWith('.json') ||
        isBak ||
        mimeType.includes('json') ||
        textContent.startsWith('{') ||
        textContent.startsWith('['))
    ) {
      let parsedAsJson = false;
      try {
        const jsonObj = JSON.parse(textContent);
        ingestJsonContainer(jsonObj);
        parsedAsJson = true;
      } catch {
        // Check if it is NDJSON (newline-delimited JSON objects) or contains an embedded JSON block in a .bak file
        const lines = textContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        let ndjsonMatches = 0;
        for (const line of lines) {
          if (line.startsWith('{') && line.endsWith('}')) {
            try {
              const rowObj = JSON.parse(line);
              normalizeRawRecord(rowObj);
              ndjsonMatches++;
            } catch {
              // ignore non-JSON line
            }
          }
        }
        if (ndjsonMatches > 0) {
          parsedAsJson = true;
        } else if (isBak) {
          const firstBrace = textContent.indexOf('{');
          const lastBrace = textContent.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            try {
              const embedded = JSON.parse(textContent.slice(firstBrace, lastBrace + 1));
              ingestJsonContainer(embedded);
              parsedAsJson = true;
            } catch {
              // Fall through to delimited/AI parsing
            }
          }
        }
      }

      // If a .bak file wasn't JSON, allow it to fall through to delimited CSV/TSV/pipe parsing below
      if (!parsedAsJson && isBak) {
        // continue to delimited check
      }
    }

    // Stage A2: Delimited (.csv, .tsv, or delimited .bak / .txt) parsing
    if (
      !isPdf &&
      parsedIncomes.length + parsedExpenses.length + parsedAccounts.length + parsedTransfers.length === 0 &&
      (lowerName.endsWith('.csv') ||
        lowerName.endsWith('.tsv') ||
        isBak ||
        mimeType.includes('csv') ||
        textContent.includes(',') ||
        textContent.includes('\t') ||
        textContent.includes('|') ||
        textContent.includes(';'))
    ) {
      const lines = textContent
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length >= 2) {
        const headerLine = lines[0];
        const candidates = [',', '\t', '|', ';'];
        let delimiter = ',';
        let maxCols = 1;
        for (const cand of candidates) {
          const count = headerLine.split(cand).length;
          if (count > maxCols) {
            maxCols = count;
            delimiter = cand;
          }
        }
        const headers = parseDelimitedLine(lines[0], delimiter).map((h) =>
          h.toLowerCase().replace(/[^a-z0-9]/g, '')
        );

        for (let i = 1; i < lines.length; i++) {
          const cols = parseDelimitedLine(lines[i], delimiter);
          if (cols.every((c) => !c)) continue;
          const rowMap: Record<string, string> = {};
          headers.forEach((h, idx) => {
            rowMap[h] = cols[idx] ?? '';
          });

          const sourceOrRecipient =
            rowMap.sourceorrecipient ||
            rowMap.source_or_recipient ||
            rowMap.party ||
            rowMap.name ||
            undefined;

          const mappedObj: any = {
            recordType:
              rowMap.type ||
              rowMap.recordtype ||
              rowMap.entrytype ||
              rowMap.kind ||
              rowMap.transactiontype ||
              '',
            date:
              rowMap.date ||
              rowMap.transactiondate ||
              rowMap.valuedate ||
              rowMap.createdat ||
              '',
            clientOrSource:
              rowMap.incomesource ||
              rowMap.clientorsource ||
              rowMap.client ||
              rowMap.payer ||
              sourceOrRecipient ||
              undefined,
            recipient:
              rowMap.recipient ||
              rowMap.to ||
              rowMap.payee ||
              rowMap.vendor ||
              rowMap.merchant ||
              sourceOrRecipient ||
              undefined,
             name: sourceOrRecipient || rowMap.accountname || undefined,
            category: rowMap.category || rowMap.group || undefined,
            subcategory: rowMap.subcategory || rowMap.sub || undefined,
            description:
              rowMap.description ||
              rowMap.details ||
              rowMap.narration ||
              rowMap.memo ||
              rowMap.title ||
              undefined,
            notes: rowMap.notes || rowMap.source || rowMap.origin || rowMap.reference || undefined,
            account:
              rowMap.account ||
              rowMap.accountname ||
              rowMap.accountid ||
              rowMap.wallet ||
              undefined,
            fromAccount: rowMap.fromaccount || rowMap.sourceaccount || undefined,
            toAccount: rowMap.toaccount || rowMap.destinationaccount || undefined,
            currency: rowMap.currency || rowMap.curr || rowMap.ccy || undefined,
            amount:
              rowMap.amount ||
              rowMap.totalincome ||
              rowMap.grossamount ||
              rowMap.value ||
              rowMap.total ||
              undefined,
            credit: rowMap.credit || rowMap.inflow || rowMap.deposit || undefined,
            debit: rowMap.debit || rowMap.outflow || rowMap.withdrawal || undefined,
            initialBalance:
              rowMap.initialbalance ||
              rowMap.openingbalance ||
              (rowMap.type?.toLowerCase() === 'account' ? rowMap.amount : undefined),
            institution:
              rowMap.institution ||
              rowMap.bank ||
              (rowMap.type?.toLowerCase() === 'account' ? rowMap.account : undefined),
          };

          if (!mappedObj.recordType) {
            if (mappedObj.credit && parseFloat(mappedObj.credit) > 0) {
              mappedObj.recordType = 'income';
              mappedObj.amount = mappedObj.credit;
            } else if (mappedObj.debit && parseFloat(mappedObj.debit) > 0) {
              mappedObj.recordType = 'expense';
              mappedObj.amount = mappedObj.debit;
            } else if (mappedObj.clientOrSource && !mappedObj.recipient) {
              mappedObj.recordType = 'income';
            } else {
              mappedObj.recordType = 'expense';
            }
          }

          normalizeRawRecord(mappedObj);
        }
      }
    }

    // Stage B: If no records were extracted yet (e.g. PDF, SQL dump .bak, or unstructured text), try AI extraction if GEMINI_API_KEY is available
    const totalExtracted =
      parsedIncomes.length +
      parsedExpenses.length +
      parsedAccounts.length +
      parsedTransfers.length;

    if (totalExtracted === 0 && process.env.GEMINI_API_KEY) {
      try {
        const ai = getAiClient();
        const pdfPayload = base64Data || (isBase64 ? content : '');
        const promptText = `
Extract all financial records (incomes, expenses, accounts, or transfers) from the attached file "${fileName}".
Default currency: ${upperBase}.
Return a JSON object with arrays: "incomes", "expenses", "accounts", "transfers".
Each income: { "date": "YYYY-MM-DD", "clientOrSource": "string", "category": "string", "amount": number, "currency": "USD|GHS|EUR|GBP|NGN|KES|ZAR|CAD|AUD", "notes": "string", "account": "string" }
Each expense: { "date": "YYYY-MM-DD", "recipient": "string", "category": "string", "subcategory": "string", "amount": number, "currency": "string", "notes": "string", "account": "string" }
Each account: { "name": "string", "institution": "string", "type": "Operating Account", "initialBalance": number, "currency": "string" }
Each transfer: { "date": "YYYY-MM-DD", "fromAccount": "string", "toAccount": "string", "amount": number, "currency": "string", "description": "string" }
`;
        const parts: any[] = [{ text: promptText }];
        if (isPdf && pdfPayload) {
          parts.push({
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfPayload,
            },
          });
        } else {
          parts.push({ text: `\nFile Content:\n${String(textContent || content).slice(0, 35000)}` });
        }

        const aiResp = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: parts,
          config: { responseMimeType: 'application/json' },
        });
        const aiData = JSON.parse(aiResp.text?.trim() || '{}');
        ingestJsonContainer(aiData);
      } catch (aiErr) {
        console.warn('AI import fallback warning:', aiErr);
      }
    }

    return res.json({
      success: true,
      fileName,
      baseCurrency: upperBase,
      summary: {
        incomesCount: parsedIncomes.length,
        expensesCount: parsedExpenses.length,
        accountsCount: parsedAccounts.length,
        transfersCount: parsedTransfers.length,
        totalRecords:
          parsedIncomes.length +
          parsedExpenses.length +
          parsedAccounts.length +
          parsedTransfers.length,
      },
      incomes: parsedIncomes,
      expenses: parsedExpenses,
      accounts: parsedAccounts,
      transfers: parsedTransfers,
      records: {
        incomes: parsedIncomes,
        expenses: parsedExpenses,
        accounts: parsedAccounts,
        transfers: parsedTransfers,
      },
    });
  } catch (error: any) {
    console.error('File import parse error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Unable to parse the selected file.',
    });
  }
});

/**
 * Backend Multi-Purpose Budget & Goal Evaluation Endpoint (`POST /api/budgets/evaluate`)
 * Evaluates both Expense-linked Budgets (`purposeType: 'budget'`) and Transfer/Savings-linked
 * Goals (`purposeType: 'goal'`), checking active date windows, auto-recreation settings
 * (`autoRecreate`, `recreateDays`), and disabling expired budgets without auto-recreate.
 */
app.post('/api/budgets/evaluate', (req: Request, res: Response) => {
  try {
    const {
      budgets = [],
      expenses = [],
      transfers = [],
      spendDraft = null,
      baseCurrency = 'GHS',
    } = req.body || {};

    const upperBase = String(baseCurrency || 'GHS').toUpperCase();
    const fallbackRates = buildFallbackRatesForBase(upperBase);
    const todayYmd = new Date().toISOString().split('T')[0];

    const convertAmt = (amt: number, fromCurr: string, toCurr: string): number => {
      const f = String(fromCurr || upperBase).toUpperCase();
      const t = String(toCurr || upperBase).toUpperCase();
      if (f === t) return round2dp(amt);
      const fromRate = fallbackRates[f] || 1;
      const toRate = fallbackRates[t] || 1;
      return round2dp((Number(amt || 0) / fromRate) * toRate);
    };

    const evaluated = (Array.isArray(budgets) ? budgets : []).map((b: any) => {
      const purposeType: 'budget' | 'goal' =
        b.purposeType === 'goal' ? 'goal' : 'budget';
      const budgetCurr = String(b.currency || upperBase).toUpperCase();
      const subs: string[] = Array.isArray(b.subcategories)
        ? b.subcategories.map((s: any) => String(s || '').trim().toLowerCase())
        : [];
      const limit = round2dp(Number(b.amount || 0));
      const endYmd = String(b.activePeriodEnd || b.customEndDate || '');
      const isExpired =
        Boolean(b.isExpiredDisabled) || Boolean(endYmd && todayYmd > endYmd);
      const autoRecreate = Boolean(b.autoRecreate);
      const recreateDays = Math.max(0, Math.round(Number(b.recreateDays || 0)));
      const isDisabledFromReach = isExpired && !autoRecreate;

      let spent = 0;

      if (purposeType === 'goal') {
        const goalCauseLower = String(b.goalCause || '').trim().toLowerCase();
        for (const tr of Array.isArray(transfers) ? transfers : []) {
          if (!tr) continue;
          if (b.accountId && tr.destinationAccountId !== b.accountId) continue;
          if (!b.accountId && goalCauseLower) {
            const descMatch = String(tr.description || '')
              .toLowerCase()
              .includes(goalCauseLower);
            if (!descMatch && tr.transferType !== 'savings_deduction') continue;
          }
          const rawAmt = Number(tr.destinationAmount ?? tr.amount ?? 0);
          const trCurr = String(
            tr.destinationCurrency || tr.sourceCurrency || upperBase
          ).toUpperCase();
          spent = round2dp(spent + convertAmt(rawAmt, trCurr, budgetCurr));
        }
      } else {
        for (const exp of Array.isArray(expenses) ? expenses : []) {
          if (!exp || exp.vaultAction === 'credit') continue;
          const expSub = String(exp.subcategory || '').trim().toLowerCase();
          if (!subs.includes(expSub)) continue;
          if (b.accountId && exp.accountId !== b.accountId) continue;
          const rawAmt = Number(exp.originalAmount ?? exp.amount ?? 0);
          const expCurr = String(exp.currency || upperBase).toUpperCase();
          spent = round2dp(spent + convertAmt(rawAmt, expCurr, budgetCurr));
        }
      }

      const residual =
        purposeType === 'goal'
          ? round2dp(Math.max(0, limit - spent))
          : round2dp(limit - spent);
      const percentage = limit > 0 ? round2dp((spent / limit) * 100) : 0;
      const threshold = Number(b.alertThresholdPercent ?? 80);
      const status =
        purposeType === 'goal'
          ? limit > 0 && spent >= limit
            ? 'at_limit'
            : percentage >= threshold
            ? 'warning'
            : 'healthy'
          : limit > 0 && spent > limit
          ? 'exceeded'
          : limit > 0 && spent === limit
          ? 'at_limit'
          : percentage >= threshold
          ? 'warning'
          : 'healthy';

      return {
        budgetId: b.id,
        name: b.name,
        purposeType,
        goalCause: b.goalCause || undefined,
        goalSourceType: b.goalSourceType || 'savings_and_transfers',
        periodType: b.periodType || 'monthly',
        scopeType: b.scopeType || (subs.length > 1 ? 'multiple' : 'single'),
        currency: budgetCurr,
        budgetLimit: limit,
        spentAmount: spent,
        residualAmount: residual,
        usagePercentage: percentage,
        status,
        autoRecreate,
        recreateDays,
        isExpired,
        isDisabledFromReach,
        spendCheck:
          spendDraft && purposeType === 'budget' && !isDisabledFromReach
            ? (() => {
                const draftSub = String(spendDraft.subcategory || '')
                  .trim()
                  .toLowerCase();
                if (!subs.includes(draftSub)) return null;
                const addAmt = convertAmt(
                  Number(spendDraft.amount || 0),
                  String(spendDraft.currency || budgetCurr),
                  budgetCurr
                );
                const projectedSpent = round2dp(spent + addAmt);
                const projectedResidual = round2dp(limit - projectedSpent);
                const projectedPercentage =
                  limit > 0 ? round2dp((projectedSpent / limit) * 100) : 0;
                return {
                  additionalSpend: addAmt,
                  projectedSpent,
                  projectedResidual,
                  projectedPercentage,
                  exceedsBudget: limit > 0 && projectedSpent > limit,
                };
              })()
            : null,
      };
    });

    return res.json({
      success: true,
      evaluatedBudgets: evaluated,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Budget evaluation failed.',
    });
  }
});

/**
 * Backend Budget Auto-Recreation & Expiration Reconciliation Endpoint (`POST /api/budgets/reconcile`)
 * Recreates expired budgets that have `autoRecreate: true` for `recreateDays` days,
 * and marks expired budgets without `autoRecreate` as `isExpiredDisabled: true`.
 */
app.post('/api/budgets/reconcile', (req: Request, res: Response) => {
  try {
    const { budgets = [] } = req.body || {};
    const today = new Date();
    const todayYmd = today.toISOString().split('T')[0];
    const nowIso = today.toISOString();

    const nextBudgets: any[] = [];
    const changedBudgets: any[] = [];
    const recreatedList: any[] = [];

    for (let i = 0; i < (Array.isArray(budgets) ? budgets.length : 0); i++) {
      const b = budgets[i];
      if (!b || b.isArchivedPeriod) {
        if (b) nextBudgets.push(b);
        continue;
      }

      const endYmd = String(b.activePeriodEnd || b.customEndDate || '');
      if (endYmd && todayYmd > endYmd) {
        if (b.autoRecreate) {
          const days = Math.max(1, Math.round(Number(b.recreateDays || 30)));
          const startD = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const endD = new Date(startD);
          endD.setDate(startD.getDate() + days - 1);
          const newStartYmd = startD.toISOString().split('T')[0];
          const newEndYmd = endD.toISOString().split('T')[0];

          const archived = {
            ...b,
            isArchivedPeriod: true,
            isExpiredDisabled: false,
            updatedAt: nowIso,
          };
          nextBudgets.push(archived);
          changedBudgets.push(archived);

          const recreated = {
            ...b,
            id: `bgt_rec_${Date.now()}_${i}`,
            activePeriodStart: newStartYmd,
            activePeriodEnd: newEndYmd,
            customStartDate: b.periodType === 'custom' ? newStartYmd : b.customStartDate,
            customEndDate: b.periodType === 'custom' ? newEndYmd : b.customEndDate,
            autoRecreate: true,
            recreateDays: days,
            parentRecurringBudgetId: b.parentRecurringBudgetId || b.id,
            isArchivedPeriod: false,
            isExpiredDisabled: false,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          recreatedList.push(recreated);
          changedBudgets.push(recreated);
        } else {
          const disabled = {
            ...b,
            isExpiredDisabled: true,
            updatedAt: nowIso,
          };
          nextBudgets.push(disabled);
          changedBudgets.push(disabled);
        }
      } else {
        nextBudgets.push(b);
      }
    }

    return res.json({
      success: true,
      nextBudgets: [...recreatedList, ...nextBudgets],
      changedBudgets,
      hasChanges: changedBudgets.length > 0,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Budget reconciliation failed.',
    });
  }
});

/**
 * Backend Automated Savings Vault Debit Learning Endpoint
 * Learns from past expenses debited ONLY from Savings Vaults (`vaultAction !== 'credit'`)
 * and resolves the target Savings Vault for incoming expense drafts.
 */
app.post('/api/expenses/vault-debit-learn', (req: Request, res: Response) => {
  try {
    const {
      draft = {},
      expenses = [],
      accounts = [],
      savingsBuckets = [],
    } = req.body || {};

    const bucketIds = new Set(
      (Array.isArray(savingsBuckets) ? savingsBuckets : []).map((b: any) =>
        String(b.id || '')
      )
    );
    const bucketAccountIds = new Set(
      (Array.isArray(savingsBuckets) ? savingsBuckets : []).map((b: any) =>
        String(b.accountId || '')
      )
    );

    const vaultMap = new Map<string, any>();
    for (const acc of Array.isArray(accounts) ? accounts : []) {
      if (!acc || !acc.id) continue;
      const isVault =
        Boolean(acc.linkedSavingsBucketId && bucketIds.has(acc.linkedSavingsBucketId)) ||
        bucketAccountIds.has(acc.id) ||
        String(acc.institution || '').toLowerCase() === 'savings vault';
      if (isVault) {
        vaultMap.set(String(acc.id), acc);
      }
    }

    const pastVaultDebits = (Array.isArray(expenses) ? expenses : []).filter(
      (e: any) =>
        e &&
        e.accountId &&
        vaultMap.has(String(e.accountId)) &&
        e.vaultAction !== 'credit'
    );

    const normRec = String(draft.recipient || draft.description || '')
      .trim()
      .toLowerCase();
    const normSub = String(draft.subcategory || '').trim().toLowerCase();
    const normCat = String(draft.category || '').trim().toLowerCase();

    let matchedVault: any = null;
    let matchCount = 0;
    let matchedBy: 'recipient' | 'subcategory' | 'category' = 'recipient';

    if (normRec.length >= 2) {
      const counts = new Map<string, number>();
      for (const exp of pastVaultDebits) {
        const expRec = String(exp.recipient || exp.description || '')
          .trim()
          .toLowerCase();
        if (
          expRec &&
          (expRec === normRec ||
            (normRec.length >= 4 &&
              (expRec.includes(normRec) || normRec.includes(expRec))))
        ) {
          const vId = String(exp.accountId);
          counts.set(vId, (counts.get(vId) || 0) + 1);
        }
      }
      if (counts.size > 0) {
        const [topId, cnt] = Array.from(counts.entries()).sort(
          (a, b) => b[1] - a[1]
        )[0];
        matchedVault = vaultMap.get(topId);
        matchCount = cnt;
        matchedBy = 'recipient';
      }
    }

    if (!matchedVault && normSub.length >= 2) {
      const counts = new Map<string, number>();
      for (const exp of pastVaultDebits) {
        const expSub = String(exp.subcategory || '').trim().toLowerCase();
        if (expSub === normSub) {
          const vId = String(exp.accountId);
          counts.set(vId, (counts.get(vId) || 0) + 1);
        }
      }
      if (counts.size > 0) {
        const [topId, cnt] = Array.from(counts.entries()).sort(
          (a, b) => b[1] - a[1]
        )[0];
        matchedVault = vaultMap.get(topId);
        matchCount = cnt;
        matchedBy = 'subcategory';
      }
    }

    if (!matchedVault && normCat.length >= 2 && !normSub) {
      const counts = new Map<string, number>();
      for (const exp of pastVaultDebits) {
        const expCat = String(exp.category || '').trim().toLowerCase();
        if (expCat === normCat) {
          const vId = String(exp.accountId);
          counts.set(vId, (counts.get(vId) || 0) + 1);
        }
      }
      if (counts.size > 0) {
        const [topId, cnt] = Array.from(counts.entries()).sort(
          (a, b) => b[1] - a[1]
        )[0];
        matchedVault = vaultMap.get(topId);
        matchCount = cnt;
        matchedBy = 'category';
      }
    }

    return res.json({
      success: true,
      suggestion: matchedVault
        ? {
            vaultAccountId: matchedVault.id,
            vaultAccountName: matchedVault.name,
            matchCount,
            matchedBy,
            reason: `Auto-debit from ${matchedVault.name} (learned from ${matchCount} past savings vault debit${matchCount === 1 ? '' : 's'})`,
          }
        : null,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Vault debit learning failed.',
    });
  }
});

/**
 * Backend Expense Transaction Update Endpoint (`POST /api/expenses/update`)
 * Normalizes an edited expense transaction across all boards with currency conversion and vault debit handling.
 */
app.post('/api/expenses/update', (req: Request, res: Response) => {
  try {
    const {
      expense = {},
      baseCurrency = 'GHS',
      isVaultAccount = false,
    } = req.body || {};

    if (!expense || !expense.id) {
      return res.status(400).json({
        success: false,
        error: 'Expense ID is required to update a transaction.',
      });
    }

    const upperBase = String(baseCurrency || 'GHS').trim().toUpperCase();
    const cachedFx = fxCache.get(upperBase);
    const activeRates = cachedFx?.rates || buildFallbackRatesForBase(upperBase);

    const expCurr = String(expense.currency || upperBase).trim().toUpperCase();
    const rawNativeAmt = round2dp(
      Math.max(0, Number(expense.originalAmount ?? expense.amount ?? 0))
    );
    const { convertedAmount, exchangeRate2dp } = convertServer2dp(
      rawNativeAmt,
      expCurr,
      upperBase,
      activeRates,
      upperBase
    );

    const cleanCategory = String(expense.category || 'Uncategorized').trim();
    const cleanSubcategory = expense.subcategory
      ? String(expense.subcategory).trim()
      : cleanCategory;
    const normalizedExpense = {
      ...expense,
      date: normalizeDateString(expense.date),
      category: cleanCategory,
      subcategory: cleanSubcategory,
      recipient: String(expense.recipient || '').trim(),
      notes: String(expense.notes || '').trim() || undefined,
      description: cleanSubcategory,
      currency: expCurr,
      originalAmount: rawNativeAmt,
      exchangeRate: exchangeRate2dp,
      amount: convertedAmount,
      vaultAction: isVaultAccount
        ? expense.vaultAction === 'credit'
          ? 'credit'
          : 'debit'
        : undefined,
    };

    return res.json({
      success: true,
      expense: normalizedExpense,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Expense update failed.',
    });
  }
});

/**
 * Backend Move Subcategory to Another Category Endpoint (`POST /api/categories/move-subcategory`)
 * Moves an existing subcategory from `fromCategory` to `toCategory` across settings, expenses, incomes, and budgets.
 */
app.post('/api/categories/move-subcategory', (req: Request, res: Response) => {
  try {
    const {
      subcategory = '',
      fromCategory = '',
      toCategory = '',
      settings = {},
      expenses = [],
      incomes = [],
      budgets = [],
    } = req.body || {};

    const cleanSub = String(subcategory || '').trim();
    const cleanFrom = String(fromCategory || '').trim();
    const cleanTo = String(toCategory || '').trim();

    if (!cleanSub || !cleanTo) {
      return res.status(400).json({
        success: false,
        error: 'Both subcategory and target category are required.',
      });
    }

    const subKey = cleanSub.toLowerCase();
    const fromKey = cleanFrom.toLowerCase();
    const toKey = cleanTo.toLowerCase();

    const rawPrefs: any[] = Array.isArray(settings.expenseCategoryPreferences)
      ? settings.expenseCategoryPreferences
      : [];

    let preservedColor: string | undefined;
    for (const pref of rawPrefs) {
      if (pref?.subcategoryColors && pref.subcategoryColors[cleanSub]) {
        preservedColor = pref.subcategoryColors[cleanSub];
        break;
      }
    }

    let targetFound = false;
    const nextPrefs = rawPrefs.map((pref: any) => {
      const pName = String(pref.name || '').trim();
      const pKey = pName.toLowerCase();
      const subs: string[] = Array.isArray(pref.subcategories)
        ? pref.subcategories
        : [];
      const colors: Record<string, string> = { ...(pref.subcategoryColors || {}) };

      if (pKey === toKey) {
        targetFound = true;
        const hasSub = subs.some((s) => String(s).trim().toLowerCase() === subKey);
        const nextSubs = hasSub ? subs : [...subs, cleanSub];
        if (preservedColor && !colors[cleanSub]) {
          colors[cleanSub] = preservedColor;
        }
        return {
          ...pref,
          subcategories: nextSubs,
          subcategoryColors: colors,
        };
      }

      if (!fromKey || pKey === fromKey) {
        const filteredSubs = subs.filter(
          (s) => String(s).trim().toLowerCase() !== subKey
        );
        return {
          ...pref,
          subcategories: filteredSubs,
        };
      }

      return pref;
    });

    if (!targetFound) {
      nextPrefs.push({
        id: `cat_pref_${Date.now()}`,
        name: cleanTo,
        subcategories: [cleanSub],
        subcategoryColors: preservedColor ? { [cleanSub]: preservedColor } : {},
      });
    }

    const updatedExpenses = (Array.isArray(expenses) ? expenses : []).map(
      (exp: any) => {
        if (
          exp &&
          String(exp.subcategory || '').trim().toLowerCase() === subKey
        ) {
          return {
            ...exp,
            category: cleanTo,
          };
        }
        return exp;
      }
    );

    const updatedIncomes = (Array.isArray(incomes) ? incomes : []).map(
      (inc: any) => {
        if (!inc || !Array.isArray(inc.allocatedDeductions)) return inc;
        let changed = false;
        const nextDeds = inc.allocatedDeductions.map((d: any) => {
          if (
            d &&
            String(d.expenseSubcategory || '').trim().toLowerCase() === subKey
          ) {
            changed = true;
            return {
              ...d,
              expenseCategory: cleanTo,
            };
          }
          return d;
        });
        return changed ? { ...inc, allocatedDeductions: nextDeds } : inc;
      }
    );

    const updatedBudgets = (Array.isArray(budgets) ? budgets : []).map(
      (b: any) => {
        if (!b || !Array.isArray(b.subcategories)) return b;
        const tracksSub = b.subcategories.some(
          (s: any) => String(s || '').trim().toLowerCase() === subKey
        );
        if (!tracksSub) return b;
        const existingCats: string[] = Array.isArray(b.categories)
          ? b.categories
          : [];
        const hasTargetCat = existingCats.some(
          (c) => String(c || '').trim().toLowerCase() === toKey
        );
        return {
          ...b,
          categories: hasTargetCat ? existingCats : [...existingCats, cleanTo],
        };
      }
    );

    return res.json({
      success: true,
      expenseCategoryPreferences: nextPrefs,
      expenses: updatedExpenses,
      incomes: updatedIncomes,
      budgets: updatedBudgets,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Moving subcategory failed.',
    });
  }
});

/**
 * Backend Record Card Formatting Endpoint (`POST /api/records/format-card`)
 * Formats any record (income, expense, transfer) into the standardized 2x2 card structure:
 * - Top-Left: Subcategory only (with subcategory color; never doubled with category, never notes/description)
 * - Bottom-Left: Account name
 * - Top-Right: Amount (emerald for income, red for expense, blue for transfer)
 * - Bottom-Right: Date only in dd/mm/yyyy (time dd/mm/yyyy, hh:mm is returned in popupDetails)
 */
app.post('/api/records/format-card', (req: Request, res: Response) => {
  try {
    const {
      record = {},
      recordType = 'expense',
      accountName = 'Account',
      destinationAccountName = '',
      subcategoryColor = '#059669',
      currency = 'GHS',
    } = req.body || {};

    const normalizedDate = normalizeDateString(record.date);
    const [yyyy, mm, dd] = normalizedDate.split('-');
    const dateOnlyDDMMYYYY =
      yyyy && mm && dd ? `${dd}/${mm}/${yyyy}` : normalizedDate;

    let timeHHMM = '00:00';
    if (record.createdAt) {
      const parsedTime = new Date(record.createdAt);
      if (!isNaN(parsedTime.getTime())) {
        const hrs = String(parsedTime.getHours()).padStart(2, '0');
        const mins = String(parsedTime.getMinutes()).padStart(2, '0');
        timeHHMM = `${hrs}:${mins}`;
      }
    }

    const type: 'income' | 'expense' | 'transfer' =
      recordType === 'income'
        ? 'income'
        : recordType === 'transfer'
        ? 'transfer'
        : 'expense';

    const topLeftSubcategory =
      type === 'income'
        ? String(record.clientOrSource || 'Income').trim()
        : type === 'transfer'
        ? record.transferType === 'savings_deduction' ||
          String(record.id || '').startsWith('trans_sav_')
          ? 'Savings Allocation'
          : String(record.id || '').startsWith('trans_net_')
          ? 'Net Income Transfer'
          : 'Fund Transfer'
        : String(record.subcategory || record.category || 'Expense').trim();

    const bottomLeftAccount =
      type === 'transfer' && destinationAccountName
        ? `${accountName} → ${destinationAccountName}`
        : String(accountName || 'Account').trim();

    const amountColorClass =
      type === 'income'
        ? 'text-emerald-600'
        : type === 'transfer'
        ? 'text-blue-600'
        : 'text-rose-600';

    const rawAmount = round2dp(
      Number(
        record.originalAmount ??
          record.originalGrossAmount ??
          record.destinationAmount ??
          record.amount ??
          record.grossAmount ??
          0
      )
    );

    return res.json({
      success: true,
      card: {
        topLeftSubcategory,
        subcategoryColor,
        bottomLeftAccount,
        topRightAmount: rawAmount,
        currency: String(record.currency || currency).toUpperCase(),
        recordType: type,
        amountColorClass,
        bottomRightDate: dateOnlyDDMMYYYY,
      },
      popupDetails: {
        dateTimeFormatted: `${dateOnlyDDMMYYYY}, ${timeHHMM}`,
        category: String(record.category || '').trim() || undefined,
        subcategory: topLeftSubcategory,
        account: bottomLeftAccount,
        recipientOrOrigin: String(record.recipient || '').trim() || undefined,
        notes: String(record.notes || record.description || '').trim() || undefined,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to format record card.',
    });
  }
});

// Bind port 3000 immediately so container healthchecks succeed without waiting on Vite cold boot
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
    app.listen(port, '0.0.0.0', () => {
      console.log(`Server listening on port ${port}`);
    });
  } else {
    let viteMiddlewares: any = null;
    const viteReadyPromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    }).then((vite) => {
      viteMiddlewares = vite.middlewares;
      return vite;
    });

    app.use(async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!viteMiddlewares) {
          await viteReadyPromise;
        }
        viteMiddlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });

    app.listen(port, '0.0.0.0', () => {
      console.log(`Server listening on port ${port}`);
    });
  }
}

startServer();
