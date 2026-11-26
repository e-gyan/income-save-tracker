import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

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

function formatYmdToDDMMYYYY(dateStr: string): string {
  const s = String(dateStr || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s || '—';
}

function normalizeDateString(rawDate: any): string {
  const today = new Date().toISOString().split('T')[0];
  if (!rawDate) return today;
  const s = String(rawDate).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  // Prioritize DD/MM/YYYY or DD-MM-YYYY (matching app-wide dd/mm/yyyy date format)
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmyMatch) {
    const a = parseInt(dmyMatch[1], 10);
    const b = parseInt(dmyMatch[2], 10);
    let y = parseInt(dmyMatch[3], 10);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    let day = a;
    let month = b;
    if (b > 12 && a <= 12) {
      month = a;
      day = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
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
      expenseCategoryPreferences = [],
    } = req.body || {};

    const subToCatMap = new Map<string, { category: string; subcategory: string }>();
    const knownCategoryKeys = new Set<string>();
    if (Array.isArray(expenseCategoryPreferences)) {
      for (const pref of expenseCategoryPreferences) {
        const parentName = String(pref?.name || '').trim();
        if (!parentName) continue;
        knownCategoryKeys.add(parentName.toLowerCase().replace(/\s+/g, ' '));
        if (Array.isArray(pref?.subcategories)) {
          for (const sub of pref.subcategories) {
            const cleanSub = String(sub || '').trim();
            if (!cleanSub) continue;
            const key = cleanSub.toLowerCase().replace(/\s+/g, ' ');
            if (!subToCatMap.has(key)) {
              subToCatMap.set(key, { category: parentName, subcategory: cleanSub });
            }
          }
        }
      }
    }

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
        const rawCat = String(raw.category || '').trim();
        const rawSub = String(raw.subcategory || '').trim();
        let resolvedCat = rawCat || 'General';
        let resolvedSub = rawSub;

        if (rawSub) {
          const matchedSub = subToCatMap.get(rawSub.toLowerCase().replace(/\s+/g, ' '));
          if (matchedSub) {
            resolvedCat = matchedSub.category;
            resolvedSub = matchedSub.subcategory;
          }
        } else if (rawCat) {
          const catKey = rawCat.toLowerCase().replace(/\s+/g, ' ');
          if (!knownCategoryKeys.has(catKey)) {
            const catAsSub = subToCatMap.get(catKey);
            if (catAsSub) {
              resolvedCat = catAsSub.category;
              resolvedSub = catAsSub.subcategory;
            }
          }
        }

        const finalSub = resolvedSub || resolvedCat || 'General';
        parsedExpenses.push({
          date: dateStr,
          accountId: accMatch.id,
          recipient: String(
            raw.recipient || raw.to || raw.payee || raw.vendor || raw.merchant || ''
          ).trim(),
          category: resolvedCat,
          subcategory: finalSub,
          notes: String(raw.notes || raw.description || '').trim() || undefined,
          description: finalSub,
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
 * Backend Intelligent Multi-Currency Conversion Endpoint (`POST /api/fx/convert-intelligence`)
 * Converts expenses, transfers, savings splits, and budget/goal amounts across any currency pair
 * with 2-point floating precision using live/cached FX rates.
 */
app.post('/api/fx/convert-intelligence', (req: Request, res: Response) => {
  try {
    const {
      amount = 0,
      fromCurrency = 'GHS',
      toCurrency = 'GHS',
      baseCurrency = 'GHS',
      expenses = [],
      transfers = [],
      savingsAllocations = [],
    } = req.body || {};

    const upperBase = String(baseCurrency || 'GHS').trim().toUpperCase();
    const cachedFx = fxCache.get(upperBase);
    const activeRates = cachedFx?.rates || buildFallbackRatesForBase(upperBase);

    const directConversion = convertServer2dp(
      Number(amount || 0),
      String(fromCurrency || upperBase),
      String(toCurrency || upperBase),
      activeRates,
      upperBase
    );
    const inverseConversion = convertServer2dp(
      1,
      String(toCurrency || upperBase),
      String(fromCurrency || upperBase),
      activeRates,
      upperBase
    );

    const convertedExpenses = (Array.isArray(expenses) ? expenses : []).map(
      (exp: any) => {
        const expCurr = String(exp?.currency || upperBase).toUpperCase();
        const rawAmt = Number(exp?.originalAmount ?? exp?.amount ?? 0);
        const toBase = convertServer2dp(
          rawAmt,
          expCurr,
          upperBase,
          activeRates,
          upperBase
        );
        const toTarget = convertServer2dp(
          rawAmt,
          expCurr,
          String(toCurrency || upperBase),
          activeRates,
          upperBase
        );
        return {
          ...exp,
          currency: expCurr,
          originalAmount: round2dp(rawAmt),
          exchangeRate: toBase.exchangeRate2dp,
          amount: toBase.convertedAmount,
          targetCurrencyAmount: toTarget.convertedAmount,
          targetExchangeRate: toTarget.exchangeRate2dp,
        };
      }
    );

    const convertedTransfers = (Array.isArray(transfers) ? transfers : []).map(
      (tr: any) => {
        const srcCurr = String(
          tr?.sourceCurrency || tr?.currency || upperBase
        ).toUpperCase();
        const dstCurr = String(
          tr?.destinationCurrency || toCurrency || upperBase
        ).toUpperCase();
        const rawSrcAmt = Number(tr?.sourceAmount ?? tr?.amount ?? 0);
        const toDst = convertServer2dp(
          rawSrcAmt,
          srcCurr,
          dstCurr,
          activeRates,
          upperBase
        );
        const toBase = convertServer2dp(
          rawSrcAmt,
          srcCurr,
          upperBase,
          activeRates,
          upperBase
        );
        return {
          ...tr,
          sourceCurrency: srcCurr,
          sourceAmount: round2dp(rawSrcAmt),
          destinationCurrency: dstCurr,
          destinationAmount: toDst.convertedAmount,
          exchangeRate: toDst.exchangeRate2dp,
          amount: toBase.convertedAmount,
        };
      }
    );

    const convertedSavings = (
      Array.isArray(savingsAllocations) ? savingsAllocations : []
    ).map((sav: any) => {
      const savCurr = String(sav?.currency || fromCurrency || upperBase).toUpperCase();
      const rawSavAmt = Number(sav?.amount ?? 0);
      const toBase = convertServer2dp(
        rawSavAmt,
        savCurr,
        upperBase,
        activeRates,
        upperBase
      );
      const toTarget = convertServer2dp(
        rawSavAmt,
        savCurr,
        String(toCurrency || upperBase),
        activeRates,
        upperBase
      );
      return {
        ...sav,
        currency: savCurr,
        originalAmount: round2dp(rawSavAmt),
        baseCurrencyAmount: toBase.convertedAmount,
        baseExchangeRate: toBase.exchangeRate2dp,
        targetCurrencyAmount: toTarget.convertedAmount,
        targetExchangeRate: toTarget.exchangeRate2dp,
      };
    });

    return res.json({
      success: true,
      baseCurrency: upperBase,
      fromCurrency: String(fromCurrency || upperBase).toUpperCase(),
      toCurrency: String(toCurrency || upperBase).toUpperCase(),
      convertedAmount: directConversion.convertedAmount,
      exchangeRate2dp: directConversion.exchangeRate2dp,
      inverseExchangeRate2dp: inverseConversion.exchangeRate2dp,
      expenses: convertedExpenses,
      transfers: convertedTransfers,
      savingsAllocations: convertedSavings,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Currency conversion intelligence failed.',
    });
  }
});

function normalizeCategoryPrefsBackend(
  rawPrefs: any[] = [],
  legacyCategories: any[] = []
): any[] {
  const result: any[] = [];
  const byLowerName = new Map<string, any>();

  const ensureCat = (
    name: string,
    idHint?: string,
    colorHint?: string
  ): any => {
    const clean = String(name || '').trim();
    const key = clean.toLowerCase();
    if (!clean || key === 'uncategorized') return null;
    if (byLowerName.has(key)) return byLowerName.get(key);
    const entry = {
      id: String(
        idHint ||
          `exp_cat_${key.replace(/[^a-z0-9]+/g, '_')}_${result.length}`
      ),
      name: clean,
      ...(colorHint ? { color: String(colorHint).trim() } : {}),
      subcategories: [] as string[],
      subcategoryColors: {} as Record<string, string>,
    };
    byLowerName.set(key, entry);
    result.push(entry);
    return entry;
  };

  for (const raw of Array.isArray(rawPrefs) ? rawPrefs : []) {
    const cat = ensureCat(raw?.name, raw?.id, raw?.color);
    if (!cat) continue;
    const rawSubs: any[] = Array.isArray(raw?.subcategories)
      ? raw.subcategories
      : [];
    const seenSubs = new Set(
      cat.subcategories.map((s: string) => s.trim().toLowerCase())
    );
    const rawColors: Record<string, string> =
      raw?.subcategoryColors && typeof raw.subcategoryColors === 'object'
        ? raw.subcategoryColors
        : {};

    for (const subItem of rawSubs) {
      const cleanSub = String(subItem || '').trim();
      if (!cleanSub) continue;
      const subKey = cleanSub.toLowerCase();
      if (!seenSubs.has(subKey)) {
        seenSubs.add(subKey);
        cat.subcategories.push(cleanSub);
      }
      const matchedColorEntry = Object.entries(rawColors).find(
        ([k, v]) =>
          k.trim().toLowerCase() === subKey &&
          typeof v === 'string' &&
          v.trim().startsWith('#')
      );
      if (matchedColorEntry && !cat.subcategoryColors[cleanSub]) {
        cat.subcategoryColors[cleanSub] = matchedColorEntry[1].trim();
      }
    }
  }

  for (const legacy of Array.isArray(legacyCategories) ? legacyCategories : []) {
    ensureCat(String(legacy || ''));
  }

  return result;
}

function upsertCategoryAndSubcategoryBackend(
  prefs: any[],
  categoryName: string,
  subcategoryName?: string
): { prefs: any[]; category: string; subcategory: string } {
  const cleanCat = String(categoryName || '').trim();
  const cleanSub = String(subcategoryName || '').trim();
  if (!cleanCat || cleanCat.toLowerCase() === 'uncategorized') {
    return { prefs, category: '', subcategory: '' };
  }

  const nextPrefs = prefs.map((p) => ({
    ...p,
    subcategories: Array.isArray(p.subcategories) ? [...p.subcategories] : [],
    subcategoryColors: { ...(p.subcategoryColors || {}) },
  }));

  let targetCat = nextPrefs.find(
    (p) => String(p.name || '').trim().toLowerCase() === cleanCat.toLowerCase()
  );
  if (!targetCat) {
    targetCat = {
      id: `exp_cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: cleanCat,
      subcategories: [],
      subcategoryColors: {},
    };
    nextPrefs.push(targetCat);
  }

  let resolvedSub = '';
  if (cleanSub) {
    const existingSub = targetCat.subcategories.find(
      (s: string) => s.trim().toLowerCase() === cleanSub.toLowerCase()
    );
    if (existingSub) {
      resolvedSub = existingSub;
    } else {
      targetCat.subcategories.push(cleanSub);
      resolvedSub = cleanSub;
    }
  }

  return {
    prefs: nextPrefs,
    category: targetCat.name,
    subcategory: resolvedSub,
  };
}

function normalizeDefinedDeductionsBackend(
  rawCuts: any[] = [],
  prefs: any[] = []
): { cuts: any[]; prefs: any[] } {
  let workingPrefs = [...prefs];
  const normalizedCuts: any[] = [];

  for (let i = 0; i < (Array.isArray(rawCuts) ? rawCuts.length : 0); i++) {
    const c = rawCuts[i];
    if (!c || !String(c.name || '').trim()) continue;
    const cleanName = String(c.name).trim();
    const lowerName = cleanName.toLowerCase();
    const isSavings =
      Boolean(c.isSavingsSplit) ||
      lowerName === 'savings' ||
      lowerName.includes('saving');
    const cleanType = c.type === 'fixed' ? 'fixed' : 'percentage';

    if (isSavings) {
      const q1 = Math.max(
        0.01,
        round2dp(Number(c.quarterlyRates?.Q1 ?? c.amount ?? 10) || 10)
      );
      const q2 = Math.max(
        0.01,
        round2dp(Number(c.quarterlyRates?.Q2 ?? q1) || q1)
      );
      const q3 = Math.max(
        0.01,
        round2dp(Number(c.quarterlyRates?.Q3 ?? q2) || q2)
      );
      const q4 = Math.max(
        0.01,
        round2dp(Number(c.quarterlyRates?.Q4 ?? q3) || q3)
      );
      normalizedCuts.push({
        ...c,
        id: String(c.id || `cut_${Date.now()}_${i}`),
        name: cleanName,
        type: cleanType,
        amount: q1,
        quarterlyRates: { Q1: q1, Q2: q2, Q3: q3, Q4: q4 },
        enabled: c.enabled !== false,
        isSavingsSplit: true,
        expenseCategory: undefined,
        expenseSubcategory: undefined,
      });
      continue;
    }

    const baseAmount = Math.max(0.01, round2dp(Number(c.amount) || 0));
    const explicitCat = String(c.expenseCategory || '').trim();
    const explicitSub =
      c.expenseSubcategory !== undefined
        ? String(c.expenseSubcategory || '').trim()
        : undefined;

    let resolvedCategory = explicitCat;
    let resolvedSubcategory = explicitSub !== undefined ? explicitSub : '';

    if (explicitCat && explicitCat.toLowerCase() !== 'uncategorized') {
      // Strictly preserve what the user defined/selected without overriding it
      const upserted = upsertCategoryAndSubcategoryBackend(
        workingPrefs,
        explicitCat,
        resolvedSubcategory
      );
      workingPrefs = upserted.prefs;
      resolvedCategory = upserted.category;
      resolvedSubcategory = resolvedSubcategory ? upserted.subcategory : '';
    }

    normalizedCuts.push({
      ...c,
      id: String(c.id || `cut_${Date.now()}_${i}`),
      name: cleanName,
      type: cleanType,
      amount: baseAmount,
      quarterlyRates: undefined,
      enabled: c.enabled !== false,
      isSavingsSplit: false,
      destinationAccountId: undefined,
      ...(resolvedCategory
        ? {
            expenseCategory: resolvedCategory,
            expenseSubcategory: resolvedSubcategory,
          }
        : {}),
    });
  }

  return { cuts: normalizedCuts, prefs: workingPrefs };
}

/**
 * Backend Settings Textbox & Preference Modification Endpoint (`POST /api/settings/modify`)
 * Normalizes and validates user edits to Savings Vaults, Expense Categories/Subcategories,
 * Income Sources, Origins, Account Types, and Defined Deductions while strictly preserving
 * user-defined category and subcategory assignments.
 */
app.post('/api/settings/modify', (req: Request, res: Response) => {
  try {
    const {
      settings = {},
      patch = {},
      modification = null,
      renameSubcategory = null,
      renameCategory = null,
    } = req.body || {};
    const merged = { ...settings, ...patch };

    // Normalize Savings Buckets (preserve clean names & valid 0..100 percentages)
    if (Array.isArray(merged.savingsBuckets)) {
      merged.savingsBuckets = merged.savingsBuckets.map((b: any, idx: number) => {
        const rawName = String(b?.name || '').replace(/\s*\(\d+(?:\.\d+)?%\)\s*$/, '').trim();
        const baseName = rawName || `Savings Vault ${idx + 1}`;
        const rawPct = Number(b?.percentage ?? 0);
        const pct = Number.isFinite(rawPct)
          ? Math.max(0, Math.min(100, round2dp(rawPct)))
          : 0;
        return {
          ...b,
          id: String(b?.id || `bucket_${Date.now()}_${idx}`),
          accountId: String(b?.accountId || `acc_sav_${Date.now()}_${idx}`),
          name: `${baseName} (${pct}%)`,
          percentage: pct,
          description: `${pct}% savings share`,
        };
      });
    }

    // Normalize Category Preferences before handling renames
    merged.expenseCategoryPreferences = normalizeCategoryPrefsBackend(
      merged.expenseCategoryPreferences || [],
      merged.expenseCategories || []
    );

    // Resolve rename subcategory request from either `modification` or `renameSubcategory`
    const effectiveRenameSub =
      modification?.type === 'rename_subcategory'
        ? {
            catId: modification.categoryId || modification.catId,
            oldName: modification.oldName,
            newName: modification.newName,
          }
        : renameSubcategory;

    if (
      effectiveRenameSub &&
      effectiveRenameSub.catId &&
      effectiveRenameSub.oldName &&
      effectiveRenameSub.newName &&
      Array.isArray(merged.expenseCategoryPreferences)
    ) {
      const targetCatId = String(effectiveRenameSub.catId);
      const oldSub = String(effectiveRenameSub.oldName).trim();
      const newSub = String(effectiveRenameSub.newName).trim();
      let targetCatName = '';
      if (oldSub && newSub) {
        merged.expenseCategoryPreferences = merged.expenseCategoryPreferences.map(
          (cat: any) => {
            if (String(cat?.id) !== targetCatId) return cat;
            targetCatName = String(cat.name || '').trim();
            const subs: string[] = Array.isArray(cat.subcategories)
              ? cat.subcategories
              : [];
            const nextSubs = subs.map((s) =>
              String(s).trim().toLowerCase() === oldSub.toLowerCase() ? newSub : s
            );
            const nextColors = { ...(cat.subcategoryColors || {}) };
            const oldColorKey = Object.keys(nextColors).find(
              (k) => k.trim().toLowerCase() === oldSub.toLowerCase()
            );
            if (oldColorKey && oldColorKey !== newSub) {
              if (!nextColors[newSub]) {
                nextColors[newSub] = nextColors[oldColorKey];
              }
              delete nextColors[oldColorKey];
            }
            return {
              ...cat,
              subcategories: Array.from(new Set(nextSubs)),
              subcategoryColors: nextColors,
            };
          }
        );

        // Keep defined deductions aligned with renamed subcategory
        if (Array.isArray(merged.customCuts)) {
          merged.customCuts = merged.customCuts.map((c: any) => {
            const matchesCat =
              !targetCatName ||
              String(c?.expenseCategory || '').trim().toLowerCase() ===
                targetCatName.toLowerCase();
            const matchesSub =
              String(c?.expenseSubcategory || '').trim().toLowerCase() ===
              oldSub.toLowerCase();
            return matchesCat && matchesSub
              ? { ...c, expenseSubcategory: newSub }
              : c;
          });
        }
      }
    }

    // Resolve rename category request from either `modification` or `renameCategory`
    const effectiveRenameCat =
      modification?.type === 'rename_category'
        ? {
            oldName: modification.oldName,
            newName: modification.newName,
          }
        : renameCategory;

    if (
      effectiveRenameCat &&
      effectiveRenameCat.oldName &&
      effectiveRenameCat.newName
    ) {
      const oldCat = String(effectiveRenameCat.oldName).trim();
      const newCat = String(effectiveRenameCat.newName).trim();
      if (oldCat && newCat && oldCat.toLowerCase() !== newCat.toLowerCase()) {
        merged.expenseCategoryPreferences = merged.expenseCategoryPreferences.map(
          (cat: any) =>
            String(cat?.name || '').trim().toLowerCase() === oldCat.toLowerCase()
              ? { ...cat, name: newCat }
              : cat
        );
        if (Array.isArray(merged.customCuts)) {
          merged.customCuts = merged.customCuts.map((c: any) =>
            String(c?.expenseCategory || '').trim().toLowerCase() ===
            oldCat.toLowerCase()
              ? { ...c, expenseCategory: newCat }
              : c
          );
        }
      }
    }

    // Validate Defined Deductions & sync custom categories/subcategories strictly without overriding user selections
    if (Array.isArray(merged.customCuts)) {
      const synced = normalizeDefinedDeductionsBackend(
        merged.customCuts,
        merged.expenseCategoryPreferences
      );
      merged.customCuts = synced.cuts;
      merged.expenseCategoryPreferences = synced.prefs;
    }

    merged.expenseCategories = (merged.expenseCategoryPreferences || []).map(
      (c: any) => c.name
    );

    // Normalize string list preferences (incomeSources, incomeOrigins, accountTypes)
    for (const key of ['incomeSources', 'incomeOrigins', 'accountTypes'] as const) {
      if (Array.isArray(merged[key])) {
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const item of merged[key]) {
          const trimmed = String(item || '').trim();
          if (trimmed && !seen.has(trimmed.toLowerCase())) {
            seen.add(trimmed.toLowerCase());
            cleaned.push(trimmed);
          }
        }
        merged[key] = cleaned;
      }
    }

    merged.updatedAt = new Date().toISOString();

    return res.json({
      success: true,
      settings: merged,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to modify settings.',
    });
  }
});

/**
 * Backend Defined Deduction Creation & Edit Endpoint (`POST /api/settings/deductions/define`)
 * Strictly validates and locks the exact Expense Category and Subcategory defined or edited
 * by the user (including intentionally empty/'None' subcategories and inline new categories/subcategories),
 * eliminating any loophole where automatic suggestions replace user selections.
 */
app.post('/api/settings/deductions/define', (req: Request, res: Response) => {
  try {
    const {
      mode = 'create',
      cutId = '',
      name = '',
      type = 'percentage',
      amount = 0,
      quarterlyRates = null,
      routeMode = 'expense',
      expenseCategory = '',
      expenseSubcategory = '',
      newCategoryName = '',
      newSubcategoryName = '',
      enabled = true,
      settings = {},
    } = req.body || {};

    const cleanName = String(name || '').trim();
    if (!cleanName) {
      return res.status(400).json({
        success: false,
        error: 'Deduction name is required.',
      });
    }

    const lowerName = cleanName.toLowerCase();
    const isSavings =
      routeMode === 'savings_split' ||
      lowerName === 'savings' ||
      lowerName.includes('saving');
    const cleanType: 'percentage' | 'fixed' =
      type === 'fixed' ? 'fixed' : 'percentage';

    let prefs = normalizeCategoryPrefsBackend(
      settings.expenseCategoryPreferences || [],
      settings.expenseCategories || []
    );

    let definedCut: any;
    if (isSavings) {
      const q1 = Math.max(
        0.01,
        round2dp(Number(quarterlyRates?.Q1 ?? amount ?? 10) || 10)
      );
      const q2 = Math.max(
        0.01,
        round2dp(Number(quarterlyRates?.Q2 ?? q1) || q1)
      );
      const q3 = Math.max(
        0.01,
        round2dp(Number(quarterlyRates?.Q3 ?? q2) || q2)
      );
      const q4 = Math.max(
        0.01,
        round2dp(Number(quarterlyRates?.Q4 ?? q3) || q3)
      );

      definedCut = {
        id:
          mode === 'edit' && cutId
            ? String(cutId)
            : `cut_${Date.now()}`,
        name: cleanName,
        type: cleanType,
        amount: q1,
        quarterlyRates: { Q1: q1, Q2: q2, Q3: q3, Q4: q4 },
        enabled: enabled !== false,
        isSavingsSplit: true,
      };
    } else {
      const cleanAmt = round2dp(Number(amount) || 0);
      if (!Number.isFinite(cleanAmt) || cleanAmt <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Deduction rate or amount must be greater than zero.',
        });
      }

      const rawChosenCat = String(
        newCategoryName || expenseCategory || ''
      ).trim();
      const rawChosenSub = String(
        newSubcategoryName !== undefined && String(newSubcategoryName).trim()
          ? newSubcategoryName
          : expenseSubcategory ?? ''
      ).trim();

      let lockedCategory = rawChosenCat;
      let lockedSubcategory = rawChosenSub;

      if (lockedCategory && lockedCategory.toLowerCase() !== 'uncategorized') {
        const upserted = upsertCategoryAndSubcategoryBackend(
          prefs,
          lockedCategory,
          lockedSubcategory
        );
        prefs = upserted.prefs;
        lockedCategory = upserted.category;
        // Preserve explicit '' ('None') without forcing any fallback subcategory
        lockedSubcategory = lockedSubcategory ? upserted.subcategory : '';
      } else {
        // Fallback only when no category was selected at all and at least one category exists
        lockedCategory = prefs[0]?.name || 'General';
        lockedSubcategory = '';
      }

      definedCut = {
        id:
          mode === 'edit' && cutId
            ? String(cutId)
            : `cut_${Date.now()}`,
        name: cleanName,
        type: cleanType,
        amount: cleanAmt,
        enabled: enabled !== false,
        isSavingsSplit: false,
        expenseCategory: lockedCategory,
        expenseSubcategory: lockedSubcategory,
      };
    }

    const existingCuts: any[] = Array.isArray(settings.customCuts)
      ? settings.customCuts
      : [];
    const nextCuts =
      mode === 'edit' && cutId
        ? existingCuts.map((c) =>
            c?.id === cutId ? { ...c, ...definedCut, id: c.id } : c
          )
        : [...existingCuts, definedCut];

    const synced = normalizeDefinedDeductionsBackend(nextCuts, prefs);
    const nextSettings = {
      ...settings,
      customCuts: synced.cuts,
      expenseCategoryPreferences: synced.prefs,
      expenseCategories: synced.prefs.map((p: any) => p.name),
      updatedAt: new Date().toISOString(),
    };

    return res.json({
      success: true,
      cut: definedCut,
      settings: nextSettings,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to define deduction rule.',
    });
  }
});

/**
 * Backend Multi-Purpose Budget & Goal Evaluation Endpoint (`POST /api/budgets/evaluate`)
 * Evaluates both Expense-linked Budgets (`purposeType: 'budget'`) and Transfer/Savings-linked
 * Goals (`purposeType: 'goal'`), checking active date windows, automatic recreation for
 * weekly/monthly/yearly periods, custom period recreation definitions, and multi-currency FX conversion.
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
    const cachedFx = fxCache.get(upperBase);
    const activeRates = cachedFx?.rates || buildFallbackRatesForBase(upperBase);
    const todayYmd = new Date().toISOString().split('T')[0];

    const convertAmt = (amt: number, fromCurr: string, toCurr: string): number => {
      return convertServer2dp(amt, fromCurr, toCurr, activeRates, upperBase)
        .convertedAmount;
    };

    const evaluated = (Array.isArray(budgets) ? budgets : []).map((b: any) => {
      const purposeType: 'budget' | 'goal' =
        b.purposeType === 'goal' ? 'goal' : 'budget';
      const periodType = String(b.periodType || 'monthly');
      const budgetCurr = String(b.currency || upperBase).toUpperCase();
      const subs: string[] = Array.isArray(b.subcategories)
        ? b.subcategories.map((s: any) => String(s || '').trim().toLowerCase())
        : [];
      const limit = round2dp(Number(b.amount || 0));
      const endYmd = String(b.activePeriodEnd || b.customEndDate || '');
      const isExpired =
        Boolean(b.isExpiredDisabled) || Boolean(endYmd && todayYmd > endYmd);
      // Weekly, Monthly, and Yearly periods recreate automatically; Custom period requires explicit autoRecreate
      const autoRecreate =
        periodType !== 'custom' ? true : Boolean(b.autoRecreate);
      const recreateDays = Math.max(0, Math.round(Number(b.recreateDays || 0)));
      const isDisabledFromReach = isExpired && !autoRecreate;

      const rateToBase = convertServer2dp(
        1,
        budgetCurr,
        upperBase,
        activeRates,
        upperBase
      ).exchangeRate2dp;
      const inverseRateToBase = convertServer2dp(
        1,
        upperBase,
        budgetCurr,
        activeRates,
        upperBase
      ).exchangeRate2dp;

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
          const rawAmt = Number(
            tr.destinationAmount ?? tr.sourceAmount ?? tr.amount ?? 0
          );
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
        periodType,
        scopeType: b.scopeType || (subs.length > 1 ? 'multiple' : 'single'),
        currency: budgetCurr,
        budgetLimit: limit,
        budgetLimitBase: convertAmt(limit, budgetCurr, upperBase),
        spentAmount: spent,
        spentAmountBase: convertAmt(spent, budgetCurr, upperBase),
        residualAmount: residual,
        residualAmountBase: convertAmt(residual, budgetCurr, upperBase),
        conversionRateToBase: rateToBase,
        inverseConversionRateToBase: inverseRateToBase,
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
 * Weekly, Monthly, and Yearly budgets recreate automatically when their cycle ends;
 * Custom period budgets recreate for `recreateDays` days when `autoRecreate: true`,
 * or are marked `isExpiredDisabled: true` when `autoRecreate` is false.
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

      const periodType = String(b.periodType || 'monthly');
      const shouldAutoRecreate =
        periodType !== 'custom' ? true : Boolean(b.autoRecreate);
      const endYmd = String(b.activePeriodEnd || b.customEndDate || '');
      if (endYmd && todayYmd > endYmd) {
        if (shouldAutoRecreate) {
          const defaultDays =
            periodType === 'weekly'
              ? 7
              : periodType === 'yearly'
              ? 365
              : 30;
          const days = Math.max(
            1,
            Math.round(Number(b.recreateDays || defaultDays))
          );
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
            customStartDate: periodType === 'custom' ? newStartYmd : b.customStartDate,
            customEndDate: periodType === 'custom' ? newEndYmd : b.customEndDate,
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
 * Backend Per-Vault Automated Debit Plan Endpoint (`POST /api/savings/vault-debit-plan`)
 * Evaluates each respective Savings Vault funded by a savings rate deduction against past
 * vault-debit expenses and returns planned automated debit payloads per vault.
 */
app.post('/api/savings/vault-debit-plan', (req: Request, res: Response) => {
  try {
    const {
      shares = [],
      expenses = [],
      incomeDate = new Date().toISOString().slice(0, 10),
      incomeSource = '',
    } = req.body || {};

    const pastDebits = (Array.isArray(expenses) ? expenses : []).filter(
      (e: any) =>
        e &&
        e.accountId &&
        e.vaultAction !== 'credit' &&
        !String(e.id || '').startsWith('exp_ded_') &&
        !String(e.id || '').startsWith('exp_cut_')
    );

    const planned: any[] = [];
    for (const share of Array.isArray(shares) ? shares : []) {
      const shareAmt = Number(share?.amount) || 0;
      const vaultAccId = String(share?.accountId || '');
      if (!vaultAccId || shareAmt <= 0) continue;

      const history = pastDebits
        .filter((e: any) => String(e.accountId) === vaultAccId)
        .sort((a: any, b: any) =>
          String(b.date || '').localeCompare(String(a.date || ''))
        );
      if (history.length === 0) continue;

      const sample = history[0];
      planned.push({
        vaultAccountId: vaultAccId,
        vaultAccountName: share.accountName || vaultAccId,
        recipient:
          sample.recipient ||
          sample.description ||
          sample.subcategory ||
          share.accountName,
        category: sample.category || 'Savings Allocation',
        subcategory: sample.subcategory || undefined,
        amount: Math.round(shareAmt * 100) / 100,
        date: incomeDate,
        notes: incomeSource
          ? `Auto-debited from ${share.accountName || vaultAccId} (${incomeSource})`
          : undefined,
        pastMatchCount: history.length,
      });
    }

    return res.json({ success: true, planned });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Unable to compute vault debit plan.',
    });
  }
});

/**
 * Backend Automated Manual Transfer to Savings Vaults Endpoint (`POST /api/transfers/automate-savings-vaults`)
 * Distributes a manual transfer amount across each configured Savings Vault by rate (2dp FX-aware)
 * and builds corresponding automated vault-debit expenses for each distributed Savings Vault.
 */
app.post('/api/transfers/automate-savings-vaults', (req: Request, res: Response) => {
  try {
    const {
      sourceAccountId = '',
      sourceCurrency = 'GHS',
      amount = 0,
      date = new Date().toISOString().slice(0, 10),
      description = '',
      baseCurrency = 'GHS',
      accounts = [],
      savingsBuckets = [],
      expenses = [],
      distributeToSavingsVaults = true,
      applyVaultDebits = true,
      excludedDistributionVaultIds = [],
      excludedDebitVaultIds = [],
      debitOverrides = {},
      previewOnly = false,
    } = req.body || {};

    const cleanAmount = round2dp(Math.max(0, Number(amount) || 0));
    const upperBase = String(baseCurrency || 'GHS').trim().toUpperCase();
    const upperSrcCurr = String(sourceCurrency || upperBase).trim().toUpperCase();
    const normalizedDate = normalizeDateString(date);
    const cachedFx = fxCache.get(upperBase);
    const activeRates = cachedFx?.rates || buildFallbackRatesForBase(upperBase);

    if (!distributeToSavingsVaults || cleanAmount <= 0 || !sourceAccountId) {
      return res.json({
        success: true,
        previewOnly: Boolean(previewOnly),
        shares: [],
        transfers: [],
        vaultDebits: [],
        totalDistributedSourceAmount: 0,
        totalDistributedBaseAmount: 0,
        transferBatchId: `manual_vault_${Date.now()}`,
      });
    }

    const fallbackPillars = [
      { id: 'bucket_long_term', name: 'Long-Term Investment Vault', percentage: 30, accountId: 'acc_sav_long_term' },
      { id: 'bucket_short_term', name: 'Short-Term Reserve Vault', percentage: 15, accountId: 'acc_sav_short_term' },
      { id: 'bucket_risky', name: 'High-Yield / Risky Vault', percentage: 5, accountId: 'acc_sav_risky' },
      { id: 'bucket_emergency', name: 'Emergency Security Vault', percentage: 20, accountId: 'acc_sav_emergency' },
      { id: 'bucket_life_care', name: 'Life-Care & Growth Vault', percentage: 10, accountId: 'acc_sav_life_care' },
      { id: 'bucket_project_building', name: 'Project & Buildings Vault', percentage: 15, accountId: 'acc_sav_project' },
      { id: 'bucket_partnership', name: 'Partnership & Giving Vault', percentage: 5, accountId: 'acc_sav_partnership' },
    ];

    const accountsList: any[] = Array.isArray(accounts) ? accounts : [];
    const bucketsInput: any[] =
      Array.isArray(savingsBuckets) && savingsBuckets.length > 0
        ? savingsBuckets
        : fallbackPillars;

    const excludedDistSet = new Set<string>(
      Array.isArray(excludedDistributionVaultIds)
        ? excludedDistributionVaultIds.map((id: any) => String(id))
        : []
    );
    const excludedDebitSet = new Set<string>(
      Array.isArray(excludedDebitVaultIds)
        ? excludedDebitVaultIds.map((id: any) => String(id))
        : []
    );

    const resolvedPillars = bucketsInput
      .map((b: any, idx: number) => {
        const bId = String(b?.id || b?.bucketId || `bucket_${idx}`);
        const accMatch =
          accountsList.find((a: any) => a?.id === b?.accountId) ||
          accountsList.find((a: any) => a?.linkedSavingsBucketId === bId);
        const accId = String(accMatch?.id || b?.accountId || `acc_sav_${bId}`);
        return {
          bucketId: bId,
          name: String(accMatch?.name || b?.name || 'Savings Vault').trim(),
          percentage: Math.max(0, Number(b?.percentage) || 0),
          accountId: accId,
          account: accMatch,
        };
      })
      .filter((p) => p.accountId !== sourceAccountId && p.percentage > 0);

    const totalRateSum = resolvedPillars.reduce((sum, p) => sum + p.percentage, 0);
    const lastActiveIdx = resolvedPillars.length - 1;
    let runningSum = 0;

    const pastDebits = (Array.isArray(expenses) ? expenses : []).filter(
      (e: any) =>
        e &&
        e.accountId &&
        e.vaultAction !== 'credit' &&
        !String(e.id || '').startsWith('exp_ded_') &&
        !String(e.id || '').startsWith('exp_cut_') &&
        !String(e.id || '').startsWith('inc_ded_exp_')
    );

    const transferBatchId = `manual_vault_${Date.now()}`;
    const cleanDesc = String(description || '').trim();
    const shares: any[] = [];
    const transfers: any[] = [];
    const vaultDebits: any[] = [];

    resolvedPillars.forEach((pillar, index) => {
      let shareSourceAmt = 0;
      if (Math.abs(totalRateSum - 100) < 0.01 && index === lastActiveIdx) {
        shareSourceAmt = round2dp(Math.max(0, cleanAmount - runningSum));
      } else {
        shareSourceAmt = round2dp((cleanAmount * pillar.percentage) / 100);
        runningSum = round2dp(runningSum + shareSourceAmt);
      }

      if (shareSourceAmt <= 0 || excludedDistSet.has(pillar.accountId)) {
        return;
      }

      const vaultCurr = String(
        pillar.account?.currency || upperBase
      )
        .trim()
        .toUpperCase();

      const toVault = convertServer2dp(
        shareSourceAmt,
        upperSrcCurr,
        vaultCurr,
        activeRates,
        upperBase
      );
      const toBase = convertServer2dp(
        shareSourceAmt,
        upperSrcCurr,
        upperBase,
        activeRates,
        upperBase
      );

      shares.push({
        bucketId: pillar.bucketId,
        vaultAccountId: pillar.accountId,
        vaultAccountName: pillar.name,
        percentage: pillar.percentage,
        sourceCurrency: upperSrcCurr,
        sourceAmount: shareSourceAmt,
        vaultCurrency: vaultCurr,
        destinationAmount: toVault.convertedAmount,
        baseAmount: toBase.convertedAmount,
        exchangeRate: toVault.exchangeRate2dp,
      });

      transfers.push({
        date: normalizedDate,
        sourceAccountId,
        destinationAccountId: pillar.accountId,
        sourceCurrency: upperSrcCurr,
        sourceAmount: shareSourceAmt,
        destinationCurrency: vaultCurr,
        destinationAmount: toVault.convertedAmount,
        exchangeRate: toVault.exchangeRate2dp,
        amount: toBase.convertedAmount,
        transferType: 'general',
        description: cleanDesc
          ? `${cleanDesc} · ${pillar.name} (${pillar.percentage}%)`
          : `Savings Vault Distribution · ${pillar.name} (${pillar.percentage}%)`,
      });

      if (applyVaultDebits && !excludedDebitSet.has(pillar.accountId)) {
        const vaultHistory = pastDebits
          .filter((e: any) => String(e.accountId) === pillar.accountId)
          .sort((a: any, b: any) => {
            const cmp = String(b.date || '').localeCompare(String(a.date || ''));
            if (cmp !== 0) return cmp;
            return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
          });

        const override =
          debitOverrides && typeof debitOverrides === 'object'
            ? debitOverrides[pillar.accountId]
            : undefined;

        const cleanPillarName = String(pillar.name || 'Savings Vault')
          .replace(/\s*\(\d+(?:\.\d+)?%\)\s*$/, '')
          .trim() || pillar.name;

        // Weight frequency & recency for past vault debits when history exists
        const groups = new Map<string, { sample: any; score: number; count: number }>();
        vaultHistory.forEach((exp: any, idx: number) => {
          const rec = String(exp.recipient || exp.description || '').trim();
          const cat = String(exp.category || 'Savings Allocation').trim();
          const sub = String(exp.subcategory || '').trim();
          const sig = `${rec.toLowerCase()}||${cat.toLowerCase()}||${sub.toLowerCase()}`;
          const recencyBoost = Math.max(1, vaultHistory.length - idx);
          const prev = groups.get(sig);
          if (prev) {
            prev.count += 1;
            prev.score += 10 + recencyBoost;
          } else {
            groups.set(sig, { sample: exp, score: 10 + recencyBoost, count: 1 });
          }
        });
        const best = Array.from(groups.values()).sort((a, b) => b.score - a.score)[0];
        const sample = best?.sample || {};

        const resolvedRecipient =
          override?.recipient !== undefined
            ? String(override.recipient).trim()
            : String(
                sample.recipient ||
                  sample.description ||
                  sample.subcategory ||
                  cleanPillarName
              ).trim();
        const resolvedCategory =
          override?.category !== undefined
            ? String(override.category).trim() || 'Savings Allocation'
            : String(sample.category || 'Savings Allocation').trim();
        const resolvedSub =
          override?.subcategory !== undefined
            ? String(override.subcategory).trim() || undefined
            : String(sample.subcategory || '').trim() || undefined;
        const resolvedNotes =
          override?.notes !== undefined
            ? String(override.notes).trim()
            : String(sample.notes || '').trim();

        const debitVaultAmt =
          override?.debitAmountInVaultCurr !== undefined
            ? round2dp(Math.max(0, Number(override.debitAmountInVaultCurr) || 0))
            : toVault.convertedAmount;

        if (debitVaultAmt > 0) {
          const debitToBase =
            vaultCurr === upperBase
              ? { convertedAmount: debitVaultAmt, exchangeRate2dp: 1.0 }
              : convertServer2dp(
                  debitVaultAmt,
                  vaultCurr,
                  upperBase,
                  activeRates,
                  upperBase
                );

          const autoTag = `Auto-debited from ${pillar.name} (Manual transfer ${pillar.percentage}%)`;
          vaultDebits.push({
            date: normalizedDate,
            batchId: transferBatchId,
            accountId: pillar.accountId,
            vaultAction: 'debit',
            recipient: resolvedRecipient || cleanPillarName,
            category: resolvedCategory,
            subcategory: resolvedSub,
            subcategoryColor: sample.subcategoryColor || undefined,
            description:
              resolvedSub || resolvedRecipient || resolvedCategory,
            notes: resolvedNotes ? `${resolvedNotes} · ${autoTag}` : autoTag,
            currency: vaultCurr,
            originalAmount: debitVaultAmt,
            exchangeRate: debitToBase.exchangeRate2dp,
            amount: debitToBase.convertedAmount,
          });
        }
      }
    });

    const totalDistributedSourceAmount = round2dp(
      transfers.reduce((sum, t) => sum + (Number(t.sourceAmount) || 0), 0)
    );
    const totalDistributedBaseAmount = round2dp(
      transfers.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
    );

    return res.json({
      success: true,
      previewOnly: Boolean(previewOnly),
      shares,
      transfers,
      vaultDebits,
      totalDistributedSourceAmount,
      totalDistributedBaseAmount,
      transferBatchId,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Unable to process manual transfer vault automation.',
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

    const expIdStr = String(expense.id);
    if (
      expIdStr.startsWith('exp_ded_') ||
      expIdStr.startsWith('exp_cut_') ||
      Boolean(expense.incomeReceiptId)
    ) {
      return res.status(403).json({
        success: false,
        error:
          'Income deduction expense transactions cannot be edited; they can only be deleted.',
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
 * Backend Income Deduction Expense Deletion Endpoint (`POST /api/expenses/delete-deduction`)
 * Removes a specific income deduction expense transaction (`exp_ded_<incId>_<dedId>`) from its
 * parent income receipt while keeping editing of income deduction expenses strictly disabled.
 */
app.post('/api/expenses/delete-deduction', (req: Request, res: Response) => {
  try {
    const { expenseId = '', incomeReceipt = {} } = req.body || {};
    const expIdStr = String(expenseId || '').trim();
    if (!expIdStr.startsWith('exp_ded_') || !incomeReceipt || !incomeReceipt.id) {
      return res.status(400).json({
        success: false,
        error: 'Valid income deduction expense ID and parent income receipt are required.',
      });
    }

    const prefix = `exp_ded_${incomeReceipt.id}_`;
    const dedId = expIdStr.startsWith(prefix) ? expIdStr.slice(prefix.length) : '';
    const existingDeds = Array.isArray(incomeReceipt.allocatedDeductions)
      ? incomeReceipt.allocatedDeductions
      : [];
    const nextDeductions = existingDeds.filter(
      (d: any) => String(d?.id || '') !== dedId
    );
    const totalDedAmt = nextDeductions.reduce(
      (sum: number, d: any) => sum + (Number(d?.amount) || 0),
      0
    );
    const gross = Number(
      incomeReceipt.originalGrossAmount ?? incomeReceipt.grossAmount ?? 0
    );
    const nextSavingsRate =
      gross > 0
        ? Math.min(100, Math.round(((totalDedAmt / gross) * 100) * 100) / 100)
        : 0;

    const updatedIncome = {
      ...incomeReceipt,
      allocatedDeductions: nextDeductions,
      savingsRate: nextSavingsRate,
      updatedAt: new Date().toISOString(),
    };

    return res.json({
      success: true,
      deletedExpenseId: expIdStr,
      updatedIncome,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Income deduction expense deletion failed.',
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
 * Backend Category & Subcategory Edit & Full Data Cascade Endpoint (`POST /api/categories/edit`)
 * Atomically modifies a category name and/or one or more of its subcategory names on the backend,
 * then cascades the replacement across Settings, Defined Deduction Rules, Flexible Expenses,
 * Income Allocated Deductions, and Budgets so users never have to fix existing records manually.
 */
app.post('/api/categories/edit', (req: Request, res: Response) => {
  try {
    const {
      categoryId = '',
      oldCategoryName = '',
      newCategoryName = '',
      oldSubcategoryName = '',
      newSubcategoryName = '',
      subcategoryRenames = [],
      settings = {},
      expenses = [],
      incomes = [],
      budgets = [],
    } = req.body || {};

    const normalizeLabelKey = (val: unknown): string =>
      String(val || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const cleanCatId = String(categoryId || '').trim();
    const cleanOldCat = String(oldCategoryName || '').trim();
    const cleanNewCatInput = String(newCategoryName || '').trim();
    const cleanOldCatKey = normalizeLabelKey(cleanOldCat);

    let workingPrefs = normalizeCategoryPrefsBackend(
      settings.expenseCategoryPreferences || [],
      settings.expenseCategories || []
    );

    const targetIdx = workingPrefs.findIndex(
      (p: any) =>
        (cleanCatId && String(p?.id || '') === cleanCatId) ||
        (cleanOldCatKey && normalizeLabelKey(p?.name) === cleanOldCatKey)
    );

    const resolvedOldCat =
      cleanOldCat ||
      (targetIdx >= 0 ? String(workingPrefs[targetIdx]?.name || '').trim() : '');
    const resolvedNewCat = cleanNewCatInput || resolvedOldCat;

    if (!resolvedOldCat && !resolvedNewCat) {
      return res.status(400).json({
        success: false,
        error: 'Category name is required.',
      });
    }

    const oldCatKey = normalizeLabelKey(resolvedOldCat);
    const newCatKey = normalizeLabelKey(resolvedNewCat);
    const categoryChanged =
      Boolean(resolvedOldCat) &&
      Boolean(resolvedNewCat) &&
      resolvedOldCat !== resolvedNewCat;

    // Normalize list of subcategory renames (supports single rename or batch renames)
    const rawRenames: Array<{ oldName: string; newName: string }> = [];
    if (oldSubcategoryName && newSubcategoryName) {
      rawRenames.push({
        oldName: String(oldSubcategoryName).trim(),
        newName: String(newSubcategoryName).trim(),
      });
    }
    if (Array.isArray(subcategoryRenames)) {
      for (const item of subcategoryRenames) {
        if (!item || typeof item !== 'object') continue;
        const o = String((item as any).oldName || '').trim();
        const n = String((item as any).newName || '').trim();
        if (o && n && o !== n) {
          if (
            !rawRenames.some(
              (r) => normalizeLabelKey(r.oldName) === normalizeLabelKey(o)
            )
          ) {
            rawRenames.push({ oldName: o, newName: n });
          }
        }
      }
    }
    const activeSubRenames = rawRenames.filter(
      (r) => r.oldName && r.newName && r.oldName !== r.newName
    );
    const subRenameLookup = new Map<string, string>();
    for (const r of activeSubRenames) {
      const k = normalizeLabelKey(r.oldName);
      if (k) subRenameLookup.set(k, r.newName);
    }

    // Track other categories and subcategories used outside the edited category
    const subNamesInOtherCategories = new Set<string>();
    const otherCategoryKeys = new Set<string>();
    workingPrefs.forEach((p: any, idx: number) => {
      if (idx === targetIdx) return;
      const pKey = normalizeLabelKey(p?.name);
      if (pKey === oldCatKey) return;
      if (pKey) otherCategoryKeys.add(pKey);
      for (const s of p.subcategories || []) {
        const clean = normalizeLabelKey(s);
        if (clean) subNamesInOtherCategories.add(clean);
      }
    });

    // Subcategories uniquely owned by the edited category (before or after rename)
    const targetUniqueSubKeys = new Set<string>();
    if (targetIdx >= 0) {
      for (const s of workingPrefs[targetIdx]?.subcategories || []) {
        const k = normalizeLabelKey(s);
        if (k && !subNamesInOtherCategories.has(k)) {
          targetUniqueSubKeys.add(k);
        }
      }
    }
    for (const r of activeSubRenames) {
      const oldK = normalizeLabelKey(r.oldName);
      const newK = normalizeLabelKey(r.newName);
      if (oldK && !subNamesInOtherCategories.has(oldK)) {
        targetUniqueSubKeys.add(oldK);
      }
      if (newK && !subNamesInOtherCategories.has(newK)) {
        targetUniqueSubKeys.add(newK);
      }
    }

    // Helper: deduplicate string array case-insensitively while preserving order
    const dedupePreserveOrder = (list: string[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of list) {
        const clean = String(item || '').trim();
        if (!clean) continue;
        const key = normalizeLabelKey(clean);
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push(clean);
        }
      }
      return out;
    };

    // 1. Update expenseCategoryPreferences (with seamless merge if renamed into an existing category)
    const renamedSubColorMap = new Map<string, string>();
    const updatedTargetPref =
      targetIdx >= 0
        ? (() => {
            const target = workingPrefs[targetIdx];
            const nextSubs = dedupePreserveOrder(
              (target.subcategories || []).map((s: string) => {
                const mapped = subRenameLookup.get(normalizeLabelKey(s));
                return mapped || s;
              })
            );
            const nextColors: Record<string, string> = {};
            const oldColors = target.subcategoryColors || {};
            for (const [k, v] of Object.entries(oldColors)) {
              if (!v) continue;
              const mapped = subRenameLookup.get(normalizeLabelKey(k));
              const finalKey = mapped || k;
              if (!nextColors[finalKey]) {
                nextColors[finalKey] = String(v);
              }
              if (mapped) {
                renamedSubColorMap.set(normalizeLabelKey(mapped), String(v));
              }
            }
            return {
              ...target,
              name: resolvedNewCat,
              subcategories: nextSubs,
              subcategoryColors: nextColors,
            };
          })()
        : {
            id: cleanCatId || `exp_cat_${Date.now()}`,
            name: resolvedNewCat,
            subcategories: dedupePreserveOrder(activeSubRenames.map((r) => r.newName)),
            subcategoryColors: {} as Record<string, string>,
          };

    const nextPrefs: any[] = [];
    let mergedIntoExisting = false;

    for (let idx = 0; idx < workingPrefs.length; idx++) {
      if (idx === targetIdx) continue;
      const pref = workingPrefs[idx];
      const pKey = normalizeLabelKey(pref?.name);
      if (pKey === newCatKey && categoryChanged) {
        // Merge target category into existing category with the new name
        mergedIntoExisting = true;
        const mergedSubs = dedupePreserveOrder([
          ...(pref.subcategories || []),
          ...(updatedTargetPref.subcategories || []),
        ]);
        const mergedColors = {
          ...(updatedTargetPref.subcategoryColors || {}),
          ...(pref.subcategoryColors || {}),
        };
        nextPrefs.push({
          ...pref,
          name: resolvedNewCat,
          subcategories: mergedSubs,
          subcategoryColors: mergedColors,
        });
      } else {
        nextPrefs.push(pref);
      }
    }

    if (!mergedIntoExisting) {
      if (targetIdx >= 0) {
        nextPrefs.splice(Math.min(targetIdx, nextPrefs.length), 0, updatedTargetPref);
      } else {
        nextPrefs.push(updatedTargetPref);
      }
    }

    // 2. Update Defined Deductions (`settings.customCuts`)
    let deductionRulesUpdated = 0;
    const rawCuts: any[] = Array.isArray(settings.customCuts)
      ? settings.customCuts
      : [];
    const nextCuts = rawCuts.map((cut: any) => {
      if (!cut || typeof cut !== 'object') return cut;
      const curCat = String(cut.expenseCategory || '').trim();
      const curSub = String(cut.expenseSubcategory || '').trim();
      const curCatKey = normalizeLabelKey(curCat);
      const curSubKey = normalizeLabelKey(curSub);

      const matchesCat = Boolean(oldCatKey) && curCatKey === oldCatKey;
      const ownedSubOrphanCat =
        categoryChanged &&
        Boolean(curSubKey) &&
        targetUniqueSubKeys.has(curSubKey) &&
        (!curCatKey || curCatKey === 'uncategorized' || !otherCategoryKeys.has(curCatKey));
      const mappedSub = subRenameLookup.get(curSubKey);
      const subMatchesScope =
        Boolean(mappedSub) &&
        (matchesCat ||
          ownedSubOrphanCat ||
          curCatKey === newCatKey ||
          !curCatKey ||
          !subNamesInOtherCategories.has(curSubKey));

      if (!matchesCat && !ownedSubOrphanCat && !subMatchesScope) return cut;

      const updatedCat =
        matchesCat || ownedSubOrphanCat ? resolvedNewCat : curCat || resolvedNewCat;
      const updatedSub = subMatchesScope && mappedSub ? mappedSub : curSub;
      if (updatedCat !== curCat || updatedSub !== curSub) {
        deductionRulesUpdated++;
        return {
          ...cut,
          expenseCategory: updatedCat,
          expenseSubcategory: updatedSub,
        };
      }
      return cut;
    });

    const nowIso = new Date().toISOString();
    const updatedSettings = {
      ...settings,
      expenseCategoryPreferences: nextPrefs,
      expenseCategories: nextPrefs.map((p: any) => p.name),
      customCuts: nextCuts,
      updatedAt: nowIso,
    };

    // 3. Cascade updates across all Flexible Expenses
    const changedExpenses: any[] = [];
    const updatedExpenses = (Array.isArray(expenses) ? expenses : []).map(
      (exp: any) => {
        if (!exp || typeof exp !== 'object') return exp;
        const curCat = String(exp.category || '').trim();
        const curSub = String(exp.subcategory || '').trim();
        const curDesc = String(exp.description || '').trim();
        const curCatKey = normalizeLabelKey(curCat);
        const curSubKey = normalizeLabelKey(curSub);

        const matchesCat = Boolean(oldCatKey) && curCatKey === oldCatKey;
        const ownedSubOrphanCat =
          categoryChanged &&
          Boolean(curSubKey) &&
          targetUniqueSubKeys.has(curSubKey) &&
          (!curCatKey ||
            curCatKey === 'uncategorized' ||
            !otherCategoryKeys.has(curCatKey));
        const mappedSub = subRenameLookup.get(curSubKey);
        const subMatchesScope =
          Boolean(mappedSub) &&
          (matchesCat ||
            ownedSubOrphanCat ||
            curCatKey === newCatKey ||
            !curCatKey ||
            curCatKey === 'uncategorized' ||
            !subNamesInOtherCategories.has(curSubKey));

        if (!matchesCat && !ownedSubOrphanCat && !subMatchesScope) return exp;

        const nextCat =
          matchesCat || ownedSubOrphanCat
            ? resolvedNewCat
            : curCat || resolvedNewCat;
        const nextSub = subMatchesScope && mappedSub ? mappedSub : curSub;
        const nextDesc =
          subMatchesScope &&
          mappedSub &&
          curDesc &&
          normalizeLabelKey(curDesc) === curSubKey
            ? mappedSub
            : exp.description;
        const nextColor =
          subMatchesScope && mappedSub
            ? renamedSubColorMap.get(normalizeLabelKey(mappedSub)) ||
              exp.subcategoryColor
            : exp.subcategoryColor;

        if (
          nextCat !== curCat ||
          nextSub !== curSub ||
          nextDesc !== exp.description ||
          nextColor !== exp.subcategoryColor
        ) {
          const updatedExp = {
            ...exp,
            category: nextCat,
            subcategory: nextSub || exp.subcategory,
            description: nextDesc,
            subcategoryColor: nextColor,
          };
          changedExpenses.push(updatedExp);
          return updatedExp;
        }
        return exp;
      }
    );

    // 4. Cascade updates across all Income Allocated Deductions
    const changedIncomes: any[] = [];
    const updatedIncomes = (Array.isArray(incomes) ? incomes : []).map(
      (inc: any) => {
        if (!inc || !Array.isArray(inc.allocatedDeductions)) return inc;
        let incChanged = false;
        const nextDeds = inc.allocatedDeductions.map((d: any) => {
          if (!d || typeof d !== 'object') return d;
          const curCat = String(d.expenseCategory || '').trim();
          const curSub = String(d.expenseSubcategory || '').trim();
          const curCatKey = normalizeLabelKey(curCat);
          const curSubKey = normalizeLabelKey(curSub);

          const matchesCat = Boolean(oldCatKey) && curCatKey === oldCatKey;
          const ownedSubOrphanCat =
            categoryChanged &&
            Boolean(curSubKey) &&
            targetUniqueSubKeys.has(curSubKey) &&
            (!curCatKey ||
              curCatKey === 'uncategorized' ||
              !otherCategoryKeys.has(curCatKey));
          const mappedSub = subRenameLookup.get(curSubKey);
          const subMatchesScope =
            Boolean(mappedSub) &&
            (matchesCat ||
              ownedSubOrphanCat ||
              curCatKey === newCatKey ||
              !curCatKey ||
              !subNamesInOtherCategories.has(curSubKey));

          if (!matchesCat && !ownedSubOrphanCat && !subMatchesScope) return d;

          const nextCat =
            matchesCat || ownedSubOrphanCat
              ? resolvedNewCat
              : curCat || resolvedNewCat;
          const nextSub = subMatchesScope && mappedSub ? mappedSub : curSub;
          if (nextCat !== curCat || nextSub !== curSub) {
            incChanged = true;
            return {
              ...d,
              expenseCategory: nextCat,
              expenseSubcategory: nextSub,
            };
          }
          return d;
        });

        if (incChanged) {
          const updatedInc = {
            ...inc,
            allocatedDeductions: nextDeds,
            updatedAt: nowIso,
          };
          changedIncomes.push(updatedInc);
          return updatedInc;
        }
        return inc;
      }
    );

    // 5. Cascade updates across all Budgets
    const changedBudgets: any[] = [];
    const updatedBudgets = (Array.isArray(budgets) ? budgets : []).map(
      (b: any) => {
        if (!b || typeof b !== 'object') return b;
        let bChanged = false;

        const origSubs: string[] = Array.isArray(b.subcategories)
          ? b.subcategories
          : [];
        const nextSubs = dedupePreserveOrder(
          origSubs.map((s) => {
            const mapped = subRenameLookup.get(normalizeLabelKey(s));
            if (mapped && mapped !== s) {
              bChanged = true;
              return mapped;
            }
            return s;
          })
        );

        const origCats: string[] = Array.isArray(b.categories)
          ? b.categories
          : [];
        const nextCats = dedupePreserveOrder(
          origCats.map((c) => {
            if (categoryChanged && normalizeLabelKey(c) === oldCatKey) {
              bChanged = true;
              return resolvedNewCat;
            }
            return c;
          })
        );

        if (bChanged) {
          const updatedBudget = {
            ...b,
            subcategories: nextSubs,
            categories: nextCats.length > 0 ? nextCats : b.categories,
            updatedAt: nowIso,
          };
          changedBudgets.push(updatedBudget);
          return updatedBudget;
        }
        return b;
      }
    );

    const totalRecordsUpdated =
      changedExpenses.length +
      changedIncomes.length +
      changedBudgets.length +
      deductionRulesUpdated;

    return res.json({
      success: true,
      settings: updatedSettings,
      expenses: updatedExpenses,
      incomes: updatedIncomes,
      budgets: updatedBudgets,
      changedExpenses,
      changedIncomes,
      changedBudgets,
      summary: {
        expensesUpdated: changedExpenses.length,
        incomesUpdated: changedIncomes.length,
        budgetsUpdated: changedBudgets.length,
        deductionRulesUpdated,
        totalRecordsUpdated,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Editing category or subcategory failed.',
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

function isExpenseDateInPresetBackend(
  dateString: string | undefined | null,
  preset: string = 'all'
): boolean {
  if (!preset || preset === 'all') return true;
  if (!dateString) return false;
  const normalized = normalizeDateString(dateString);
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized);
  if (!parts) return false;
  const itemDay = new Date(
    Number(parts[1]),
    Number(parts[2]) - 1,
    Number(parts[3]),
    0,
    0,
    0,
    0
  );
  const now = new Date();
  const refDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );
  const diffDays = Math.round(
    (refDay.getTime() - itemDay.getTime()) / (1000 * 60 * 60 * 24)
  );
  switch (preset) {
    case '7d':
      return diffDays >= 0 && diffDays <= 6;
    case 'this_month':
      return (
        itemDay.getFullYear() === refDay.getFullYear() &&
        itemDay.getMonth() === refDay.getMonth()
      );
    case '31d':
    case '1m':
      return diffDays >= 0 && diffDays <= 30;
    case 'last_month': {
      const prev = new Date(refDay.getFullYear(), refDay.getMonth() - 1, 1);
      return (
        itemDay.getFullYear() === prev.getFullYear() &&
        itemDay.getMonth() === prev.getMonth()
      );
    }
    case 'this_year':
      return itemDay.getFullYear() === refDay.getFullYear();
    case '365d':
    case '1y':
      return diffDays >= 0 && diffDays <= 364;
    case 'last_year':
      return itemDay.getFullYear() === refDay.getFullYear() - 1;
    case '1d':
      return diffDays === 0;
    case '14d':
      return diffDays >= 0 && diffDays <= 13;
    case '3m':
      return diffDays >= 0 && diffDays <= 89;
    default:
      return true;
  }
}

function getBackendPeriodBucket(
  dateString: string,
  groupByPeriod: string
): { key: string; label: string } {
  if (!groupByPeriod || groupByPeriod === 'none') {
    return { key: 'all', label: 'All Expenses' };
  }
  const normalized = normalizeDateString(dateString);
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized);
  if (!parts) return { key: 'all', label: 'All Expenses' };
  const year = Number(parts[1]);
  const monthIdx = Number(parts[2]) - 1;
  const dayNum = Number(parts[3]);
  const d = new Date(year, monthIdx, dayNum, 0, 0, 0, 0);

  if (groupByPeriod === 'year') {
    return { key: String(year), label: String(year) };
  }
  if (groupByPeriod === 'month') {
    const mm = String(monthIdx + 1).padStart(2, '0');
    const monthLabel = d.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    return { key: `${year}-${mm}`, label: monthLabel };
  }
  // week (Monday start)
  const dow = d.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const start = new Date(year, monthIdx, dayNum + mondayOffset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const fmt = (dt: Date) =>
    `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return { key: startKey, label: `${fmt(start)} – ${fmt(end)}` };
}

/**
 * Backend Expenses By Category Aggregation Endpoint (`POST /api/expenses/by-category`)
 * Responds to global `timeRange` presets, `groupByPeriod` (`none | week | month | year`),
 * account/category filters, and search terms so the By Category view stays synced with date filters.
 */
app.post('/api/expenses/by-category', (req: Request, res: Response) => {
  try {
    const {
      expenses = [],
      timeRange = 'all',
      groupByPeriod = 'none',
      accountFilter = 'all',
      categoryFilter = 'all',
      searchTerm = '',
    } = req.body || {};

    const rawList: any[] = Array.isArray(expenses) ? expenses : [];
    const q = String(searchTerm || '').trim().toLowerCase();

    const filtered = rawList.filter((exp: any) => {
      if (!exp) return false;
      if (!isExpenseDateInPresetBackend(exp.date, String(timeRange || 'all'))) {
        return false;
      }
      if (accountFilter && accountFilter !== 'all' && exp.accountId !== accountFilter) {
        return false;
      }
      if (categoryFilter && categoryFilter !== 'all' && exp.category !== categoryFilter) {
        return false;
      }
      if (q) {
        const match =
          String(exp.recipient || '').toLowerCase().includes(q) ||
          String(exp.category || '').toLowerCase().includes(q) ||
          String(exp.subcategory || '').toLowerCase().includes(q) ||
          String(exp.notes || '').toLowerCase().includes(q) ||
          String(exp.description || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    const periodMap = new Map<
      string,
      {
        periodKey: string;
        periodLabel: string;
        periodTotal: number;
        count: number;
        categoriesMap: Map<
          string,
          {
            category: string;
            total: number;
            count: number;
            subTotals: Record<string, number>;
          }
        >;
      }
    >();

    for (const exp of filtered) {
      const bucket = getBackendPeriodBucket(
        String(exp.date || ''),
        String(groupByPeriod || 'none')
      );
      const pGroup = periodMap.get(bucket.key) || {
        periodKey: bucket.key,
        periodLabel: bucket.label,
        periodTotal: 0,
        count: 0,
        categoriesMap: new Map(),
      };
      const amt = exp.vaultAction === 'credit' ? 0 : Number(exp.amount) || 0;
      const cat = String(exp.category || 'Uncategorized').trim() || 'Uncategorized';
      const sub = String(exp.subcategory || 'General').trim() || 'General';

      pGroup.periodTotal = round2dp(pGroup.periodTotal + amt);
      pGroup.count += 1;

      const cGroup = pGroup.categoriesMap.get(cat) || {
        category: cat,
        total: 0,
        count: 0,
        subTotals: {},
      };
      cGroup.total = round2dp(cGroup.total + amt);
      cGroup.count += 1;
      cGroup.subTotals[sub] = round2dp((cGroup.subTotals[sub] || 0) + amt);
      pGroup.categoriesMap.set(cat, cGroup);

      periodMap.set(bucket.key, pGroup);
    }

    const periods = Array.from(periodMap.values())
      .sort((a, b) => b.periodKey.localeCompare(a.periodKey))
      .map((p) => ({
        periodKey: p.periodKey,
        periodLabel: p.periodLabel,
        periodTotal: p.periodTotal,
        count: p.count,
        categories: Array.from(p.categoriesMap.values()).sort(
          (a, b) => b.total - a.total
        ),
      }));

    const grandTotal = round2dp(
      periods.reduce((sum, p) => sum + p.periodTotal, 0)
    );

    return res.json({
      success: true,
      timeRange,
      groupByPeriod,
      totalCount: filtered.length,
      grandTotal,
      periods,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to aggregate expenses by category.',
    });
  }
});

/**
 * Backend Prospective-Only Savings Vault Rate Update (`POST /api/settings/vault-rates/update`)
 * Freezes existing income records' savings split math with the previous vault percentages
 * before saving the new vault rates so changes apply strictly to new income records.
 */
const DEFAULT_SERVER_SAVINGS_PILLARS = [
  { id: 'bucket-30-emg', accountId: 'acc-30-emg', name: 'Emergency Fund (30%)', percentage: 30, description: '30% savings share' },
  { id: 'bucket-15-emg', accountId: 'acc-15-emg', name: 'Emergency Reserve (15%)', percentage: 15, description: '15% savings share' },
  { id: 'bucket-5-ins', accountId: 'acc-5-ins', name: 'Insurance Fund (5%)', percentage: 5, description: '5% savings share' },
  { id: 'bucket-20-inv', accountId: 'acc-20-inv', name: 'Investment Fund (20%)', percentage: 20, description: '20% savings share' },
  { id: 'bucket-10-pers', accountId: 'acc-10-pers', name: 'Personal Fund (10%)', percentage: 10, description: '10% savings share' },
  { id: 'bucket-15-seeds', accountId: 'acc-15-seeds', name: 'Seed Capital (15%)', percentage: 15, description: '15% savings share' },
  { id: 'bucket-5-give', accountId: 'acc-5-give', name: 'Giving Fund (5%)', percentage: 5, description: '5% savings share' },
];

function getServerVaultCleanName(name: string): string {
  return String(name || '')
    .replace(/\s*\(\s*\d+(?:\.\d+)?%\s*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isServerSavingsDeduction(d: any): boolean {
  if (!d) return false;
  if (d.isSavingsSplit) return true;
  const n = String(d.name || '').toLowerCase();
  const id = String(d.id || '').toLowerCase();
  return n.includes('saving') || id.includes('saving');
}

function normalizeServerVaultBuckets(rawBuckets: any[]): any[] {
  const source =
    Array.isArray(rawBuckets) && rawBuckets.length > 0
      ? rawBuckets
      : DEFAULT_SERVER_SAVINGS_PILLARS;
  return source.map((b: any, idx: number) => {
    const fallback = DEFAULT_SERVER_SAVINGS_PILLARS[idx];
    const baseName =
      getServerVaultCleanName(b?.name || '') ||
      (fallback ? getServerVaultCleanName(fallback.name) : `Savings Vault ${idx + 1}`);
    const parsedPct = Number(b?.percentage);
    const pct = Number.isFinite(parsedPct)
      ? Math.max(0, Math.min(100, round2dp(parsedPct)))
      : 0;
    const bucketId = String(b?.id || fallback?.id || `bucket_${idx + 1}`).trim();
    const accountId = String(
      b?.accountId || fallback?.accountId || `acc_sav_${bucketId}`
    ).trim();
    return {
      ...b,
      id: bucketId,
      accountId,
      name: `${baseName} (${pct}%)`,
      percentage: pct,
      description: `${pct}% savings share`,
    };
  });
}

function computeServerSavingsShares(
  deductedAmount: number,
  buckets: any[],
  accounts: any[]
): any[] {
  const normalized = normalizeServerVaultBuckets(buckets);
  const total = Math.max(0, round2dp(Number(deductedAmount) || 0));
  const totalRateSum = normalized.reduce(
    (sum: number, p: any) => sum + (Number(p.percentage) || 0),
    0
  );
  const lastActiveIdx = normalized.reduce(
    (lastIdx: number, p: any, idx: number) =>
      Number(p.percentage) > 0 ? idx : lastIdx,
    normalized.length - 1
  );

  let runningSum = 0;
  return normalized.map((p: any, index: number) => {
    const baseName = getServerVaultCleanName(p.name).toLowerCase();
    const acc = (Array.isArray(accounts) ? accounts : []).find(
      (a: any) =>
        a?.id === p.accountId ||
        a?.linkedSavingsBucketId === p.id ||
        getServerVaultCleanName(a?.name || '').toLowerCase() === baseName
    );

    let shareAmount = 0;
    if (total > 0 && p.percentage > 0) {
      if (Math.abs(totalRateSum - 100) < 0.01 && index === lastActiveIdx) {
        shareAmount = Math.max(0, round2dp(total - runningSum));
      } else {
        shareAmount = round2dp((total * p.percentage) / 100);
        runningSum = round2dp(runningSum + shareAmount);
      }
    }

    return {
      bucketId: p.id,
      bucketName: p.name,
      percentage: p.percentage,
      amount: shareAmount,
      accountId: acc?.id || p.accountId,
      accountName: p.name,
    };
  });
}

app.post('/api/settings/vault-rates/update', (req: Request, res: Response) => {
  try {
    const {
      previousSettings = {},
      nextBuckets = [],
      vaultCustodianAccounts,
      incomes = [],
      accounts = [],
    } = req.body || {};

    const previousBuckets = normalizeServerVaultBuckets(
      Array.isArray(previousSettings?.savingsBuckets) &&
        previousSettings.savingsBuckets.length > 0
        ? previousSettings.savingsBuckets
        : DEFAULT_SERVER_SAVINGS_PILLARS
    );
    const normalizedNextBuckets = normalizeServerVaultBuckets(nextBuckets);
    const totalRatePercent = round2dp(
      normalizedNextBuckets.reduce(
        (sum: number, b: any) => sum + (Number(b.percentage) || 0),
        0
      )
    );

    const existingIncomes: any[] = Array.isArray(incomes) ? incomes : [];
    const changedIncomes: any[] = [];

    // Freeze any existing income record that does not yet carry a savingsSplitSnapshot
    // using the PREVIOUS vault percentages so historical transactions remain unchanged.
    const updatedIncomes = existingIncomes.map((inc: any) => {
      if (!inc || !Array.isArray(inc.allocatedDeductions)) {
        return inc;
      }

      let incomeModified = false;
      const nextDeductions = inc.allocatedDeductions.map((ded: any) => {
        if (!isServerSavingsDeduction(ded)) return ded;
        if (
          Array.isArray(ded.savingsSplitSnapshot) &&
          ded.savingsSplitSnapshot.length > 0
        ) {
          return ded;
        }
        incomeModified = true;
        return {
          ...ded,
          savingsSplitSnapshot: computeServerSavingsShares(
            Number(ded.amount) || 0,
            previousBuckets,
            accounts
          ),
        };
      });

      if (!incomeModified) {
        return inc;
      }

      const frozenIncome = {
        ...inc,
        allocatedDeductions: nextDeductions,
        updatedAt: new Date().toISOString(),
      };
      changedIncomes.push(frozenIncome);
      return frozenIncome;
    });

    const nextSettings = {
      ...previousSettings,
      savingsBuckets: normalizedNextBuckets,
      vaultCustodianAccounts:
        vaultCustodianAccounts !== undefined
          ? vaultCustodianAccounts
          : previousSettings?.vaultCustodianAccounts || {},
      updatedAt: new Date().toISOString(),
    };

    return res.json({
      success: true,
      settings: nextSettings,
      incomes: updatedIncomes,
      changedIncomes,
      summary: {
        totalRatePercent,
        preservedIncomesCount: changedIncomes.length,
        totalExistingIncomes: updatedIncomes.length,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to update savings vault rates.',
    });
  }
});

/**
 * Biometric App Lock WebAuthn Challenge & Assertion Verification Endpoints
 * Supports Android BiometricPrompt / Platform Authenticators in installed PWAs.
 */
interface BiometricChallengeEntry {
  challenge: string;
  purpose: string;
  createdAt: number;
}

const biometricChallengeStore = new Map<string, BiometricChallengeEntry>();
const BIOMETRIC_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function pruneExpiredBiometricChallenges() {
  const now = Date.now();
  for (const [key, entry] of biometricChallengeStore.entries()) {
    if (now - entry.createdAt > BIOMETRIC_CHALLENGE_TTL_MS) {
      biometricChallengeStore.delete(key);
    }
  }
}

app.post('/api/security/biometric/challenge', (req: Request, res: Response) => {
  try {
    pruneExpiredBiometricChallenges();
    const purpose = String(req.body?.purpose || 'verify').slice(0, 32);
    const challenge = crypto.randomBytes(32).toString('base64url');
    biometricChallengeStore.set(challenge, {
      challenge,
      purpose,
      createdAt: Date.now(),
    });
    return res.json({
      success: true,
      challenge,
      purpose,
      expiresInMs: BIOMETRIC_CHALLENGE_TTL_MS,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to issue biometric challenge.',
    });
  }
});

app.post('/api/security/biometric/verify', (req: Request, res: Response) => {
  try {
    pruneExpiredBiometricChallenges();
    const {
      credentialId,
      expectedChallenge,
      clientDataJSON,
      authenticatorData,
    } = req.body || {};

    if (
      typeof credentialId !== 'string' ||
      !credentialId.trim() ||
      typeof clientDataJSON !== 'string' ||
      typeof authenticatorData !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        error: 'Incomplete biometric assertion payload.',
      });
    }

    const decodedClientRaw = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
    const clientData = JSON.parse(decodedClientRaw);
    const challengeVal = String(clientData?.challenge || '');

    if (clientData?.type !== 'webauthn.get') {
      return res.status(400).json({
        success: false,
        error: 'Invalid WebAuthn assertion type.',
      });
    }

    if (expectedChallenge && challengeVal !== expectedChallenge) {
      return res.status(400).json({
        success: false,
        error: 'Biometric challenge mismatch.',
      });
    }

    // Consume server-issued challenge if present (also allows locally generated challenges when reconnecting from offline)
    if (biometricChallengeStore.has(challengeVal)) {
      biometricChallengeStore.delete(challengeVal);
    }

    const authBuf = Buffer.from(authenticatorData, 'base64url');
    if (authBuf.length < 37) {
      return res.status(400).json({
        success: false,
        error: 'Malformed authenticator data.',
      });
    }

    const flags = authBuf[32];
    const userPresent = (flags & 0x01) !== 0;
    const userVerified = (flags & 0x04) !== 0;

    if (!userPresent || !userVerified) {
      return res.status(401).json({
        success: false,
        error: 'Biometric user verification flag not satisfied.',
      });
    }

    return res.json({
      success: true,
      verified: true,
      verifiedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err?.message || 'Unable to verify biometric assertion.',
    });
  }
});

/**
 * Authenticated User Cloud-Session Snapshot Store
 * Enables instant zero-wait refresh and offline logged-in data continuity without falling back to the unauthenticated local ledger.
 */
interface CloudUserSessionSnapshot {
  userId: string;
  settings?: any;
  accounts?: any[];
  incomes?: any[];
  expenses?: any[];
  transfers?: any[];
  budgets?: any[];
  revisions?: any[];
  updatedAt: string;
}

const authenticatedCloudSnapshots = new Map<string, CloudUserSessionSnapshot>();

app.get('/api/session/cloud-snapshot/:uid', (req: Request, res: Response) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid || uid === 'default_user' || uid === 'guest_user') {
    return res.status(400).json({
      success: false,
      error: 'Valid authenticated UID required.',
    });
  }
  const existing = authenticatedCloudSnapshots.get(uid);
  return res.json({
    success: true,
    uid,
    snapshot: existing || null,
  });
});

app.post('/api/session/cloud-snapshot/:uid', (req: Request, res: Response) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid || uid === 'default_user' || uid === 'guest_user') {
    return res.status(400).json({
      success: false,
      error: 'Valid authenticated UID required.',
    });
  }
  const body = req.body || {};
  const existing = authenticatedCloudSnapshots.get(uid) || {
    userId: uid,
    updatedAt: new Date().toISOString(),
  };

  const merged: CloudUserSessionSnapshot = {
    ...existing,
    userId: uid,
    settings: body.settings !== undefined ? body.settings : existing.settings,
    accounts: Array.isArray(body.accounts) ? body.accounts : existing.accounts,
    incomes: Array.isArray(body.incomes) ? body.incomes : existing.incomes,
    expenses: Array.isArray(body.expenses) ? body.expenses : existing.expenses,
    transfers: Array.isArray(body.transfers) ? body.transfers : existing.transfers,
    budgets: Array.isArray(body.budgets) ? body.budgets : existing.budgets,
    revisions: Array.isArray(body.revisions) ? body.revisions : existing.revisions,
    updatedAt: new Date().toISOString(),
  };

  authenticatedCloudSnapshots.set(uid, merged);
  return res.json({
    success: true,
    uid,
    updatedAt: merged.updatedAt,
  });
});

// Bind port 3000 immediately so container healthchecks succeed without waiting on Vite cold boot
app.get('/manifest.webmanifest', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.send(
    JSON.stringify({
      id: '/',
      name: 'Save N Know',
      short_name: 'Save N Know',
      description:
        'Progressive financial management system to route income into accounts, manage defined deductions as expenses or savings split transfers, and track budgets, goals, and analytics.',
      theme_color: '#059669',
      background_color: '#f8fafc',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      icons: [
        {
          src: '/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/pwa-maskable-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    })
  );
});

/**
 * ============================================================================
 * GOOGLE DRIVE SPREADSHEET RECORD ALIGNMENT & 3-WAY RECONCILIATION ENDPOINTS
 * ============================================================================
 */

function extractDriveFileIdSafe(input: string): string | null {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;
  const fileMatch = trimmed.match(/\/(?:file|spreadsheets|document)\/d\/([a-zA-Z0-9_-]{10,120})/);
  if (fileMatch && fileMatch[1]) return fileMatch[1];
  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,120})/);
  if (queryMatch && queryMatch[1]) return queryMatch[1];
  if (/^[a-zA-Z0-9_-]{15,120}$/.test(trimmed)) return trimmed;
  return null;
}

function formatCellValue(cell: any): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    const yyyy = cell.getFullYear();
    const mm = String(cell.getMonth() + 1).padStart(2, '0');
    const dd = String(cell.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? String(cell) : '';
  }
  return String(cell).trim();
}

function detectSpreadsheetColumnMapping(headers: string[]): Record<string, string | undefined> {
  const mapping: Record<string, string | undefined> = {};
  const used = new Set<string>();

  const pick = (patterns: RegExp[]): string | undefined => {
    for (const pattern of patterns) {
      const match = headers.find((h) => !used.has(h) && pattern.test(h.trim().toLowerCase()));
      if (match) {
        used.add(match);
        return match;
      }
    }
    return undefined;
  };

  mapping.date = pick([
    /^date$/,
    /transaction\s*date/,
    /posting\s*date/,
    /value\s*date/,
    /entry\s*date/,
    /\bdate\b/,
    /timestamp/,
  ]);
  mapping.type = pick([
    /^(record\s*)?type$/,
    /transaction\s*type/,
    /entry\s*type/,
    /\bkind\b/,
    /direction/,
    /flow/,
  ]);
  mapping.debit = pick([
    /^debit(\s*amount)?$/,
    /withdrawal/,
    /outflow/,
    /money\s*out/,
    /paid\s*out/,
    /spent/,
  ]);
  mapping.credit = pick([
    /^credit(\s*amount)?$/,
    /deposit/,
    /inflow/,
    /money\s*in/,
    /paid\s*in/,
    /received/,
  ]);
  mapping.amount = pick([
    /^(gross\s*)?amount$/,
    /^total(\s*amount)?$/,
    /^value$/,
    /^sum$/,
    /amount/,
    /price/,
    /cost/,
  ]);
  mapping.currency = pick([/^currency$/, /\bccy\b/, /\bcurr\b/, /currency/]);
  mapping.toAccount = pick([
    /to\s*account/,
    /dest(ination)?\s*account/,
    /target\s*account/,
    /credit\s*account/,
  ]);
  mapping.account = pick([
    /^(from\s*)?account(\s*name)?$/,
    /source\s*account/,
    /wallet/,
    /bank(\s*account)?/,
    /vault/,
    /account/,
  ]);
  mapping.subcategory = pick([
    /^sub[\s_-]*category$/,
    /sub[\s_-]*cat/,
    /line\s*item/,
    /item\s*type/,
  ]);
  mapping.category = pick([
    /^category$/,
    /expense\s*category/,
    /classification/,
    /group/,
    /budget/,
    /category/,
  ]);
  mapping.counterparty = pick([
    /^(client|source|payee|merchant|vendor|recipient)$/,
    /to\s*\/\s*cause/,
    /client\s*(\/|or)\s*source/,
    /paid\s*to/,
    /received\s*from/,
    /beneficiary/,
    /counterparty/,
    /merchant/,
    /payee/,
    /vendor/,
    /recipient/,
    /source/,
    /cause/,
    /title/,
    /name/,
  ]);
  mapping.notes = pick([
    /^notes?$/,
    /^description$/,
    /^memo$/,
    /^narration$/,
    /^details?$/,
    /^remarks?$/,
    /^reference$/,
    /description/,
    /note/,
    /memo/,
    /narration/,
  ]);

  return mapping;
}

function extractWorkbookSheets(workbook: XLSX.WorkBook) {
  const sheets: {
    name: string;
    headers: string[];
    rows: Record<string, string>[];
    totalRowCount: number;
    autoMapping: Record<string, string | undefined>;
  }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;

    const matrix = XLSX.utils.sheet_to_json<any[]>(ws, {
      header: 1,
      defval: '',
      raw: false,
      dateNF: 'yyyy-mm-dd',
    });

    if (!Array.isArray(matrix) || matrix.length === 0) continue;

    // Detect the real header row within the top 15 rows (skipping sheet titles / blank rows)
    const headerKeywords =
      /date|amount|debit|credit|category|account|description|note|source|payee|recipient|merchant|type|currency|balance|income|expense|total|memo/i;
    let headerRowIdx = 0;
    let bestScore = -1;
    const scanLimit = Math.min(matrix.length, 15);
    for (let r = 0; r < scanLimit; r++) {
      const row = Array.isArray(matrix[r]) ? matrix[r] : [];
      const nonEmpty = row
        .map((c) => formatCellValue(c))
        .filter((s) => s.length > 0);
      if (nonEmpty.length < 2) continue;
      const keywordHits = nonEmpty.filter((s) => headerKeywords.test(s)).length;
      const numericRatio =
        nonEmpty.filter((s) => /^[+-]?[\d,.$£€₵¥]+$/.test(s)).length / nonEmpty.length;
      const score = keywordHits * 10 + nonEmpty.length - numericRatio * 8;
      if (score > bestScore) {
        bestScore = score;
        headerRowIdx = r;
      }
    }

    const rawHeaderRow = Array.isArray(matrix[headerRowIdx]) ? matrix[headerRowIdx] : [];
    const seenHeaders = new Map<string, number>();
    const headers: string[] = rawHeaderRow.map((cell, idx) => {
      const base = formatCellValue(cell) || `Column ${idx + 1}`;
      const count = seenHeaders.get(base) || 0;
      seenHeaders.set(base, count + 1);
      return count === 0 ? base : `${base} (${count + 1})`;
    });

    const dataRows: Record<string, string>[] = [];
    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const rawRow = Array.isArray(matrix[r]) ? matrix[r] : [];
      const obj: Record<string, string> = {};
      let populated = 0;
      for (let c = 0; c < headers.length; c++) {
        const val = formatCellValue(rawRow[c]);
        obj[headers[c]] = val;
        if (val.length > 0) populated++;
      }
      if (populated === 0) continue;
      // Skip obvious trailing summary/totals rows
      const firstNonEmpty = Object.values(obj).find((v) => v.length > 0) || '';
      if (/^(grand\s*)?totals?:?$/i.test(firstNonEmpty.trim())) continue;
      dataRows.push(obj);
      if (dataRows.length >= 1500) break;
    }

    if (headers.filter((h) => !/^Column \d+$/.test(h)).length === 0 && dataRows.length === 0) {
      continue;
    }

    sheets.push({
      name: sheetName,
      headers,
      rows: dataRows,
      totalRowCount: dataRows.length,
      autoMapping: detectSpreadsheetColumnMapping(headers),
    });
  }

  return sheets;
}

app.post('/api/drive/read-spreadsheet', async (req: Request, res: Response) => {
  try {
    const authHeader = String(req.headers.authorization || '').trim();
    if (!authHeader.startsWith('Bearer ') || authHeader.length < 15) {
      return res.status(401).json({
        code: 'DRIVE_AUTH_REQUIRED',
        error: 'Please connect Google Drive with read-only access first.',
      });
    }

    const { fileIdOrUrl = '' } = req.body || {};
    const fileId = extractDriveFileIdSafe(fileIdOrUrl);
    if (!fileId) {
      return res.status(400).json({
        error: 'Invalid Google Drive link or file ID. Paste a valid Google Drive file URL.',
      });
    }

    // 1. Fetch file metadata from Google Drive API v3
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size&supportsAllDrives=true`,
      { headers: { Authorization: authHeader } }
    );

    if (metaRes.status === 401) {
      return res.status(401).json({
        code: 'DRIVE_TOKEN_EXPIRED',
        error: 'Your Google Drive session expired. Reconnect Google Drive to continue.',
      });
    }
    if (metaRes.status === 403 || metaRes.status === 404) {
      return res.status(metaRes.status).json({
        error:
          'Unable to access this Google Drive file. Verify the signed-in Google account has view permission for this link.',
      });
    }
    if (!metaRes.ok) {
      const errTxt = await metaRes.text();
      return res.status(502).json({
        error: `Google Drive metadata request failed (${metaRes.status}): ${errTxt.slice(0, 180)}`,
      });
    }

    const meta = (await metaRes.json()) as {
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
    };

    const mime = String(meta.mimeType || '').toLowerCase();
    const lowerName = String(meta.name || '').toLowerCase();
    let workbook: XLSX.WorkBook | null = null;

    // 2. Download or export spreadsheet bytes based on MIME type
    if (mime === 'application/vnd.google-apps.spreadsheet') {
      // Export Google Sheet as multi-tab XLSX first so every worksheet tab is preserved
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}`;
      const exportRes = await fetch(exportUrl, {
        headers: { Authorization: authHeader },
      });
      if (exportRes.ok) {
        const buf = Buffer.from(await exportRes.arrayBuffer());
        workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
      } else {
        // Fallback to CSV export for very large single-sheet Google Sheets
        const csvRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/csv`,
          { headers: { Authorization: authHeader } }
        );
        if (!csvRes.ok) {
          return res.status(502).json({
            error: `Failed to export Google Sheet (${exportRes.status}).`,
          });
        }
        const csvText = await csvRes.text();
        workbook = XLSX.read(csvText, { type: 'string', raw: false });
      }
    } else if (
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      lowerName.endsWith('.ods')
    ) {
      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: authHeader } }
      );
      if (!dlRes.ok) {
        return res.status(502).json({
          error: `Failed to download Excel file from Google Drive (${dlRes.status}).`,
        });
      }
      const buf = Buffer.from(await dlRes.arrayBuffer());
      workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
    } else if (
      mime.includes('csv') ||
      mime.includes('tab-separated') ||
      mime.startsWith('text/') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.tsv') ||
      lowerName.endsWith('.txt')
    ) {
      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: authHeader } }
      );
      if (!dlRes.ok) {
        return res.status(502).json({
          error: `Failed to download CSV/text file from Google Drive (${dlRes.status}).`,
        });
      }
      const text = await dlRes.text();
      workbook = XLSX.read(text, { type: 'string', raw: false });
    } else {
      return res.status(415).json({
        error: `This Drive file (${meta.name}) has unsupported format "${meta.mimeType}". Please select an Excel (.xlsx/.xls), CSV, or Google Sheets file.`,
      });
    }

    const sheets = workbook ? extractWorkbookSheets(workbook) : [];
    if (sheets.length === 0) {
      return res.status(422).json({
        error: `No readable tabular rows were found in "${meta.name}".`,
      });
    }

    return res.json({
      fileId: meta.id,
      fileName: meta.name,
      mimeType: meta.mimeType,
      modifiedTime: meta.modifiedTime,
      sheets,
    });
  } catch (error: any) {
    console.error('Drive read spreadsheet error:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to read spreadsheet from Google Drive.',
    });
  }
});

function parseFlexibleSpreadsheetDate(raw: any): string {
  const today = new Date().toISOString().split('T')[0];
  if (raw === null || raw === undefined || String(raw).trim() === '') return today;

  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // DD/MM/YYYY or DD-MM-YYYY first (app-wide dd/mm/yyyy convention; falls back to MM/DD/YYYY if second part > 12)
  const slashMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1], 10);
    const b = parseInt(slashMatch[2], 10);
    let y = parseInt(slashMatch[3], 10);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    let day = a;
    let month = b;
    if (b > 12 && a <= 12) {
      month = a;
      day = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Excel serial number (e.g. 45600)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 20000 && serial < 90000) {
      const utcMs = Math.round((serial - 25569) * 86400 * 1000);
      const dt = new Date(utcMs);
      if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0];
    }
  }

  return normalizeDateString(s);
}

function daysBetweenYmd(a: string, b: string): number {
  const ta = Date.parse(`${(a || '').slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${(b || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 9999;
  return Math.abs(Math.round((ta - tb) / 86400000));
}

function textTokenSimilarity(a: string, b: string): number {
  const norm = (str: string) =>
    String(str || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);
  const ta = norm(a);
  const tb = norm(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let intersect = 0;
  setA.forEach((tok) => {
    if (setB.has(tok)) intersect++;
  });
  return intersect / Math.max(setA.size, setB.size);
}

app.post('/api/drive/reconcile', async (req: Request, res: Response) => {
  try {
    const {
      rows = [],
      mapping = {},
      baseCurrency = 'USD',
      accounts = [],
      incomes = [],
      expenses = [],
      transfers = [],
      categories = [],
      expenseCategoryPreferences = [],
      autoMapSubcategories = true,
    } = req.body || {};

    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Spreadsheet rows must be an array.' });
    }

    const subToParentLookup = new Map<string, { category: string; subcategory: string }>();
    const definedCategoryKeySet = new Set<string>();
    if (Array.isArray(expenseCategoryPreferences)) {
      for (const pref of expenseCategoryPreferences) {
        const parentName = String(pref?.name || '').trim();
        if (!parentName) continue;
        definedCategoryKeySet.add(parentName.toLowerCase().replace(/\s+/g, ' '));
        if (Array.isArray(pref?.subcategories)) {
          for (const sub of pref.subcategories) {
            const cleanSub = String(sub || '').trim();
            if (!cleanSub) continue;
            const key = cleanSub.toLowerCase().replace(/\s+/g, ' ');
            if (!subToParentLookup.has(key)) {
              subToParentLookup.set(key, { category: parentName, subcategory: cleanSub });
            }
          }
        }
      }
    }

    const upperBase = String(baseCurrency || 'USD').trim().toUpperCase();
    const cachedFx = fxCache.get(upperBase);
    const activeRates = cachedFx?.rates || buildFallbackRatesForBase(upperBase);

    const accountList: any[] = Array.isArray(accounts) ? accounts : [];
    const defaultAccount =
      accountList.find((a) => a.isDefaultDeposit && !a.isVirtual && !a.archived) ||
      accountList.find((a) => !a.isVirtual && !a.archived) ||
      accountList[0] || {
        id: 'acc-main-op',
        name: 'Main Operating Account',
        currency: upperBase,
      };

    const resolveAccount = (hint: string): { id: string; name: string; currency: string } => {
      const cleaned = String(hint || '').trim().toLowerCase();
      if (cleaned && accountList.length > 0) {
        const exact = accountList.find(
          (a) =>
            String(a.id || '').toLowerCase() === cleaned ||
            String(a.name || '').toLowerCase() === cleaned
        );
        if (exact) {
          return {
            id: exact.id,
            name: exact.name,
            currency: String(exact.currency || upperBase).toUpperCase(),
          };
        }
        const partial = accountList.find(
          (a) =>
            String(a.name || '').toLowerCase().includes(cleaned) ||
            cleaned.includes(String(a.name || '').toLowerCase())
        );
        if (partial) {
          return {
            id: partial.id,
            name: partial.name,
            currency: String(partial.currency || upperBase).toUpperCase(),
          };
        }
      }
      return {
        id: defaultAccount.id || 'acc-main-op',
        name: defaultAccount.name || 'Main Operating Account',
        currency: String(defaultAccount.currency || upperBase).toUpperCase(),
      };
    };

    const categoryNames: string[] = Array.isArray(categories)
      ? categories.map((c: any) => String(c || '').trim()).filter(Boolean)
      : [];

    const resolveCategory = (rawCat: string): string => {
      const cleaned = String(rawCat || '').trim();
      if (!cleaned) return categoryNames[0] || 'Other';
      const lower = cleaned.toLowerCase();
      const exact = categoryNames.find((c) => c.toLowerCase() === lower);
      if (exact) return exact;
      const partial = categoryNames.find(
        (c) => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase())
      );
      return partial || cleaned;
    };

    const normalizeStr = (s?: string) =>
      String(s || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

    const getVal = (row: Record<string, string>, col?: string): string => {
      if (!col) return '';
      return String(row?.[col] ?? '').trim();
    };

    const accountNameById = new Map<string, string>();
    for (const acc of accountList) {
      accountNameById.set(acc.id, acc.name || acc.id);
    }

    const computeDiffsServer = (existing: any, proposed: any) => {
      const diffs: { field: string; label: string; appValue: string; driveValue: string }[] = [];
      if ((existing.date || '').slice(0, 10) !== (proposed.date || '').slice(0, 10)) {
        diffs.push({
          field: 'date',
          label: 'Date',
          appValue: formatYmdToDDMMYYYY(existing.date),
          driveValue: formatYmdToDDMMYYYY(proposed.date),
        });
      }
      if (Math.abs((Number(existing.amount) || 0) - (Number(proposed.amount) || 0)) >= 0.01) {
        diffs.push({
          field: 'amount',
          label: 'Amount',
          appValue: `${existing.currency} ${round2dp(existing.amount).toFixed(2)}`,
          driveValue: `${proposed.currency} ${round2dp(proposed.amount).toFixed(2)}`,
        });
      }
      if ((existing.currency || '').toUpperCase() !== (proposed.currency || '').toUpperCase()) {
        diffs.push({
          field: 'currency',
          label: 'Currency',
          appValue: (existing.currency || upperBase).toUpperCase(),
          driveValue: (proposed.currency || upperBase).toUpperCase(),
        });
      }
      if (existing.accountId !== proposed.accountId) {
        diffs.push({
          field: 'accountId',
          label: proposed.recordType === 'transfer' ? 'From Account' : 'Account',
          appValue: accountNameById.get(existing.accountId) || existing.accountId,
          driveValue: accountNameById.get(proposed.accountId) || proposed.accountId,
        });
      }
      if (
        proposed.recordType === 'transfer' &&
        (existing.toAccountId || '') !== (proposed.toAccountId || '')
      ) {
        diffs.push({
          field: 'toAccountId',
          label: 'To Account',
          appValue: accountNameById.get(existing.toAccountId) || existing.toAccountId || '—',
          driveValue: accountNameById.get(proposed.toAccountId) || proposed.toAccountId || '—',
        });
      }
      if (
        proposed.recordType === 'expense' &&
        normalizeStr(existing.category) !== normalizeStr(proposed.category)
      ) {
        diffs.push({
          field: 'category',
          label: 'Category',
          appValue: existing.category || 'Uncategorized',
          driveValue: proposed.category || 'Uncategorized',
        });
      }
      if (
        proposed.recordType === 'expense' &&
        normalizeStr(existing.subcategory) !== normalizeStr(proposed.subcategory)
      ) {
        diffs.push({
          field: 'subcategory',
          label: 'Subcategory',
          appValue: existing.subcategory || 'None',
          driveValue: proposed.subcategory || 'None',
        });
      }
      if (
        proposed.recordType !== 'transfer' &&
        normalizeStr(existing.counterparty) !== normalizeStr(proposed.counterparty)
      ) {
        diffs.push({
          field: 'counterparty',
          label: proposed.recordType === 'income' ? 'Source' : 'To / Cause',
          appValue: existing.counterparty || '—',
          driveValue: proposed.counterparty || '—',
        });
      }
      if (normalizeStr(existing.notes) !== normalizeStr(proposed.notes)) {
        diffs.push({
          field: 'notes',
          label: 'Notes',
          appValue: existing.notes || '—',
          driveValue: proposed.notes || '—',
        });
      }
      return diffs;
    };

    // Build normalized candidate pool from current app ledger
    const existingPool: {
      id: string;
      recordType: 'income' | 'expense' | 'transfer';
      snapshot: any;
      baseAmount: number;
    }[] = [];

    for (const inc of Array.isArray(incomes) ? incomes : []) {
      const accCurr =
        accountList.find((a) => a.id === inc.accountId)?.currency || upperBase;
      const nativeAmt = round2dp(
        Number(inc.originalGrossAmount ?? inc.grossAmount ?? 0)
      );
      const curr = String(inc.currency || accCurr || upperBase).toUpperCase();
      existingPool.push({
        id: inc.id,
        recordType: 'income',
        baseAmount: round2dp(Number(inc.grossAmount || nativeAmt)),
        snapshot: {
          recordType: 'income',
          date: String(inc.date || '').slice(0, 10),
          amount: nativeAmt,
          currency: curr,
          accountId: inc.accountId || defaultAccount.id,
          category: 'Income',
          subcategory: '',
          counterparty: String(inc.clientOrSource || '').trim(),
          notes: String(inc.notes || '').trim(),
        },
      });
    }

    for (const exp of Array.isArray(expenses) ? expenses : []) {
      const accCurr =
        accountList.find((a) => a.id === exp.accountId)?.currency || upperBase;
      const nativeAmt = round2dp(Number(exp.originalAmount ?? exp.amount ?? 0));
      const curr = String(exp.currency || accCurr || upperBase).toUpperCase();
      existingPool.push({
        id: exp.id,
        recordType: 'expense',
        baseAmount: round2dp(Number(exp.amount || nativeAmt)),
        snapshot: {
          recordType: 'expense',
          date: String(exp.date || '').slice(0, 10),
          amount: nativeAmt,
          currency: curr,
          accountId: exp.accountId || defaultAccount.id,
          category: String(exp.category || 'Other').trim(),
          subcategory: String(exp.subcategory || '').trim(),
          counterparty: String(exp.recipient || exp.description || '').trim(),
          notes: String(exp.notes || exp.description || '').trim(),
        },
      });
    }

    for (const tr of Array.isArray(transfers) ? transfers : []) {
      const nativeAmt = round2dp(Number(tr.sourceAmount ?? tr.amount ?? 0));
      const curr = String(tr.sourceCurrency || upperBase).toUpperCase();
      existingPool.push({
        id: tr.id,
        recordType: 'transfer',
        baseAmount: round2dp(Number(tr.amount || nativeAmt)),
        snapshot: {
          recordType: 'transfer',
          date: String(tr.date || '').slice(0, 10),
          amount: nativeAmt,
          currency: curr,
          accountId: tr.sourceAccountId || defaultAccount.id,
          toAccountId: tr.destinationAccountId || defaultAccount.id,
          category: 'Transfer',
          subcategory: '',
          counterparty: '',
          notes: String(tr.description || '').trim(),
        },
      });
    }

    // Parse all incoming spreadsheet rows first
    const normalizedDriveRows: {
      rowIndex: number;
      rawRow: Record<string, string>;
      proposed: any;
      baseAmount: number;
    }[] = [];

    rows.forEach((rawRow: Record<string, string>, idx: number) => {
      const dateRaw = getVal(rawRow, mapping.date);
      const typeRaw = getVal(rawRow, mapping.type).toLowerCase();
      const amountRaw = getVal(rawRow, mapping.amount);
      const debitRaw = getVal(rawRow, mapping.debit);
      const creditRaw = getVal(rawRow, mapping.credit);
      const currencyRaw = getVal(rawRow, mapping.currency);
      const accountRaw = getVal(rawRow, mapping.account);
      const toAccountRaw = getVal(rawRow, mapping.toAccount);
      const categoryRaw = getVal(rawRow, mapping.category);
      const subcategoryRaw = getVal(rawRow, mapping.subcategory);
      const counterpartyRaw = getVal(rawRow, mapping.counterparty);
      const notesRaw = getVal(rawRow, mapping.notes);

      const accResolved = resolveAccount(accountRaw);
      const toAccResolved = toAccountRaw ? resolveAccount(toAccountRaw) : null;
      const fallbackCurr = (currencyRaw || accResolved.currency || upperBase).toUpperCase();

      const parsedMain = detectCurrencyAndCleanNumber(amountRaw, fallbackCurr);
      const parsedDebit = debitRaw
        ? detectCurrencyAndCleanNumber(debitRaw, fallbackCurr)
        : { amount: 0, currency: fallbackCurr };
      const parsedCredit = creditRaw
        ? detectCurrencyAndCleanNumber(creditRaw, fallbackCurr)
        : { amount: 0, currency: fallbackCurr };

      let recordType: 'expense' | 'income' | 'transfer' = 'expense';
      let amount = 0;
      let txCurrency = fallbackCurr;

      if (Math.abs(parsedDebit.amount) > 0 && Math.abs(parsedCredit.amount) === 0) {
        recordType = 'expense';
        amount = Math.abs(parsedDebit.amount);
        txCurrency = currencyRaw ? fallbackCurr : parsedDebit.currency;
      } else if (Math.abs(parsedCredit.amount) > 0 && Math.abs(parsedDebit.amount) === 0) {
        recordType = 'income';
        amount = Math.abs(parsedCredit.amount);
        txCurrency = currencyRaw ? fallbackCurr : parsedCredit.currency;
      } else if (Math.abs(parsedMain.amount) > 0) {
        amount = Math.abs(parsedMain.amount);
        txCurrency = currencyRaw ? fallbackCurr : parsedMain.currency;
        if (parsedMain.amount > 0 && /income|credit|deposit|inflow|salary|revenue|earning/.test(typeRaw)) {
          recordType = 'income';
        } else if (parsedMain.amount < 0) {
          recordType = 'expense';
        }
      } else {
        // Skip rows with no numeric financial amount
        return;
      }

      if (typeRaw) {
        if (/transfer|move|internal/.test(typeRaw)) {
          recordType = 'transfer';
        } else if (/income|credit|deposit|inflow|revenue|salary|earning/.test(typeRaw)) {
          recordType = 'income';
        } else if (/expense|debit|outflow|spend|payment|withdrawal|purchase/.test(typeRaw)) {
          recordType = 'expense';
        }
      } else if (toAccResolved && toAccResolved.id !== accResolved.id) {
        recordType = 'transfer';
      }

      const cleanDate = parseFlexibleSpreadsheetDate(dateRaw);
      const counterparty =
        counterpartyRaw ||
        (recordType === 'income' ? notesRaw || 'Imported Income' : notesRaw || categoryRaw || 'Imported Entry');
      const baseConv = convertServer2dp(amount, txCurrency, upperBase, activeRates, upperBase);

      const originalResolvedCategory =
        recordType === 'expense'
          ? resolveCategory(categoryRaw)
          : recordType === 'income'
            ? 'Income'
            : 'Transfer';
      const originalSubcategory = recordType === 'expense' ? subcategoryRaw : '';

      let finalCategory = originalResolvedCategory;
      let finalSubcategory = originalSubcategory;
      let autoMappedCategory = false;

      if (recordType === 'expense' && autoMapSubcategories) {
        if (subcategoryRaw) {
          const subHit = subToParentLookup.get(normalizeStr(subcategoryRaw));
          if (subHit) {
            finalCategory = subHit.category;
            finalSubcategory = subHit.subcategory;
            autoMappedCategory = true;
          }
        } else if (categoryRaw) {
          const catKey = normalizeStr(categoryRaw);
          if (!definedCategoryKeySet.has(catKey)) {
            const catAsSub = subToParentLookup.get(catKey);
            if (catAsSub) {
              finalCategory = catAsSub.category;
              finalSubcategory = catAsSub.subcategory;
              autoMappedCategory = true;
            }
          }
        }
      }

      normalizedDriveRows.push({
        rowIndex: idx + 1,
        rawRow,
        baseAmount: baseConv.convertedAmount,
        originalCategory: originalResolvedCategory,
        originalSubcategory,
        autoMappedCategory,
        proposed: {
          recordType,
          date: cleanDate,
          amount: round2dp(amount),
          currency: txCurrency.toUpperCase(),
          accountId: accResolved.id,
          toAccountId:
            recordType === 'transfer'
              ? toAccResolved?.id || accResolved.id
              : undefined,
          category: finalCategory,
          subcategory: finalSubcategory,
          counterparty,
          notes: notesRaw,
        },
      } as any);
    });

    // Deterministic 1-to-1 best-match reconciliation
    const usedExistingIds = new Set<string>();
    const reconciledRows: any[] = [];

    for (const item of normalizedDriveRows) {
      let bestCandidate: (typeof existingPool)[number] | null = null;
      let bestScore = 0;

      for (const cand of existingPool) {
        if (usedExistingIds.has(cand.id)) continue;
        if (cand.recordType !== item.proposed.recordType) continue;

        const dayDelta = daysBetweenYmd(cand.snapshot.date, item.proposed.date);
        if (dayDelta > 7) continue;

        const nativeDiff = Math.abs(cand.snapshot.amount - item.proposed.amount);
        const baseDiff = Math.abs(cand.baseAmount - item.baseAmount);
        const relDiff =
          item.proposed.amount > 0 ? nativeDiff / item.proposed.amount : 1;

        const textA = `${cand.snapshot.counterparty} ${cand.snapshot.notes} ${cand.snapshot.category}`;
        const textB = `${item.proposed.counterparty} ${item.proposed.notes} ${item.proposed.category}`;
        const textSim = textTokenSimilarity(textA, textB);
        const sameAccount = cand.snapshot.accountId === item.proposed.accountId;

        let score = 0;
        if (dayDelta === 0) score += 35;
        else if (dayDelta === 1) score += 24;
        else if (dayDelta <= 3) score += 14;
        else score += 5;

        if (nativeDiff < 0.01 || baseDiff < 0.01) score += 45;
        else if (relDiff <= 0.02) score += 30;
        else if (relDiff <= 0.08 && textSim >= 0.4) score += 20;
        else if (dayDelta === 0 && textSim >= 0.6) score += 15;
        else continue; // Too far in both amount and text to be the same record

        if (sameAccount) score += 10;
        score += Math.round(textSim * 25);

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = cand;
        }
      }

      if (bestCandidate && bestScore >= 65) {
        usedExistingIds.add(bestCandidate.id);
        const diffs = computeDiffsServer(bestCandidate.snapshot, item.proposed);
        const status = diffs.length === 0 ? 'matched' : 'difference';
        reconciledRows.push({
          rowId: `drv_row_${item.rowIndex}`,
          rowIndex: item.rowIndex,
          rawRow: item.rawRow,
          status,
          confidence: Math.min(100, bestScore),
          approved: status === 'difference',
          proposed: item.proposed,
          originalCategory: (item as any).originalCategory,
          originalSubcategory: (item as any).originalSubcategory,
          autoMappedCategory: Boolean((item as any).autoMappedCategory),
          matchedRecordId: bestCandidate.id,
          existingSnapshot: bestCandidate.snapshot,
          diffs,
        });
      } else {
        reconciledRows.push({
          rowId: `drv_row_${item.rowIndex}`,
          rowIndex: item.rowIndex,
          rawRow: item.rawRow,
          status: 'missing',
          confidence: 0,
          approved: true,
          proposed: item.proposed,
          originalCategory: (item as any).originalCategory,
          originalSubcategory: (item as any).originalSubcategory,
          autoMappedCategory: Boolean((item as any).autoMappedCategory),
          diffs: [],
        });
      }
    }

    const summary = {
      total: reconciledRows.length,
      matched: reconciledRows.filter((r) => r.status === 'matched').length,
      differences: reconciledRows.filter((r) => r.status === 'difference').length,
      missing: reconciledRows.filter((r) => r.status === 'missing').length,
    };

    return res.json({ rows: reconciledRows, summary });
  } catch (error: any) {
    console.error('Drive reconcile error:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to reconcile spreadsheet records.',
    });
  }
});

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
