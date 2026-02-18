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
    const urlGas = "https://script.google.com/macros/s/AKfycbzVyJR7ZGvVLp9B-AHbPE0nP2O9Ej4_bYrew7dP2klGMKBS1Ko0dFmIHL6MAWaAEOkPBA/exec";

    try {
        const response = await fetch(urlGas, {
            method: "POST",
            body: JSON.stringify({ emailToCheck: email, contact }),
            headers: { "Content-Type": "application/json" }
        });

        const data = await response.json();

        // 1️⃣ CASO DE ÉXITO: Encontró el código/link
        if (data.noError) {
            return {
                noError: true,
                errorMessage: null,
                code: data.code || null,
                link: data.link || null,
                about: data.about || null
            };
        } 
        
        // 2️⃣ CASO DE FALLO LÓGICO: GAS respondió, pero no encontró nada
        else {
            if (!isRetry) {
                // Reintento: Esperamos 5 segundos y volvemos a llamar a la función
                console.log(`⏳ No se encontró código para ${email}. Reintentando en 5s...`);
                await delay(5000); 
                return await consultarCodigo(email, contact, true);
            } else {
                // Si ya reintentó y volvió a fallar, devolvemos el error tal cual lo tenías en Toastify
                return {
                    noError: false,
                    errorMessage: data.message || "Ocurrió un error",
                    code: null,
                    link: null,
                    about: null
                };
            }
        }

    } catch (err) {
        // 3️⃣ CASO DE ERROR DE CONEXIÓN: Falló el fetch (timeout, red, etc)
        if (!isRetry) {
            console.log(`⏳ Error de red al consultar ${email}. Reintentando en 5s...`);
            await delay(5000);
            return await consultarCodigo(email, contact, true);
        } else {
            // Si ya reintentó y falló la conexión, devolvemos el error de tu Toastify del catch
            return {
                noError: false,
                errorMessage: "Error de conexión. Intenta más tarde.",
                code: null,
                link: null,
                about: null
            };
        }
    }
}

