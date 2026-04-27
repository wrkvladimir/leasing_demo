import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import https from "node:https";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const JAICP_TOKEN = process.env.JAICP_TOKEN || "";
const JAICP_HOST = process.env.JAICP_HOST || "bot.jaicp.com";
const ML_CALCULATOR_TOKEN = process.env.ML_CALCULATOR_TOKEN || "";
const SMS_USER = process.env.SMS_USER || "";
const SMS_PASSWORD = process.env.SMS_PASSWORD || "";
const SMS_SENDER = process.env.SMS_SENDER || "";
const AMO_WEBHOOK_URL = process.env.AMO_WEBHOOK_URL || "https://core.leadconnector.ru/mikroleasing/webhooks/just_ai/zhu2utnbn1hivdnvy0lvbjqrvgzqdz09";

const DEFAULT_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 4500);
const KB_TIMEOUT_MS = Number(process.env.KB_TIMEOUT_MS || 2500);
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS || 4500);

const httpClient = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
});

const mlClient = axios.create({
  baseURL: "https://personal.mikro-leasing.by/calculator/api/1.0",
  timeout: ML_TIMEOUT_MS,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 30 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 30 }),
});

const kbClient = axios.create({
  timeout: KB_TIMEOUT_MS,
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 30 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 30 }),
});

const CURRENCY_NAMES = {
  BYN: "белорусских рублей",
  USD: "долларов США",
  EUR: "евро",
  RUB: "российских рублей",
};

const DO_NOT_FINANCE_SHORT = [
  "земельные участки и природные объекты",
  "расходные материалы, сырье, топливо, продукты",
  "финансовые инструменты и интеллектуальная собственность",
  "бытовая техника, электроника, мебель, одежда и личные товары",
  "лекарства, расходные медизделия; дорогостоящее медоборудование может рассматриваться как оборудование",
  "животные, растения, религиозная и коллекционная собственность",
  "услуги и работы",
  "оружие и военная техника без официальной регистрации",
  "жилая недвижимость; коммерческая недвижимость может финансироваться",
  "личный спорттранспорт, игрушки, образовательные материалы и курсы",
];


const FALLBACK_SUBJECTS_BY_CLIENT_TYPE = {
  "Физическое лицо": ["Легковой автомобиль", "Прочий транспорт"],
  "Юридическое лицо": ["Легковой автомобиль", "Коммерческий транспорт", "Оборудование", "Спецтехника", "Прочий транспорт", "Грузовой автомобиль", "Недвижимость"],
};

const GLOBAL_DO_NOT_FINANCE_RULES = [
  { re: /(земел|участ|природн)/i, reason: "земельные участки и природные объекты не финансируются" },
  { re: /(сырь|топлив|продукт|расходн)/i, reason: "сырье, топливо, продукты и расходные материалы не финансируются" },
  { re: /(телевиз|холодильник|стиральн|бытов|мебел|одежд|личн)/i, reason: "бытовая техника, мебель, одежда и личные товары не финансируются" },
  { re: /(лекарств|медиздел|медицинск.*расход)/i, reason: "лекарства и расходные медицинские изделия не финансируются" },
  { re: /(животн|растени)/i, reason: "животные и растения не финансируются" },
  { re: /(услуг|работы|курс|обучен)/i, reason: "услуги, работы и образовательные курсы не финансируются" },
  { re: /(оруж|военн)/i, reason: "оружие и военная техника не финансируются без официальной регистрации" },
  { re: /(квартир|жил.*недвиж|дом для проживания|жиль)/i, reason: "жилая недвижимость не финансируется" },
];

const CONSTANTS = {
  nds: 20,
  maxPrepaidPercent: 39,
  forAMO: {
    status_consultation: { "СМС отправлено": 1, "Нужен менеджер": 2, "Консультация": 3 },
    chart_type: { 0: "annuity", 1: "linear" },
    lesse_type: { "Физическое лицо": 1, "Юридическое лицо": 2 },
    leasing_subject: {
      "Легковой автомобиль": 1,
      "Коммерческий транспорт": 2,
      "Оборудование": 3,
      "Спецтехника": 4,
      "Прочий транспорт": 5,
      "Грузовой автомобиль": 6,
      "Недвижимость": 7,
    },
    chart_currency: { USD: 1, EUR: 2, RUB: 3, BYN: 4 },
    condition: { 1: 1, 0: 2 },
  },
};

const rateCache = new Map();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function asToolText(result) {
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return { content: [{ type: "text", text }] };
}

function isConfigured(value) {
  return Boolean(value) && !/^your_|^change_me$/i.test(String(value));
}

function missingEnv(name) {
  throw new Error(`Не задана переменная окружения ${name}`);
}

function mlHeaders() {
  if (!isConfigured(ML_CALCULATOR_TOKEN)) missingEnv("ML_CALCULATOR_TOKEN");
  return { Authorization: `Bearer ${ML_CALCULATOR_TOKEN}` };
}

function compactArgs(args = {}) {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function termsToArray(terms) {
  if (!terms) return [];
  if (Array.isArray(terms)) return terms;
  if (typeof terms === "object") return Object.values(terms).filter((item) => item && typeof item === "object");
  return [];
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function publicError(error) {
  return error?.response?.data ? JSON.stringify(error.response.data) : error?.message || "unknown error";
}

function normalizeClientType(value) {
  const v = String(value || "").toLowerCase();
  if (/физ|частн|человек|граждан/.test(v)) return "Физическое лицо";
  if (/юр|компан|организац|ип|ооо|зао|оао|бизнес/.test(v)) return "Юридическое лицо";
  return value || null;
}

function allowedSubjectsFor(clientType) {
  const normalized = normalizeClientType(clientType);
  if (normalized && FALLBACK_SUBJECTS_BY_CLIENT_TYPE[normalized]) return FALLBACK_SUBJECTS_BY_CLIENT_TYPE[normalized];
  return [...new Set(Object.values(FALLBACK_SUBJECTS_BY_CLIENT_TYPE).flat())];
}

function classifySubject(rawSubject) {
  const raw = String(rawSubject || "").trim();
  const v = raw.toLowerCase();
  if (!v) return { normalized_subject: null, confidence: 0, reason: "empty" };
  if (/(камаз|маз|грузов|фура|тягач|самосвал|полуприцеп|прицеп|рефрижератор)/i.test(v)) return { normalized_subject: "Грузовой автомобиль", confidence: 0.92 };
  if (/(экскаватор|погрузчик|бульдозер|кран|манипулятор|трактор|комбайн|спецтех)/i.test(v)) return { normalized_subject: "Спецтехника", confidence: 0.9 };
  if (/(станок|оборудован|линия|аппарат|сервер|производствен)/i.test(v)) return { normalized_subject: "Оборудование", confidence: 0.82 };
  if (/(автобус|микроавтобус|маршрутк|коммерческ.*транспорт|фургон|газель)/i.test(v)) return { normalized_subject: "Коммерческий транспорт", confidence: 0.8 };
  if (/(мотоцикл|скутер|квадроцикл|лодк|катер|прицеп легков)/i.test(v)) return { normalized_subject: "Прочий транспорт", confidence: 0.75 };
  if (/(недвиж|офис|склад|помещен|здан)/i.test(v)) return { normalized_subject: "Недвижимость", confidence: 0.75 };
  if (/(bmw|бмв|lada|лада|priora|приора|mercedes|мерседес|audi|ауди|toyota|тойота|volkswagen|фольксваген|kia|киа|hyundai|хендай|renault|рено|авто|автомоб|машин|легков)/i.test(v)) return { normalized_subject: "Легковой автомобиль", confidence: 0.85 };
  return { normalized_subject: null, confidence: 0.2 };
}

function checkSubjectPolicy(args = {}) {
  const clientType = normalizeClientType(args.client_type);
  const rawSubject = args.raw_subject || args.subject || args.query || "";
  const raw = String(rawSubject || "");
  const deniedRule = GLOBAL_DO_NOT_FINANCE_RULES.find((rule) => rule.re.test(raw));
  if (deniedRule) {
    return { ok: false, client_type: clientType, raw_subject: rawSubject, normalized_subject: null, reason: `К сожалению, ${deniedRule.reason}.`, ask_next: "Назовите, пожалуйста, другой предмет лизинга.", source: "deterministic_policy" };
  }
  const classified = classifySubject(rawSubject);
  if (!classified.normalized_subject) {
    return { ok: null, needs_clarification: true, client_type: clientType, raw_subject: rawSubject, normalized_subject: null, reason: "Не удалось надежно определить категорию предмета лизинга.", ask_next: "Уточните, пожалуйста, что именно хотите взять в лизинг: легковой автомобиль, транспорт, оборудование, спецтехнику или недвижимость?", source: "deterministic_policy" };
  }
  const allowed = allowedSubjectsFor(clientType);
  if (clientType && !allowed.includes(classified.normalized_subject)) {
    const askNext = clientType === "Физическое лицо" ? "Для физических лиц доступны легковой автомобиль или прочий транспорт. Какой вариант вам подходит?" : "Назовите, пожалуйста, другой предмет лизинга.";
    return { ok: false, client_type: clientType, raw_subject: rawSubject, normalized_subject: classified.normalized_subject, confidence: classified.confidence, allowed_subjects: allowed, reason: `К сожалению, ${classified.normalized_subject.toLowerCase()} для типа клиента «${clientType}» не финансируется.`, ask_next: askNext, source: "deterministic_policy" };
  }
  return { ok: true, client_type: clientType, raw_subject: rawSubject, normalized_subject: classified.normalized_subject, confidence: classified.confidence, allowed_subjects: allowed, source: "deterministic_policy" };
}

function prepaidPercentFromInput({ prepaid, prepaid_amount, cost }) {
  if (prepaid !== undefined && prepaid !== null && prepaid !== "") {
    const n = Number(String(prepaid).replace(",", "."));
    if (Number.isFinite(n)) return n <= 100 ? n : Math.round((n / Number(cost)) * 10000) / 100;
  }
  if (prepaid_amount !== undefined && prepaid_amount !== null && prepaid_amount !== "") {
    const n = Number(String(prepaid_amount).replace(",", "."));
    if (Number.isFinite(n) && Number(cost) > 0) return Math.round((n / Number(cost)) * 10000) / 100;
  }
  return null;
}

async function getRate(currencyCode) {
  const code = String(currencyCode || "").toUpperCase();
  if (code === "BYN") return { Cur_Abbreviation: "BYN", Cur_Scale: 1, Cur_OfficialRate: 1 };

  const cached = rateCache.get(code);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const response = await httpClient.get(`https://api.nbrb.by/exrates/rates/${encodeURIComponent(code)}`, {
    params: { periodicity: 0, parammode: 2 },
  });
  rateCache.set(code, { value: response.data, ts: Date.now() });
  return response.data;
}

async function convertCurrency({ amount, starting_currency, result_currency }) {
  const start = String(starting_currency || "").toUpperCase();
  const result = String(result_currency || "").toUpperCase();
  const sum = Number(amount);

  if (!Number.isFinite(sum)) throw new Error("amount должен быть числом");
  if (start === result) return Math.round(sum);

  const rateStart = await getRate(start);
  const rateResult = await getRate(result);
  if (!rateStart || !rateResult) throw new Error("Не удалось получить курс валюты");

  const inBYN = start === "BYN" ? sum : (sum * rateStart.Cur_OfficialRate) / rateStart.Cur_Scale;
  const converted = result === "BYN" ? inBYN : (inBYN / rateResult.Cur_OfficialRate) * rateResult.Cur_Scale;
  return Math.round(converted);
}

async function mlGet(path, params = {}) {
  const response = await mlClient.get(path, { headers: mlHeaders(), params: compactArgs(params) });
  return response.data;
}

async function checkSubjects(args = {}) {
  try {
    return await mlGet("/subjects/");
  } catch (error) {
    const clientType = normalizeClientType(args.client_type);
    return {
      ok: true,
      calculator_available: false,
      source: "fallback_subjects",
      client_type: clientType,
      allowed_subjects: clientType ? allowedSubjectsFor(clientType) : FALLBACK_SUBJECTS_BY_CLIENT_TYPE,
      note_for_agent: "Калькулятор не вернул список предметов; используй fallback только для маршрутизации, расчетные проверки всё равно делай инструментами. Не говори клиенту про техническую ошибку.",
      technical_error: publicError(error),
    };
  }
}

async function checkRanges(args) {
  return mlGet("/ranges/", { subject: args.subject, currency: args.currency });
}

async function checkTerms(args) {
  return mlGet("/terms/", compactArgs(args));
}

async function getPaymentSchedule(args) {
  return mlGet("/calculate/", compactArgs(args));
}

function getMinPrepaidFromTerms(terms) {
  const values = termsToArray(terms).map((item) => numberOrNull(item.prepaid)).filter((n) => n !== null);
  return values.length ? Math.min(...values) : null;
}

function getMaxTermFromTerms(terms, prepaidPercent) {
  const items = termsToArray(terms);
  if (!items.length) return null;
  if (prepaidPercent === undefined || prepaidPercent === null) {
    const termsOnly = items.map((item) => numberOrNull(item.term)).filter((n) => n !== null);
    return termsOnly.length ? Math.max(...termsOnly) : null;
  }
  const withTerm = items
    .map((item) => ({ term: numberOrNull(item.term), prepaid: numberOrNull(item.prepaid) }))
    .filter((item) => item.term !== null);
  if (!withTerm.length) return null;
  const closest = withTerm.reduce((best, item) => {
    const diff = item.prepaid === null ? 0 : Math.abs(item.prepaid - Number(prepaidPercent));
    if (!best || diff < best.diff || (diff === best.diff && item.term > best.term)) return { ...item, diff };
    return best;
  }, null);
  return closest?.term ?? null;
}

async function validateCost(args) {
  const currency = String(args.currency || args.result_currency || "BYN").toUpperCase();
  const cost = Number(args.cost);
  if (!Number.isFinite(cost)) throw new Error("cost должен быть числом");
  try {
    const ranges = await checkRanges({ subject: args.subject, currency });
    const range = Array.isArray(ranges) ? ranges[0] : ranges;
    const min = numberOrNull(range?.range_min ?? range?.cost_min);
    const max = numberOrNull(range?.range_max ?? range?.cost_max ?? range?.cost_ax);
    const ok = (min === null || cost >= min) && (max === null || cost <= max);
    return { ok, calculator_available: true, cost, currency, currency_name: CURRENCY_NAMES[currency] || currency, min_cost: min, max_cost: max, message: ok ? "Стоимость в допустимом диапазоне." : `Стоимость должна быть${min !== null ? ` не меньше ${min}` : ""}${max !== null ? ` и не больше ${max}` : ""} ${CURRENCY_NAMES[currency] || currency}.`, raw_ranges: ranges };
  } catch (error) {
    return { ok: null, calculator_available: false, technical_error: true, cost, currency, currency_name: CURRENCY_NAMES[currency] || currency, message: "Сейчас не удалось проверить допустимый диапазон стоимости в калькуляторе. Не говори клиенту про доступ к системе. Предложи повторить проверку или передать запрос специалисту.", error_for_logs: publicError(error) };
  }
}

async function validateAdvanceAndTerm(args) {
  const prepaidPercent = prepaidPercentFromInput(args);
  if (prepaidPercent === null) throw new Error("Передайте prepaid в процентах или prepaid_amount и cost");
  const messages = [];
  let ok = true;
  if (prepaidPercent > CONSTANTS.maxPrepaidPercent) {
    ok = false;
    messages.push(`Авансовый платеж не может превышать ${CONSTANTS.maxPrepaidPercent} процентов.`);
  }
  const base = { client_type: args.client_type, subject: args.subject, condition_new: args.condition_new, age: args.age, currency: args.currency, cost: args.cost, type_schedule: args.type_schedule };
  try {
    const termsForPrepaid = await checkTerms(base);
    const minPrepaid = getMinPrepaidFromTerms(termsForPrepaid);
    if (minPrepaid !== null && prepaidPercent < minPrepaid) { ok = false; messages.push(`Минимальный аванс по этим условиям — ${minPrepaid} процентов.`); }
    const termsForTerm = await checkTerms({ ...base, prepaid: prepaidPercent });
    const maxTerm = getMaxTermFromTerms(termsForTerm, prepaidPercent);
    const term = numberOrNull(args.term);
    if (term !== null && maxTerm !== null && term > maxTerm) { ok = false; messages.push(`Максимальный срок по этим условиям — ${maxTerm} месяцев.`); }
    return { ok, calculator_available: true, prepaid_percent: prepaidPercent, max_prepaid_percent: CONSTANTS.maxPrepaidPercent, min_prepaid_percent: minPrepaid, requested_term_months: term, max_term_months: maxTerm, messages, raw_terms_for_prepaid: termsForPrepaid, raw_terms_for_term: termsForTerm };
  } catch (error) {
    return { ok: ok ? null : false, calculator_available: false, technical_error: true, prepaid_percent: prepaidPercent, max_prepaid_percent: CONSTANTS.maxPrepaidPercent, messages: messages.length ? messages : ["Удалось проверить только общий лимит аванса 39 процентов; условия по сроку сейчас не получены из калькулятора."], message: "Сейчас не удалось проверить срок и минимальный аванс в калькуляторе. Не говори клиенту про доступ к системе. Предложи повторить проверку или передать запрос специалисту.", error_for_logs: publicError(error) };
  }
}

async function calculateSchedules(args) {
  const schedules = Array.isArray(args.schedules) && args.schedules.length ? args.schedules : [args.type_schedule ?? 0];
  const uniqueSchedules = [...new Set(schedules.map((x) => Number(x)))].filter((x) => x === 0 || x === 1);
  try {
    const calls = uniqueSchedules.map(async (type) => {
      const raw = await getPaymentSchedule({ ...args, type_schedule: type, schedules: undefined });
      return { type_schedule: type, type_name: type === 0 ? "равные платежи" : "платежи на убывание", raw };
    });
    return { ok: true, calculator_available: true, results: await Promise.all(calls) };
  } catch (error) {
    return { ok: false, calculator_available: false, technical_error: true, message: "Сейчас не удалось получить график платежей из калькулятора. Не говори клиенту про доступ к системе. Предложи повторить расчет или передать запрос специалисту.", error_for_logs: publicError(error) };
  }
}

function normalizeBelarusPhone(phoneRaw) {
  const digits = String(phoneRaw || "").replace(/\D/g, "");
  let normalized = digits;
  if (/^80(29|25|44|33)\d{7}$/.test(normalized)) normalized = `375${normalized.slice(2)}`;
  if (/^8(29|25|44|33)\d{7}$/.test(normalized)) normalized = `375${normalized.slice(1)}`;
  if (/^(29|25|44|33)\d{7}$/.test(normalized)) normalized = `375${normalized}`;
  const ok = /^375(29|25|44|33)\d{7}$/.test(normalized);
  return { ok, phone: normalized, original_digits: digits };
}

async function sendSms({ phoneNumberForSms, message }) {
  if (!isConfigured(SMS_USER) || !isConfigured(SMS_PASSWORD) || !isConfigured(SMS_SENDER)) missingEnv("SMS_USER/SMS_PASSWORD/SMS_SENDER");
  const phone = normalizeBelarusPhone(phoneNumberForSms);
  if (!phone.ok) throw new Error("Номер не соответствует формату Республики Беларусь");
  const response = await httpClient.get("https://userarea.sms-assistent.by/api/v1/send_sms/plain", {
    params: { user: SMS_USER, password: SMS_PASSWORD, recipient: phone.phone, message, sender: SMS_SENDER },
  });
  return { phone: phone.phone, result: response.data };
}

async function sendToAmo(args) {
  const constants = CONSTANTS.forAMO;
  const prepared = {
    сhannel_type: args.channel_type ?? 0,
    phone_number: args.phoneNumberForSms ?? null,
    phone_contact: args.phoneNumberForSms ?? null,
    status_consultation: args.statusConsultation ? constants.status_consultation[args.statusConsultation] : null,
    chart_type: args.type_schedule !== undefined ? constants.chart_type[String(args.type_schedule)] : null,
    lesse_type: args.client_type ? constants.lesse_type[args.client_type] : null,
    leasing_subject: args.subject ? constants.leasing_subject[args.subject] : null,
    chart_currency: args.currency ? constants.chart_currency[args.currency] : null,
    chart_contract_price: args.cost ?? null,
    issue_year: args.yearProductionAuto ?? null,
    condition: args.condition_new !== undefined ? constants.condition[String(args.condition_new)] : null,
    chart_time_close: args.term ?? null,
    prepayment: args.calculation_result?.[0]?.sum ?? null,
    advance_payment: args.prepaid ?? null,
    calculation_result: args.calculation_result ?? null,
    transcription: args.transcription ?? null,
  };
  const response = await httpClient.post(AMO_WEBHOOK_URL, prepared, { headers: { "Content-Type": "application/json" } });
  return response.data || { ok: true };
}

async function kbSearch({ query, clientId = "mcp-user" }) {
  if (!JAICP_TOKEN) missingEnv("JAICP_TOKEN");
  const response = await kbClient.post(`https://${JAICP_HOST}/chatapi/${JAICP_TOKEN}`, { query, clientId });
  const botData = response.data || {};
  const answer = botData.answer || (botData.replies || []).filter((reply) => reply.type === "text").map((reply) => reply.text).join("\n");
  return answer || "Информация не найдена в базе знаний.";
}

const tools = [
  {
    name: "kb.search",
    description: "Ищет ответ в базе знаний Just AI/JAICP. Использовать только для вопросов по оформлению лизинга, документам, условиям и процессу; не использовать для посторонних тем.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, clientId: { type: "string" } }, required: ["query"] },
  },
  {
    name: "leasing.get_subjects",
    description: "Возвращает разрешенные категории предметов лизинга. Вызывать один раз после определения типа клиента; при сбое калькулятора возвращает fallback для маршрутизации.",
    inputSchema: { type: "object", properties: { client_type: { type: "string" } } },
  },
  {
    name: "leasing.check_subject_policy",
    description: "Проверяет и нормализует предмет лизинга с учетом типа клиента. Вызывать сразу после ответа клиента о предмете. Если ok=false, не продолжать расчет.",
    inputSchema: { type: "object", properties: { client_type: { type: "string" }, raw_subject: { type: "string" } }, required: ["client_type", "raw_subject"] },
  },
  {
    name: "leasing.validate_cost",
    description: "Проверяет стоимость предмета по диапазонам калькулятора сразу после получения стоимости/конвертации.",
    inputSchema: {
      type: "object",
      properties: { subject: { type: "string" }, currency: { type: "string" }, cost: { type: "number" } },
      required: ["subject", "currency", "cost"],
    },
  },
  {
    name: "leasing.validate_advance_term",
    description: "Проверяет аванс и срок: максимум аванса 39%, минимум аванса из калькулятора, максимум срока из калькулятора.",
    inputSchema: {
      type: "object",
      properties: {
        client_type: { type: "string" }, subject: { type: "string" }, condition_new: { type: "string" }, age: { type: "string" },
        currency: { type: "string" }, cost: { type: "string" }, prepaid: { type: "string" }, prepaid_amount: { type: "number" },
        term: { type: "string" }, type_schedule: { type: "string" },
      },
      required: ["client_type", "subject", "condition_new", "age", "currency", "cost", "prepaid"],
    },
  },
  {
    name: "leasing.calculate_schedules",
    description: "Рассчитывает один или два графика платежей. Для запроса 'оба варианта' передать schedules: [0,1], вызов будет выполнен параллельно.",
    inputSchema: {
      type: "object",
      properties: {
        client_type: { type: "string" }, subject: { type: "string" }, condition_new: { type: "string" }, age: { type: "string" },
        currency: { type: "string" }, cost: { type: "string" }, prepaid: { type: "string" }, term: { type: "string" },
        type_schedule: { type: "string" }, schedules: { type: "array", items: { type: "number" } }, seller: { type: "string" }, nds_principal: { type: "string" },
      },
      required: ["client_type", "subject", "condition_new", "age", "currency", "cost", "prepaid", "term"],
    },
  },
  {
    name: "currency.convert",
    description: "Конвертирует сумму между BYN, USD, EUR, RUB по курсу НБ РБ; результаты кешируются на 12 часов.",
    inputSchema: {
      type: "object",
      properties: { amount: { type: "number" }, starting_currency: { type: "string" }, result_currency: { type: "string" } },
      required: ["amount", "starting_currency", "result_currency"],
    },
  },
  {
    name: "phone.normalize_by",
    description: "Нормализует и проверяет номер телефона Республики Беларусь. Возвращает номер в формате 375XXXXXXXXX.",
    inputSchema: { type: "object", properties: { phone: { type: "string" } }, required: ["phone"] },
  },
  {
    name: "sms.send",
    description: "Отправляет SMS после согласия клиента. Номер должен быть белорусским; инструмент сам нормализует формат.",
    inputSchema: { type: "object", properties: { phoneNumberForSms: { type: "string" }, message: { type: "string" } }, required: ["phoneNumberForSms", "message"] },
  },
  {
    name: "amo.send_consultation",
    description: "Отправляет итог консультации в AMO CRM. Вызывать после завершения консультации, отказа, запроса менеджера или отправки SMS.",
    inputSchema: { type: "object", properties: { statusConsultation: { type: "string" }, phoneNumberForSms: { type: "string" }, client_type: { type: "string" }, subject: { type: "string" }, cost: { type: "string" }, currency: { type: "string" }, prepaid: { type: "string" }, term: { type: "string" }, calculation_result: { type: "object" } }, required: ["statusConsultation"] },
  },
  {
    name: "dict.do_not_finance",
    description: "Краткий список предметов, которые не финансируются. Не отдаёт длинный текст в контекст.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "kb.search":
    case "send_message":
      return kbSearch(args);

    case "leasing.get_subjects":
    case "MLCalculator.checkLizingObject":
      return checkSubjects(args);

    case "leasing.check_subject_policy":
      return checkSubjectPolicy(args);

    case "leasing.validate_cost":
      return validateCost(args);

    case "leasing.validate_advance_term":
      return validateAdvanceAndTerm(args);

    case "leasing.calculate_schedules":
      return calculateSchedules(args);

    case "currency.convert":
    case "Conversion.currencyConversionAll":
      return convertCurrency(args);

    case "phone.normalize_by":
      return normalizeBelarusPhone(args.phone);

    case "sms.send":
    case "SMSAssistent.sendSMS":
      return sendSms(args);

    case "amo.send_consultation":
    case "othersFunctions.sendResultConsultationInAMO":
      return sendToAmo(args);

    case "dict.do_not_finance":
    case "Dictionaries.doNotFinance":
      return DO_NOT_FINANCE_SHORT;

    case "dict.constants":
    case "Dictionaries.constants":
      return CONSTANTS;

    // Compatibility aliases for old MCP prompts. Prefer the compact tools above in production.
    case "NBRB.getRateOneCurrency":
      return getRate(args.currencyCode);
    case "NBRB.getExchangeRates": {
      const response = await httpClient.get("https://api.nbrb.by/exrates/rates/", { params: { periodicity: 0, parammode: 2 } });
      return response.data;
    }
    case "MLCalculator.checkRanges":
      return checkRanges(args);
    case "MLCalculator.checkTerms":
      return checkTerms(args);
    case "MLCalculator.getPaymentSchedule":
      return getPaymentSchedule(args);
    case "othersFunctions.getMinPrepaidFromCalculatorResult":
      return { minPrepaidValue: getMinPrepaidFromTerms(args.objectTermsFromCalc) };
    case "othersFunctions.addNDSForCost":
      return Number(args.cost) + (Number(args.cost) * CONSTANTS.nds) / 100;
    default:
      throw new Error(`Tool not found: ${name}`);
  }
}

function setupHandlers(server) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await callTool(name, args || {});
      return asToolText(result);
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error.response?.data ? JSON.stringify(error.response.data) : error.message }],
      };
    }
  });
}

const app = express();
app.use(cors());

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

const transports = new Map();

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "micro-leasing-mcp-v2-hotfix",
    tools: tools.length,
    env: {
      JAICP_TOKEN: isConfigured(JAICP_TOKEN),
      ML_CALCULATOR_TOKEN: isConfigured(ML_CALCULATOR_TOKEN),
      SMS_USER: isConfigured(SMS_USER),
      SMS_PASSWORD: isConfigured(SMS_PASSWORD),
      SMS_SENDER: isConfigured(SMS_SENDER),
      AMO_WEBHOOK_URL: isConfigured(AMO_WEBHOOK_URL),
    },
  });
});

app.get("/sse", async (_req, res) => {
  const server = new Server({ name: "micro-leasing-mcp-v2-hotfix", version: "1.2.0" }, { capabilities: { tools: {} } });
  setupHandlers(server);
  const transport = new SSEServerTransport("/message", res);
  transports.set(transport.sessionId, transport);
  await server.connect(transport);
  res.on("close", () => transports.delete(transport.sessionId));
});

app.post("/message", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) return res.status(400).send("Session not found or expired");
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`Micro Leasing MCP v2 hotfix listening on port ${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`Message endpoint: http://localhost:${PORT}/message`);
});
