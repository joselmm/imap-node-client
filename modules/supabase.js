/**
 * Cliente mínimo de Supabase usando solo fetch (sin librerías de Supabase).
 *
 * Variables de entorno esperadas:
 *   - SHEET_DATA_LIBRARY (ó DB_URI)   -> URL base del proyecto de Supabase
 *   - SS_ID            (ó SHEET_ID)   -> public/anon key del proyecto
 *
 * Cada "sheet" del backend anterior equivale a una tabla de Postgres.
 */
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const REST_PATH = '/rest/v1';
const PAGE_SIZE = 1000;

function getBaseUrl() {
  const base = process.env.SHEET_DATA_LIBRARY || process.env.DB_URI || '';
  return base.replace(/\/+$/, '');
}

function getApiKey() {
  return process.env.SS_ID || process.env.SHEET_ID || '';
}

function buildHeaders(extra) {
  const key = getApiKey();
  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
  };
  if (extra) {
    for (const name in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, name)) {
        headers[name] = extra[name];
      }
    }
  }
  return headers;
}

/**
 * Normaliza lo que se ENVÍA a la base: todo string vacío "" pasa a null.
 * (Google Sheets guardaba "" para celdas vacías; Supabase usa null.)
 */
function transformOut(value) {
  if (Array.isArray(value)) return value.map(transformOut);
  if (value !== null && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = value[key] === '' ? null : value[key];
    });
    return out;
  }
  return value;
}

/**
 * Normaliza lo que se RECIBE de la base: todo null pasa a "" para no romper
 * los .toLowerCase() / comparaciones del flujo anterior.
 */
function transformIn(value) {
  if (Array.isArray(value)) return value.map(transformIn);
  if (value !== null && typeof value === 'object') {
    const clean = {};
    Object.keys(value).forEach((key) => {
      clean[key] = value[key] === null ? '' : value[key];
    });
    return clean;
  }
  return value;
}

async function request(url, options) {
  options = options || {};
  const headers = buildHeaders();
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch (e) {
      detail = response.statusText;
    }
    throw new Error(
      'Supabase error ' + response.status + ' (' + (options.method || 'GET') + ' ' + url + '): ' + detail
    );
  }

  if (response.status === 204) return null;

  const text = await response.text();
  return text ? transformIn(JSON.parse(text)) : null;
}

function buildQuery(filters, extra) {
  const params = new URLSearchParams();
  if (extra) {
    for (const key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        const value = extra[key];
        if (value !== undefined && value !== null) params.set(key, value);
      }
    }
  }
  (filters || []).forEach((filter) => {
    params.append(filter[0], filter[1]);
  });
  const qs = params.toString();
  return qs ? '?' + qs : '';
}

/** Filtro de igualdad: campo === valor */
export function eq(field, value) {
  return [field, 'eq.' + value];
}

/** Filtro de lista: campo IN (valores) */
export function inList(field, values) {
  return [
    field,
    'in.(' + values.map((v) => '"' + v + '"').join(',') + ')',
  ];
}

/** Filtro tipo LIKE (usar * como comodín) */
export function like(field, pattern) {
  return [field, 'like.' + pattern];
}

/**
 * SELECT: devuelve un array de filas de la tabla.
 * Pagina automáticamente (Supabase limita a 1000 filas por petición).
 */
export async function selectRows(table, opts) {
  opts = opts || {};
  const select = opts.select || '*';
  const filters = opts.filters || [];

  if (opts.limit !== undefined) {
    const limitedUrl =
      getBaseUrl() +
      REST_PATH +
      '/' +
      table +
      buildQuery(filters, {
        select: select,
        order: opts.order,
        limit: opts.limit,
        offset: opts.offset,
      });
    return (await request(limitedUrl)) || [];
  }

  let all = [];
  let offset = 0;
  let keepGoing = true;
  while (keepGoing) {
    const pageUrl =
      getBaseUrl() +
      REST_PATH +
      '/' +
      table +
      buildQuery(filters, {
        select: select,
        order: opts.order,
        limit: PAGE_SIZE,
        offset: offset,
      });
    const page = (await request(pageUrl)) || [];
    all = all.concat(page);
    if (page.length < PAGE_SIZE) {
      keepGoing = false;
    } else {
      offset += PAGE_SIZE;
    }
  }
  return all;
}

/** INSERT: agrega filas y devuelve las filas insertadas */
export async function insertRows(table, rows) {
  const url = getBaseUrl() + REST_PATH + '/' + table;
  const result = await request(url, {
    method: 'POST',
    body: JSON.stringify(transformOut(rows)),
    prefer: 'return=representation',
  });
  return result || [];
}

/** UPSERT: inserta o actualiza por llave primaria (id) */
export async function upsertRows(table, rows) {
  const url = getBaseUrl() + REST_PATH + '/' + table;
  const result = await request(url, {
    method: 'POST',
    body: JSON.stringify(transformOut(rows)),
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return result || [];
}

/** UPDATE: actualiza filas que cumplan los filtros */
export async function updateRows(table, filters, values) {
  const url = getBaseUrl() + REST_PATH + '/' + table + buildQuery(filters);
  const result = await request(url, {
    method: 'PATCH',
    body: JSON.stringify(transformOut(values)),
    prefer: 'return=representation',
  });
  return result || [];
}

/** DELETE: elimina filas que cumplan los filtros */
export async function deleteRows(table, filters) {
  const url = getBaseUrl() + REST_PATH + '/' + table + buildQuery(filters);
  const result = await request(url, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  return result || [];
}

/**
 * Reemplazo del endpoint `get_multiple_sheets_data` de Apps Script.
 * Devuelve { sheetsData: [{ sheetId, data, dataDisplay }] }.
 */
export async function getMultipleSheetsData(sheetsIds) {
  const sheetsData = await Promise.all(
    sheetsIds.map(async (sheetId) => {
      const data = await selectRows(sheetId);
      return { sheetId, data, dataDisplay: data };
    })
  );
  return { sheetsData };
}
