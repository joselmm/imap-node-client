import fs from "fs";
import archiver from "archiver";
import fetch from "node-fetch";
import unzipper from "unzipper";
import { config } from "dotenv";

config();

/**
 * Comprime una carpeta en formato ZIP.
 * @param {string} folderPath - Carpeta a comprimir
 * @param {string} outputZipPath - Ruta del zip resultante
 */
function zipFolder(folderPath, outputZipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(outputZipPath));
    archive.on("error", (err) => reject(err));

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
}

/**
 * Convierte un archivo a base64.
 * @param {string} filePath - Ruta del archivo
 */
function fileToBase64(filePath) {
  const buffer = fs.readFileSync(filePath);
  return buffer.toString("base64");
}


export async function uploadFolderZipToGAS() {

  var folderPath = "./auth_info";
  var webAppUrl = process.env.FTP_SERVER;
  var fileId = process.env.DRIVE_FILE_ID;


  const zipName = process.env.OWNER + ".zip";
  const zipPath = `./${zipName}`;

  console.log("📦 Comprimiendo carpeta...");
  await zipFolder(folderPath, zipPath);
  console.log("✅ ZIP creado:", zipPath);

  console.log("🔄 Codificando a base64...");
  const base64Zip = fileToBase64(zipPath);

  console.log("📤 Enviando a GAS WebApp...");
  const body = {
    archivo_name: zipName,
    file_mime: "application/zip",
    archivo_base64: base64Zip,
    file_id: fileId
  };

  const res = await fetch(webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  console.log("✅ Respuesta GAS:", json);

  return json;
}



export async function downloadAndUnzipFromGAS() {
  var webAppUrl = process.env.FTP_SERVER;
  var outDir = './auth_info'
  const url = `${webAppUrl}?action=download&fileId=${encodeURIComponent(process.env.DRIVE_FILE_ID)}&base64=true`;
  const res = await fetch(url);
  const json = await res.json();

  if (!json.archivo_base64) throw new Error('No archivo_base64 in response');

  const buf = Buffer.from(json.archivo_base64, 'base64');

  // crear carpeta destino si no existe
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // descomprime desde buffer
  const directory = await unzipper.Open.buffer(buf);
  await directory.extract({ path: outDir });
  console.log("Se descargo y descomprimio el archivo de drive")
  return { ok: true, fileName: json.fileName, extractedTo: outDir };
}
