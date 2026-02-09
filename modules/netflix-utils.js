import { parse } from "node-html-parser";
import fs from "fs/promises"; // Necesario para guardar el archivo
import path from "path";

export async function getNetflixTravelCode(url) {
    var result = { noError: true }
    try {
        var httpRes = await fetch(url, options);
        if (!httpRes.ok) {
            throw new Error(`HTTP ${httpRes.status} - ${httpRes.statusText}`);
        }
        var htmlRawText = await httpRes.text();
        var document = parse(htmlRawText);
        var codeElement = document?.querySelector('[data-uia="travel-verification-otp"]');
        if (document && codeElement && codeElement.textContent?.trim()) {
            result.code = codeElement.textContent.trim();
        }
    } catch (error) {
        result.noError = false;
        result.errorMessage = error.message;
    } finally {
        return result
    }
}

export async function saveNetflixHouseholdHtml(url, filePath) {
    var result = { noError: true };
    try {
        var httpRes = await fetch(url, options);

        if (!httpRes.ok) {
            throw new Error(`HTTP ${httpRes.status} - ${httpRes.statusText}`);
        }

        // Obtenemos el texto plano del HTML
        var htmlRawText = await httpRes.text();

        // Guardamos el archivo en el disco
        // filePath debe ser algo como "./temp/netflix.html"
        await fs.writeFile(filePath, htmlRawText, 'utf8');

        result.savedPath = filePath;

    } catch (error) {
        result.noError = false;
        result.errorMessage = error.message;
    } finally {
        return result;
    }
}

var options = {
    "headers": {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "en-US,en;q=0.9",
        "priority": "u=0, i",
        "sec-ch-ua": "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1"
    },
    "body": null,
    "method": "GET"
}
