import fs from "fs";
import archiver from "archiver";

async function compressSessions() {
  const outputPath = "./backups/sesiones_backup.zip";

  // Crear carpeta backups si no existe
  if (!fs.existsSync("./backups")) {
    fs.mkdirSync("./backups");
  }

  const output = fs.createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  // Logs
  output.on("close", () => {
    console.log(`✅ Backup creado: ${outputPath}`);
    console.log(`🗜️  Tamaño total: ${archive.pointer()} bytes`);
  });

  archive.on("warning", (err) => {
    if (err.code === "ENOENT") console.warn("⚠️", err);
    else throw err;
  });

  archive.on("error", (err) => {
    throw err;
  });

  archive.pipe(output);

  // 📦 Agregar las carpetas que quieras comprimir
  const foldersToBackup = ["jose/session", "leiner/session", ".wwebjs_cache"];

  for (const folder of foldersToBackup) {
    if (fs.existsSync(folder)) {
      archive.directory(folder, folder.replace(/\//g, "_"));
      console.log(`📁 Añadiendo carpeta: ${folder}`);
    } else {
      console.log(`⚠️ Carpeta no encontrada: ${folder}`);
    }
  }

  // Finalizar compresión
  await archive.finalize();
}

compressSessions().catch((err) => {
  console.error("❌ Error al comprimir sesiones:", err.message);
});
