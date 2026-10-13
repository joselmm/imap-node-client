import dotenv from 'dotenv';
import { selectRows, upsertRows, inList } from './supabase.js';
import { candidatosNumero } from './consultarCodigo.js';

dotenv.config();

/** SELECT genérico. Devuelve { noError, data } para mantener la forma anterior. */
export async function queryData(table, filters = []) {
  try {
    const data = await selectRows(table, { filters });
    return { noError: true, data };
  } catch (e) {
    return { noError: false, errorMessage: e.message, data: [] };
  }
}

export async function asignarPlataformas(clienteEmail, plataformasEmails, senderContact) {
  const results = {
    asignadas: [],
    yaAsignadas: [],
    noEncontradas: [],
    inactivas: [],
  };

  const candidatos = candidatosNumero(senderContact);
  const clientResponse = await queryData('clients', [inList('contact', candidatos)]);
  if (!clientResponse.noError || !clientResponse.data || clientResponse.data.length === 0) {
    return { noError: false, errorMessage: `No tienes clientes registrados con este número` };
  }

  const senderClients = clientResponse.data;
  const senderClientIds = new Set(senderClients.map(c => c.id));

  const cliente = senderClients.find(c => c.emailContact.toLowerCase() === clienteEmail.toLowerCase());
  if (!cliente) {
    return { noError: false, errorMessage: `El email ${clienteEmail} no pertenece a ninguno de tus clientes` };
  }
  const clienteId = cliente.id;

  const platResponse = await queryData('platforms', [inList('email', plataformasEmails)]);

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

    if (plataforma.clientId && !senderClientIds.has(plataforma.clientId)) {
      return {
        noError: false,
        errorMessage: `La plataforma ${email} no te pertenece. Solo puedes reasignar plataformas que estén a tu nombre.`
      };
    }

    if (plataforma.clientId === clienteId) {
      results.yaAsignadas.push(email);
    } else {
      results.asignadas.push(email);
      toUpdate.push({ ...plataforma, clientId: clienteId });
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

/**
 * Actualiza/inserta plataformas por su id (equivalente al UPDATE_IF anterior,
 * donde la condición era @id@ === ROW_OBJECT['id']).
 */
export async function updatePlatforms(platforms) {
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error('platforms debe ser un array no vacío');
  }

  const data = await upsertRows('platforms', platforms);
  return { noError: true, data };
}
