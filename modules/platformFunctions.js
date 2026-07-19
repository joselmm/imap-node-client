import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

function getConfig() {
  const dbUri = process.env.DB_URI || process.env.SHEET_DATA_LIBRARY;
  const sheetId = process.env.SHEET_ID || process.env.SS_ID;

  if (!dbUri) throw new Error('Falta DB_URI o SHEET_DATA_LIBRARY en .env');
  if (!sheetId) throw new Error('Falta SHEET_ID o SS_ID en .env');

  return { dbUri, sheetId };
}

export async function queryData(sheet, condition) {
  const { dbUri, sheetId } = getConfig();

  const payload = {
    queryParameters: {
      spreadSheetId: sheetId,
      sheetIdType: 'name',
      sheetId: sheet,
    },
    action: 'GET_IF',
    condition,
  };

  const res = await fetch(dbUri, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return json;
}

export async function asignarPlataformas(clienteEmail, plataformasEmails, senderContact, isOwner) {
  const results = {
    asignadas: [],
    yaAsignadas: [],
    noEncontradas: [],
    inactivas: [],
  };

  let cliente;
  let clienteId;
  const senderClientIds = new Set();

  if (isOwner) {
    const clientResponse = await queryData('clients', `@emailContact@ == '${clienteEmail}'`);
    if (!clientResponse.noError || !clientResponse.data || clientResponse.data.length === 0) {
      return { noError: false, errorMessage: `No se encontró cliente con email: ${clienteEmail}` };
    }
    cliente = clientResponse.data[0];
    clienteId = cliente.id;
  } else {
    const clientResponse = await queryData('clients', `@contact@ == '${senderContact}'`);
    if (!clientResponse.noError || !clientResponse.data || clientResponse.data.length === 0) {
      return { noError: false, errorMessage: `No tienes clientes registrados con este número` };
    }

    const senderClients = clientResponse.data;
    senderClients.forEach(c => senderClientIds.add(c.id));

    cliente = senderClients.find(c => c.emailContact === clienteEmail);
    if (!cliente) {
      return { noError: false, errorMessage: `El email ${clienteEmail} no pertenece a ninguno de tus clientes` };
    }
    clienteId = cliente.id;
  }

  const condition = plataformasEmails.map(e => `@email@ == '${e}'`).join(' || ');
  const platResponse = await queryData('platforms', condition);

  if (!platResponse.noError) {
    return { noError: false, errorMessage: platResponse.errorMessage || 'Error al consultar plataformas' };
  }

  const encontradas = platResponse.data || [];
  const emailsEncontrados = new Set(encontradas.map(p => p.email));
  const toUpdate = [];

  for (const email of plataformasEmails) {
    if (!emailsEncontrados.has(email)) {
      results.noEncontradas.push(email);
      continue;
    }

    const plataforma = encontradas.find(p => p.email === email);

    if (plataforma.active === "0") {
      results.inactivas.push(email);
      continue;
    }

    if (!isOwner && plataforma.clientId && !senderClientIds.has(plataforma.clientId)) {
      return {
        noError: false,
        errorMessage: `La plataforma ${email} no te pertenece. Solo puedes reasignar plataformas que estén a tu nombre.`
      };
    }

    if (plataforma.clientId === clienteId) {
      results.yaAsignadas.push(email);
    } else {
      results.asignadas.push(email);
      toUpdate.push({ id: plataforma.id, clientId: clienteId });
    }
  }

  if (toUpdate.length > 0) {
    await updatePlatforms(toUpdate);
  }

  return {
    noError: true,
    clienteEmail,
    clienteId,
    results,
  };
}

export async function updatePlatforms(platforms, options = {}) {
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error('platforms debe ser un array no vacío');
  }

  const { dbUri, sheetId } = getConfig();
  const condition = options.update_if || "@id@ === ROW_OBJECT['id']";

  const payload = {
    queryParameters: {
      spreadSheetId: options.sheetId || sheetId,
      sheetIdType: 'name',
      sheetId: 'platforms',
    },
    action: 'UPDATE_IF',
    condition,
    payload: platforms,
  };

  const res = await fetch(dbUri, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return json;
}
