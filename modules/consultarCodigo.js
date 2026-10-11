import { parsePhoneNumberWithError } from 'libphonenumber-js';

export function obtenerNumeroLocal(remoteJid) {
    try {
        // 1. Extraemos los números del JID (ej: "573001234567@s.whatsapp.net" -> "+573001234567")
        const idLimpio = "+" + remoteJid.split('@')[0];

        // 2. Parseamos el número
        const phoneNumber = parsePhoneNumberWithError(idLimpio);

        // 3. 'nationalNumber' nos devuelve el número SIN el código de país
        return phoneNumber.nationalNumber; 

    } catch (error) {
        // Si falla el parseo (ej: número mal formado), devolvemos el ID original sin el @
        return remoteJid.split('@')[0];
    }
}

/**
 * Limpia un número escrito a mano: quita espacios, guiones, paréntesis y el
 * prefijo de país, devolviendo solo el número nacional (como está en la db).
 *
 * Acepta tanto números con prefijo internacional ("+57 314 885 4055",
 * "573148854055") como números nacionales ("314 885 4055", "3148854055").
 * Si el país por defecto no aplica, cae al número solo con dígitos.
 */
export function limpiarNumero(input, defaultCountry = process.env.DEFAULT_COUNTRY || 'CO') {
    if (input === undefined || input === null) return '';

    const raw = String(input).trim();
    const digitos = raw.replace(/\D/g, '');
    if (!digitos) return '';

    try {
        // Con "+" el prefijo es explícito; sin "+" usamos el país por defecto.
        const phoneNumber = raw.startsWith('+')
            ? parsePhoneNumberWithError('+' + digitos)
            : parsePhoneNumberWithError(digitos, defaultCountry);

        return phoneNumber.nationalNumber;
    } catch (error) {
        return digitos;
    }
}

/**
 * Devuelve las posibles formas "limpias" de un número para buscarlo en la db
 * (con y sin prefijo), por si el país por defecto no logra deducir el prefijo.
 */
export function candidatosNumero(input, defaultCountry = process.env.DEFAULT_COUNTRY || 'CO') {
    const digitos = String(input ?? '').replace(/\D/g, '');
    const limpio = limpiarNumero(input, defaultCountry);
    return [...new Set([limpio, digitos].filter(Boolean))];
}


// Utilidad auxiliar para pausar la ejecución (reemplaza tu retryWithCountdown)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Consulta el código/link en GAS.
 * @param {string} email - Email a consultar.
 * @param {string} contact - Contacto/WhatsApp.
 * @param {boolean} isRetry - Uso interno para saber si ya se reintentó.
 * @returns {Promise<Object>} { noError, errorMessage, code, link, about }
 */
export async function consultarCodigo(email, contact, isRetry = false) {
    const urlGas = process.env.CONSULTAR_CODES_URL;

    try {
        const response = await fetch(urlGas, {
            method: "POST",
            body: JSON.stringify({ emailToCheck: email, contact, wa:true }),
            headers: { "Content-Type": "application/json" }
        });

        const data = await response.json();

        // 1️⃣ CASO DE ÉXITO: Encontró el código/link
        if (data.noError) {
            return data;
        } 
        
        // 2️⃣ CASO DE FALLO LÓGICO: GAS respondió, pero no encontró nada
        else {
            if (!isRetry) {
                console.log(`⏳ No se encontró código para ${email}. Reintentando en 5s...`);
                await delay(5000); 
                return await consultarCodigo(email, contact, true);
            } else {
                return data;
            }
        }

    } catch (err) {
        // 3️⃣ CASO DE ERROR DE CONEXIÓN
        if (!isRetry) {
            console.log(`⏳ Error de red al consultar ${email}. Reintentando en 5s...`);
            await delay(5000);
            return await consultarCodigo(email, contact, true);
        } else {
            return {
                noError: false,
                message: "Error de conexión. Intenta más tarde.",
                code: null,
                link: null,
                about: null,
                estimatedTimeAgo: null
            };
        }
    }
}

